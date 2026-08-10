import { env } from './env'

/** Port of check_server.py build_rtmp_url — the server-to-SRS pull address. */
export function buildRtmpUrl(app: string, stream: string, vhost?: string): string {
  const appQ = encodeURIComponent(app)
  const streamQ = encodeURIComponent(stream)
  let url = `rtmp://${env.srsRtmpHost}/${appQ}/${streamQ}`
  if (vhost && vhost !== '__defaultVhost__') {
    url += `?vhost=${encodeURIComponent(vhost)}`
  }
  return url
}

/** SRS app name used for all live streams (matches the OBS /live mount). */
const LIVE_APP = 'live'

export interface PlaybackUrls {
  flv: string
  whep: string
}

/**
 * Browser→SRS playback URLs for a live stream, using the browser-visible host
 * (LAN/public IP). The browser connects to SRS directly — media never flows
 * through the app process.
 */
export function buildPlaybackUrls(streamName: string): PlaybackUrls {
  const streamQ = encodeURIComponent(streamName)
  return {
    flv: `http://${env.publicHost}:${env.srsFlvPort}/${LIVE_APP}/${streamQ}.flv`,
    whep: `http://${env.publicHost}:${env.srsApiPort}/rtc/v1/whep/?app=${LIVE_APP}&stream=${streamQ}`,
  }
}

