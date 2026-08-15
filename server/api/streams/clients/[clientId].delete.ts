/**
 * Admin: force-disconnect a live publisher (the "Kick" button on the realtime
 * panel). Kills the SRS client; SRS then fires on_unpublish, which ends the
 * session, finalizes the recording, and pushes session:stop so the panel row
 * disappears. With the RTMP gateway in front, killing the SRS side also tears
 * down the OBS connection (the gateway closes it when the upstream dies).
 */
import { killClient } from '../../../services/srs-client'
import { audit } from '../../../services/audit'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const clientId = getRouterParam(event, 'clientId')
  if (!clientId) throw createError({ statusCode: 400, statusMessage: 'clientId is required' })

  const ok = await killClient(clientId)
  audit(ok ? 'warn' : 'error', 'publish', `admin kicked client ${clientId} (${ok ? 'ok' : 'failed'})`, {
    detail: { clientId },
  })
  if (!ok) throw createError({ statusCode: 502, statusMessage: 'SRS rejected the kick (already gone?)' })
  return { ok: true }
})
