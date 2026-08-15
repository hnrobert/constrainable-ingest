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
