/**
 * Internal RTMP-auth endpoint: the Go gateway asks the app to verify an Adobe
 * authmod `response` (stage 3). This is a password-equivalent oracle — gated by
 * the shared RTMP_AUTH_TOKEN header, never session auth, never public.
 *
 * We decrypt the stored AES verifier (librtmp's `salted2` = base64(md5(email +
 * salt + password))) and run verifyResponse(): a constant-time compare of
 * base64(md5(salted2 + opaque + challenge)) against the client's `response`.
 * Returns a constant `{ allow }` shape for known AND unknown users — no
 * enumeration, no short-circuit timing leak.
 *
 * See server/utils/authmod.ts + docs/STREAMING.md.
 */
import { createError, getHeader } from 'h3'
import { env } from '../../../utils/env'
import { UsersRepository } from '../../../repositories/users.repository'
import { verifierFromCipher, verifyResponse } from '../../../utils/authmod'

export default defineEventHandler(async (event) => {
  if (getHeader(event, 'x-rtmp-auth') !== env.rtmpAuthToken) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const body = await readBody<{ email?: string; opaque?: string; challenge?: string; response?: string }>(event)
  const email = String(body?.email ?? '').trim().toLowerCase()
  const user = email ? UsersRepository.findByEmail(email) : undefined
  if (!user?.authmodVerifier) {
    return { allow: false }
  }
  const ok = verifyResponse({
    storedVerifier: verifierFromCipher(user.authmodVerifier),
    opaque: String(body?.opaque ?? ''),
    challenge: String(body?.challenge ?? ''),
    response: String(body?.response ?? ''),
  })
  return { allow: ok }
})
