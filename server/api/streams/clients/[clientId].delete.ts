/**
 * Admin: force-disconnect a live publisher (the "Kick" button on the realtime
 * panel). Kills the SRS client and records a short-lived kick ban for the
 * stream name so OBS's automatic reconnect (seconds later, same key) is
 * rejected terminally by the RTMP gateway instead of going live again. SRS then
 * fires on_unpublish, which ends the session, finalizes the recording, and
 * pushes session:stop so the panel row disappears.
 */
import { createError, getHeader, getRouterParam } from 'h3'
import { killClient } from '../../../services/srs-client'
import { recordKickBan } from '../../../services/kick-bans'
import { audit } from '../../../services/audit'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const clientId = getRouterParam(event, 'clientId')
  if (!clientId) throw createError({ statusCode: 400, statusMessage: 'clientId is required' })
  const streamName = String(getHeader(event, 'x-stream-name') || getQuery(event).stream || '').trim()

  const ok = await killClient(clientId)
  if (streamName) recordKickBan(streamName)
  audit(ok ? 'warn' : 'error', 'publish', `admin kicked client ${clientId} (${ok ? 'ok' : 'failed'})`, {
    detail: { clientId, streamName, banned: !!streamName },
  })
  if (!ok) throw createError({ statusCode: 502, statusMessage: 'SRS rejected the kick (already gone?)' })
  return { ok: true, banned: !!streamName }
})
