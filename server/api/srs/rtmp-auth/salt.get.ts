/**
 * Internal RTMP-auth endpoint: the Go gateway fetches a publisher's authmod salt
 * during the Adobe challenge-response stage 2. The gateway must send the user's
 * REAL salt so librtmp can compute `salted2 = base64(md5(user + salt + password))`
 * client-side; a wrong salt makes the later response unverifiable.
 *
 * Guarded by the shared RTMP_AUTH_TOKEN header (never session auth). Under the
 * /api/srs/ allowlist for SRS-hook parity, but this touches a password-adjacent
 * path, so the token gate is mandatory. Unknown / unregistered email → 404 (the
 * gateway then sends a random salt so the challenge looks identical and the
 * stage-3 verify simply fails — no user enumeration via the dance).
 *
 * See server/utils/authmod.ts + docs/STREAMING.md.
 */
import { createError, getHeader, getQuery } from 'h3'
import { env } from '../../../utils/env'
import { UsersRepository } from '../../../repositories/users.repository'

export default defineEventHandler((event) => {
  if (getHeader(event, 'x-rtmp-auth') !== env.rtmpAuthToken) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const email = String(getQuery(event).email ?? '').trim().toLowerCase()
  const user = email ? UsersRepository.findByEmail(email) : undefined
  if (!user?.authmodSalt) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  return { salt: user.authmodSalt }
})
