/**
 * Step 2 of two-step email registration. Auto-allowlisted (lives under /api/auth/).
 *
 * Email is the login identifier, verified via a 6-digit code emailed by
 * /api/auth/send-code (keyed by `${email}:${session}`). The FIRST user to
 * register (empty users table) becomes the super admin and is EXEMPT from the
 * code + whitelist (mail may not be configured yet) — mirroring
 * unnc-freshmen-verifier-gateway's bootstrap. Every later registrant is a
 * 'viewer' (watch /viewer streams, no admin panel). On success the session cookie
 * is set so the caller is logged in immediately.
 */
import { createError } from 'h3'
import { UsersRepository } from '../../repositories/users.repository'
import { hashPassword } from '../../utils/password'
import { createSessionCookie } from '../../utils/session'
import { audit } from '../../services/audit'
import {
  EMAIL_RE,
  describeEmailRules,
  isDisallowedEmail,
  normalizeEmail,
  passesWhitelist,
} from '../../utils/registration'
import { consumeCode } from '../../utils/email-code'

const MIN_PASSWORD = 6

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const email = normalizeEmail(String(body?.email ?? ''))
  const password = String(body?.password ?? '')
  const code = String(body?.code ?? '')
  const session = String(body?.session ?? '')

  if (!EMAIL_RE.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid email format' })
  }
  if (password.length < MIN_PASSWORD) {
    throw createError({ statusCode: 400, statusMessage: `Password must be at least ${MIN_PASSWORD} characters` })
  }
  if (isDisallowedEmail(email)) {
    const rules = describeEmailRules()
    throw createError({ statusCode: 403, statusMessage: `This email address is not allowed to register${rules ? ` (${rules})` : ''}` })
  }
  if (UsersRepository.findByEmail(email)) {
    throw createError({ statusCode: 409, statusMessage: 'This email is already registered' })
  }

  const isFirst = UsersRepository.isEmpty()

  // Non-bootstrap registrations must pass the whitelist and a valid code.
  if (!isFirst) {
    if (!passesWhitelist(email)) {
      const rules = describeEmailRules()
      throw createError({ statusCode: 403, statusMessage: `This email domain is not allowed to register${rules ? ` (${rules})` : ''}` })
    }
    if (!session || !consumeCode(email, session, code)) {
      throw createError({ statusCode: 400, statusMessage: 'Verification code is invalid or expired' })
    }
  }

  const role = isFirst ? 'admin' : 'viewer'
  const passwordHash = await hashPassword(password)
  const user = UsersRepository.insert({ email, passwordHash, role })

  const cookie = await createSessionCookie(user.id, user.role)
  setCookie(event, cookie.name, cookie.value, cookie.options)
  audit('info', 'auth', `register: ${email} (${role})`, {
    detail: { userId: user.id, role, first: isFirst, verified: !isFirst },
  })
  return { id: user.id, email: user.email, role: user.role }
})
