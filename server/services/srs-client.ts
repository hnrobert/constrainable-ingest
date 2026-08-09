/**
 * SRS HTTP API client. Port of check_server.py kill_stream (requests.delete),
 * plus helpers for the admin panel (getStreams/getClients).
 */
import { env } from '../utils/env'

/** Force-disconnect a publishing client by id. */
export async function killClient(clientId: string): Promise<boolean> {
  if (!clientId) return false
  const url = `${env.srsApiBase}/clients/${encodeURIComponent(clientId)}`
  try {
    const res = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(5000) })
    if (!res.ok) {
      console.error(`[srs] killClient ${clientId} -> HTTP ${res.status}`)
    }
    return res.ok
  } catch (err) {
    console.error('[srs] killClient failed:', err)
    return false
  }
}

/** List active streams (SRS /streams). */
export async function getStreams(): Promise<unknown> {
  const res = await fetch(`${env.srsApiBase}/streams`, { signal: AbortSignal.timeout(5000) })
  return res.ok ? res.json() : { streams: [] }
}

/** List connected clients (SRS /clients). */
export async function getClients(): Promise<unknown> {
  const res = await fetch(`${env.srsApiBase}/clients`, { signal: AbortSignal.timeout(5000) })
  return res.ok ? res.json() : { clients: [] }
}
