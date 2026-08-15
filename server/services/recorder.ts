/**
 * ffmpeg recorder — direct port of check_server.py's recording management:
 *   startRecording  → ffmpeg copies the RTMP stream to a temp .flv from publish
 *   markCompliant   → flag the stream as eligible for archiving
 *   stopRecording   → on unpublish: remux compliant FLV→MP4 (keep .flv on
 *                     failure), delete temp for non-compliant streams
 *
 * `_recordings` dict + `_record_lock` → a plain Map (JS is single-threaded).
 */
import { mkdirSync, rmSync, renameSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { env } from '../utils/env'
import { getConfig } from '../utils/config-store'
import { safeName } from '../utils/filename'
import { buildFlvPullUrl } from '../utils/srs-url'
import { awaitExitOrKill, quitFfmpeg, readStream, type AnyProc } from '../utils/process'
import { RecordingsRepository } from '../repositories/recordings.repository'
import { emit } from '../utils/bus'

interface Handle {
  proc: AnyProc
  tmpPath: string
  startedAt: number // epoch ms
  compliant: boolean
  width: number | null
  height: number | null
  fps: number | null
}

/** keyed by streamName (app is constant "live" in our SRS config) */
const handles = new Map<string, Handle>()

/** Push-start: begin recording to a temp FLV immediately on publish. */
export function startRecording(
  streamName: string,
  app: string,
  vhost: string,
  clientId: string,
): void {
  const cfg = getConfig()
  if (!cfg.record.enabled) return
  // bounded concurrency: once at cap, new streams are not recorded (existing
  // recordings finish). Read fresh so a config change affects new publishes.
  if (handles.size >= cfg.record.maxConcurrency) {
    console.warn(
      `[recorder] at capacity (${handles.size}/${cfg.record.maxConcurrency}), skipping record for ${streamName}`,
    )
    return
  }
  if (handles.has(streamName)) return
  const tmpDir = join(env.recordDir, '_tmp')
  mkdirSync(tmpDir, { recursive: true })
  const tmpPath = join(tmpDir, `${safeName(streamName)}_${clientId}.flv`)
  const cmd = [
    env.ffmpegPath,
    '-y',
    '-v',
    'error',
    '-i',
    // HTTP-FLV pull: SRS's RTMP-play path starves on low-fps streams (see
    // srs-url.ts); the FLV path serves the same stream reliably.
    buildFlvPullUrl(streamName),
    '-c',
    'copy',
    '-f',
    'flv',
    tmpPath,
  ]
  const proc = Bun.spawn({ cmd, stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' })
  handles.set(streamName, {
    proc,
    tmpPath,
    startedAt: Date.now(),
    compliant: false,
    width: null,
    height: null,
    fps: null,
  })
  console.log(`[recorder] started ${streamName}: ${tmpPath}`)
}

/** Mark compliant so stopRecording will archive it. Captures last-seen dims/fps. */
export function markCompliant(streamName: string, width?: number, height?: number, fps?: number): void {
  const h = handles.get(streamName)
  if (!h) return
  h.compliant = true
  if (width) h.width = width
  if (height) h.height = height
  if (fps) h.fps = fps
}

/** Push-end: archive (compliant) or discard (non-compliant) the temp recording. */
export async function stopRecording(
  streamName: string,
  eventId: number | null,
  sessionId: number | null,
  studentLabel: string | null,
): Promise<void> {
  const h = handles.get(streamName)
  if (!h) return
  handles.delete(streamName)
  await quitFfmpeg(h.proc, 10000)
  if (h.compliant) {
    await finalizeRecording(streamName, h, eventId, sessionId, studentLabel)
  } else {
    try {
      rmSync(h.tmpPath)
      console.log(`[recorder] discarded non-compliant temp for ${streamName}`)
    } catch {
      // already gone
    }
  }
}

/**
 * Remux temp FLV → MP4 under {RECORD_DIR}/{YYYY-MM-DD}/; keep .flv on failure.
 * MERGE: a user re-publishing into the same event appends to their existing
 * recording (chronological: earlier segments first). Same-codec copies go
 * through ffmpeg's concat demuxer into the SAME file; the DB row keeps the
 * original start, accumulates size/duration, and its end moves to now.
 */
async function finalizeRecording(
  streamName: string,
  h: Handle,
  eventId: number | null,
  sessionId: number | null,
  studentLabel: string | null,
): Promise<void> {
  const endedAt = new Date()
  const segDurSec = Math.max(0, Math.round((endedAt.getTime() - h.startedAt) / 1000))
  const { date, ts } = localParts(new Date(h.startedAt))
  const dateDir = join(env.recordDir, date)
  mkdirSync(dateDir, { recursive: true })
  const base = join(dateDir, `${safeName(streamName)}_${ts}`)
  const segPath = `${base}.mp4`

  const remux = [env.ffmpegPath, '-y', '-v', 'error', '-i', h.tmpPath, '-c', 'copy', '-f', 'mp4', segPath]
  const remuxProc = Bun.spawn({ cmd: remux, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const remuxCode = await awaitExitOrKill(remuxProc, getConfig().record.remuxTimeoutMs)
  if (remuxCode !== 0) {
    const stderr = await readStream(remuxProc.stderr as ReadableStream<Uint8Array> | null)
    const fallback = `${base}.flv`
    try {
      renameSync(h.tmpPath, fallback)
      console.error(
        `[recorder] MP4 remux failed for ${streamName} (${stderr.trim()}); kept FLV: ${fallback}`,
      )
    } catch (err) {
      console.error(`[recorder] remux + FLV fallback failed for ${streamName}:`, err)
    }
    return
  }
  try {
    rmSync(h.tmpPath)
  } catch {
    // ignore
  }

  // ---- merge into the user's existing recording for this event ----
  const prev =
    eventId != null ? RecordingsRepository.findMergeTarget(eventId, streamName) : undefined
  if (prev) {
    const prevAbs = join(env.recordDir, prev.filePath)
    const combinedPath = `${base}_combined.mp4`
    const ok = await concatMp4([prevAbs, segPath], combinedPath)
    if (ok) {
      try {
        renameSync(combinedPath, prevAbs)
        rmSync(segPath)
      } catch (err) {
        console.error(`[recorder] merge replace failed for ${streamName}:`, err)
        return
      }
      const prevDur = prev.durationSec ?? 0
      const prevSize = statSync(prevAbs).size
      const prevFps = prev.avgFps ?? 0
      RecordingsRepository.update(prev.id, {
        sizeBytes: prevSize,
        durationSec: prevDur + segDurSec,
        avgFps:
          prevFps && h.fps
            ? (prevFps * prevDur + h.fps * segDurSec) / Math.max(1, prevDur + segDurSec)
            : (h.fps ?? prevFps),
        width: h.width ?? prev.width,
        height: h.height ?? prev.height,
        endedAt,
      })
      emit('recording:ready', {
        id: prev.id,
        eventId,
        sessionId,
        streamName,
        studentLabel,
        filePath: prev.filePath,
        sizeBytes: prevSize,
        durationSec: prevDur + segDurSec,
        startedAt: prev.startedAt.getTime(),
      })
      console.log(
        `[recorder] merged ${streamName} +${segDurSec}s into #${prev.id} (${prev.filePath})`,
      )
      return
    }
    console.error(`[recorder] concat failed for ${streamName}; storing segment separately`)
    // fall through to a standalone row
  }

  let size = 0
  try {
    size = statSync(segPath).size
  } catch {
    // ignore
  }
  const rel = relative(env.recordDir, segPath)
  const row = RecordingsRepository.insert({
    eventId,
    sessionId,
    streamName,
    studentLabel,
    filePath: rel,
    sizeBytes: size,
    durationSec: segDurSec,
    avgFps: h.fps,
    width: h.width,
    height: h.height,
    startedAt: new Date(h.startedAt),
    endedAt,
  })
  emit('recording:ready', {
    id: row.id,
    eventId,
    sessionId,
    streamName,
    studentLabel,
    filePath: rel,
    sizeBytes: size,
    durationSec: segDurSec,
    startedAt: h.startedAt,
  })
  console.log(`[recorder] saved ${segPath} (${size} bytes, ${segDurSec}s)`)
}

/** Concatenate same-codec MP4s with ffmpeg's concat demuxer (-c copy). */
async function concatMp4(parts: string[], outPath: string): Promise<boolean> {
  const listPath = `${outPath}.txt`
  const list = parts.map((p) => `file '${p.replaceAll("'", "'\''")}'`).join('\n')
  const listFile = Bun.file(listPath)
  await listFile.write(list)
  const cmd = [
    env.ffmpegPath,
    '-y',
    '-v',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c',
    'copy',
    '-f',
    'mp4',
    outPath,
  ]
  const proc = Bun.spawn({ cmd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const code = await awaitExitOrKill(proc, getConfig().record.remuxTimeoutMs)
  try {
    rmSync(listPath)
    if (code !== 0) rmSync(outPath, { force: true })
  } catch {
    // ignore
  }
  return code === 0
}

/** Local-time date parts (TZ-dependent; container TZ=Asia/Shanghai). */
function localParts(d: Date): { date: string; ts: string } {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return { date: `${y}-${mo}-${da}`, ts: `${y}${mo}${da}_${hh}${mi}${ss}` }
}
