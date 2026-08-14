import { env } from './env'

/**
 * The server-to-SRS pull address (recorder ffmpeg, monitor ffprobe). Path
 * components use encodeURI, NOT encodeURIComponent: `@` is legal in RTMP path
 * segments and ffmpeg treats URLs literally — `gwtest%40example.com` pulls a
 * nonexistent stream, so email stream names must stay verbatim.
 */
export function buildRtmpUrl(app: string, stream: string, vhost?: string): string {
  let url = `rtmp://${env.srsRtmpHost}/${encodeURI(app)}/${encodeURI(stream)}`
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
 * Playback URLs for a live stream.
 *
 * FLV: a RELATIVE same-origin URL — the app proxies SRS's HTTP-FLV remux at
 * /api/streams/live/<stream> (see server/api/streams/live/[stream].get.ts), so
 * playback needs no CORS and works from any machine that can reach the app,
 * regardless of SRS's host/ports.
 *
 * WHEP (WebRTC): the browser must talk to SRS directly (media is peer-to-peer;
 * only the SDP signaling could be proxied), so this stays an absolute URL on
 * the browser-visible host.
 */
export function buildPlaybackUrls(streamName: string): PlaybackUrls {
  return {
    flv: `/api/streams/live/${encodeURIComponent(streamName)}`,
    whep: `http://${env.publicHost}:${env.srsApiPort}/rtc/v1/whep/?app=${LIVE_APP}&stream=${encodeURIComponent(streamName)}`,
  }
}

