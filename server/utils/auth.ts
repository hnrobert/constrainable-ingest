/**
 * Auth context helpers. The 01-auth middleware populates event.context.auth from
 * the signed session cookie; handlers that need finer checks (e.g. viewer-only
 * routes) call these. All non-allowlisted admin routes are already gated by the
 * middleware, so most handlers never call requireAdmin directly.
 */
import { createError, type H3Event } from 'h3'

export interface AuthContext {
  userId: number
  role: 'admin' | 'viewer'
}

declare module 'h3' {
  interface H3EventContext {
    auth: AuthContext | null
  }
}

export function getAuth(event: H3Event): AuthContext | null {
  return event.context.auth ?? null
}

/** Throw 401 unless an authenticated admin is present. */
export function requireAdmin(event: H3Event): AuthContext {
  const auth = event.context.auth
  if (!auth || auth.role !== 'admin') {
    throw createError({ statusCode: 401, statusMessage: 'authentication required' })
  }
  return auth
}
