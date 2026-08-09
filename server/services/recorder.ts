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
import { buildRtmpUrl } from '../utils/srs-url'
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
    buildRtmpUrl(app, streamName, vhost),
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
  })
  console.log(`[recorder] started ${streamName}: ${tmpPath}`)
}

/** Mark compliant so stopRecording will archive it. Captures last-seen dims. */
export function markCompliant(streamName: string, width?: number, height?: number): void {
  const h = handles.get(streamName)
  if (!h) return
  h.compliant = true
  if (width) h.width = width
  if (height) h.height = height
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

/** Remux temp FLV → MP4 under {RECORD_DIR}/{YYYY-MM-DD}/; keep .flv on failure. */
async function finalizeRecording(
  streamName: string,
  h: Handle,
  eventId: number | null,
  sessionId: number | null,
  studentLabel: string | null,
): Promise<void> {
  const { date, ts } = localParts(new Date(h.startedAt))
  const dateDir = join(env.recordDir, date)
  mkdirSync(dateDir, { recursive: true })
  const base = join(dateDir, `${safeName(streamName)}_${ts}`)
  const finalPath = `${base}.mp4`

  const cmd = [
    env.ffmpegPath,
    '-y',
    '-v',
    'error',
    '-i',
    h.tmpPath,
    '-c',
    'copy',
    '-f',
    'mp4',
    finalPath,
  ]
  const proc = Bun.spawn({ cmd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const code = await awaitExitOrKill(proc, getConfig().record.remuxTimeoutMs)

  if (code === 0) {
    let size = 0
    try {
      size = statSync(finalPath).size
    } catch {
      // ignore
    }
    try {
      rmSync(h.tmpPath)
    } catch {
      // ignore
    }
    const rel = relative(env.recordDir, finalPath)
    const row = RecordingsRepository.insert({
      eventId,
      sessionId,
      streamName,
      studentLabel,
      filePath: rel,
      sizeBytes: size,
      width: h.width,
      height: h.height,
      startedAt: new Date(h.startedAt),
    })
    emit('recording:ready', {
      id: row.id,
      eventId,
      sessionId,
      streamName,
      studentLabel,
      filePath: rel,
      sizeBytes: size,
      durationSec: null,
      startedAt: h.startedAt,
    })
    console.log(`[recorder] saved ${finalPath} (${size} bytes)`)
  } else {
    const stderr = await readStream(proc.stderr as ReadableStream<Uint8Array> | null)
    const fallback = `${base}.flv`
    try {
      renameSync(h.tmpPath, fallback)
      console.error(
        `[recorder] MP4 remux failed for ${streamName} (${stderr.trim()}); kept FLV: ${fallback}`,
      )
    } catch (err) {
      console.error(`[recorder] remux + FLV fallback failed for ${streamName}:`, err)
    }
  }
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
