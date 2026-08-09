/**
 * Single enforcement gate. On every request it:
 *   1. Parses the signed `sid` cookie → event.context.auth (or null).
 *   2. Lets the allowlist through unauthenticated (SRS hooks, viewer, health,
 *      the auth endpoints themselves, and static/Nuxt internals).
 *   3. Lets authenticated *admin* sessions through.
 *   4. Otherwise: 401 JSON for /api/*, or 302 → /login for page requests.
 *
 * Pure-HTTP intranet, so cookie has no Secure (see session.ts). This is the
 * real security boundary; client-side guards are only UX.
 */
import { createError, getCookie, sendRedirect } from 'h3'
import { readSessionCookie } from '../utils/session'

// prefixes/paths that never require an admin session
const ALLOW = [
  '/api/srs/',
  '/api/auth/',
  '/api/viewer/',
  '/api/health',
  '/login',
  '/viewer',
  '/_nuxt/',
  '/__nuxt',
  '/socket.io/',
  '/favicon.ico',
]

export default defineEventHandler(async (event) => {
  // 1. always populate auth context
  const cookie = getCookie(event, 'sid')
  const payload = cookie ? await readSessionCookie(cookie) : null
  if (payload) event.context.auth = { userId: payload.uid, role: payload.role }

  const path = (event.path ?? '').split('?')[0] ?? ''

  // 2. allowlist
  if (ALLOW.some((p) => path === p || path.startsWith(p))) return

  // 3. authenticated admin → through
  if (payload && payload.role === 'admin') return

  // 4. enforce
  if (path.startsWith('/api/')) {
    throw createError({ statusCode: 401, statusMessage: 'authentication required' })
  }
  // page request → send to login (preserves the intended destination)
  return sendRedirect(event, `/login?redirect=${encodeURIComponent(path)}`, 302)
})
