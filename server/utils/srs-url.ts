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
