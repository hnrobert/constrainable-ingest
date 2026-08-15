/**
 * Stale-session reconciler. When SRS restarts (or a publish hook is lost), the
 * app never sees on_unpublish — the session row stays open forever and the
 * realtime panel shows ghosts. This sweep compares open sessions against the
 * streams actually live in SRS and closes anything SRS no longer has, using
 * the same end-of-life path as a normal unpublish (DB close + recorder stop +
 * session:stop push).
 *
 * Fail-safe: if the SRS API is unreachable the sweep does NOTHING — an API
 * outage must never reap genuinely-live sessions.
 */
import { PublishSessionsRepository } from '../repositories/publish-sessions.repository'
import { listLiveStreamNames } from './srs-client'
import * as recorder from './recorder'
import { audit } from './audit'
import { emit } from '../utils/bus'
import type { SessionSnapshot, SessionStatus } from '#shared/events'

export async function reconcileStaleSessions(): Promise<void> {
  const open = PublishSessionsRepository.findActive()
  if (open.length === 0) return
  const live = await listLiveStreamNames()
  if (live === null) return // SRS unreachable — skip this sweep entirely

  for (const s of open) {
    if (live.has(s.streamName)) continue
    const finalStatus: SessionStatus = s.compliant ? 'compliant' : 'ended'
    const endedAt = new Date()
    PublishSessionsRepository.markEnded(s.id, finalStatus, endedAt)
    // finalize any recorder temp file still holding this stream's handle
    await recorder.stopRecording(s.streamName, s.eventId, s.id, null)
    emit('session:stop', {
      sessionId: s.id,
      eventId: s.eventId,
      streamName: s.streamName,
      status: finalStatus,
      srsClientId: s.srsClientId,
      width: s.width,
      height: s.height,
      fps: s.fps,
      bitrateKbps: s.bitrateKbps,
      compliant: s.compliant,
      rejectReason: s.rejectReason,
      startedAt: s.startedAt.getTime(),
      endedAt: endedAt.getTime(),
    } satisfies SessionSnapshot)
    audit('warn', 'publish', `reconciled stale session: ${s.streamName} (#${s.id})`, {
      streamName: s.streamName,
      detail: { sessionId: s.id },
    })
    console.log(`[reconcile] closed stale session #${s.id} ${s.streamName} (${finalStatus})`)
  }
}
