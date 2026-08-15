/**
 * Short-lived publish bans, keyed by stream name. When an admin kicks a live
 * publisher, OBS auto-reconnects within seconds and would simply go live again;
 * recording the stream name here lets the RTMP gateway's policy check reject
 * the immediate re-publish (terminal BadName) until the ban expires. Network
 * blip reconnects during the TTL also get rejected — the trade-off for making
 * a kick actually stick. In-memory by design: an app restart clears bans.
 */
const bans = new Map<string, number>() // streamName → expiry epoch ms

const TTL_MS = 60_000

export function recordKickBan(streamName: string): void {
  if (!streamName) return
  bans.set(streamName, Date.now() + TTL_MS)
}

export function isKickBanned(streamName: string): boolean {
  const until = bans.get(streamName)
  if (until == null) return false
  if (until <= Date.now()) {
    bans.delete(streamName)
    return false
  }
  return true
}

/**
 * Map an account email to the stream-name form the RTMP gateway synthesizes
 * (same rules as the gateway's safeStreamName: anything outside [A-Za-z0-9._-]
 * becomes '_'). The dance's stage-2 lookup only knows the EMAIL, but bans are
 * recorded against session stream names.
 */
export function streamKeyForEmail(email: string): string {
  return email.replace(/[^A-Za-z0-9._-]/g, '_')
}
