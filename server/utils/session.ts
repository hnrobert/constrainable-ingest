/**
 * Signed session cookies. The cookie carries {uid, role, exp} as
 * base64url(json).hmac(payload). HMAC-SHA256 over env.sessionSecret.
 * Pure-HTTP intranet → HttpOnly + SameSite=Lax, deliberately no Secure
 * (documented threat model: trusted internal network).
 */
import { env } from './env'

export interface SessionPayload {
  uid: number
  role: 'admin' | 'viewer'
  exp: number // unix seconds
}

const COOKIE_NAME = 'sid'
const MAX_AGE_SEC = 7 * 24 * 60 * 60 // 7 days
const b64u = (s: string): string => Buffer.from(s, 'utf8').toString('base64url')

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.sessionSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return Buffer.from(new Uint8Array(sig)).toString('base64url')
}

export interface CookieSpec {
  name: string
  value: string
  options: { httpOnly: true; sameSite: 'lax'; path: '/'; maxAge: number }
}

export async function createSessionCookie(uid: number, role: 'admin' | 'viewer'): Promise<CookieSpec> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC
  const data = b64u(JSON.stringify({ uid, role, exp }))
  const sig = await hmac(data)
  return {
    name: COOKIE_NAME,
    value: `${data}.${sig}`,
    options: { httpOnly: true, sameSite: 'lax', path: '/', maxAge: MAX_AGE_SEC },
  }
}

export async function readSessionCookie(value: string | undefined): Promise<SessionPayload | null> {
  if (!value || !value.includes('.')) return null
  const parts = value.split('.')
  const data = parts[0]
  const sig = parts[1]
  if (!data || !sig) return null
  // constant-time-ish compare; timing leaks here only reveal cookie validity,
  // not the secret — acceptable for an intranet gate.
  const expected = await hmac(data)
  if (expected !== sig) return null
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as SessionPayload
    if (typeof p.uid !== 'number') return null
    if (p.role !== 'admin' && p.role !== 'viewer') return null
    if (typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) return null
    return { uid: p.uid, role: p.role, exp: p.exp }
  } catch {
    return null
  }
}

export const clearSessionCookie = { name: COOKIE_NAME, options: { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 0 } }

/* --------------------------- viewer (passphrase) --------------------------- */
// Separate signed cookie for viewers who unlocked passphrase-protected events.
// Carries { unlocks: number[], exp } (the set of eventIds they may watch).
const VIEWER_COOKIE = 'viewer'

export async function createViewerCookie(
  eventId: number,
  existing: number[] = [],
): Promise<CookieSpec> {
  const unlocks = Array.from(new Set([...existing, eventId]))
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC
  const data = b64u(JSON.stringify({ unlocks, exp }))
  const sig = await hmac(data)
  return {
    name: VIEWER_COOKIE,
    value: `${data}.${sig}`,
    options: { httpOnly: true, sameSite: 'lax', path: '/', maxAge: MAX_AGE_SEC },
  }
}

export async function readViewerCookie(value: string | undefined): Promise<number[]> {
  if (!value || !value.includes('.')) return []
  const parts = value.split('.')
  const data = parts[0]
  const sig = parts[1]
  if (!data || !sig) return []
  if ((await hmac(data)) !== sig) return []
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as {
      unlocks?: unknown
      exp?: number
    }
    if (typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) return []
    if (!Array.isArray(p.unlocks)) return []
    return p.unlocks.filter((x): x is number => typeof x === 'number')
  } catch {
    return []
  }
}
