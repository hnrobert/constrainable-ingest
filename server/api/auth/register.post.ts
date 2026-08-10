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
  isDisallowedEmail,
  normalizeEmail,
  passesWhitelist,
} from '../../utils/registration'
import { consumeCode } from '../../utils/email-code'

const MIN_PASSWORD = 4

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const email = normalizeEmail(String(body?.email ?? ''))
  const password = String(body?.password ?? '')
  const code = String(body?.code ?? '')
  const session = String(body?.session ?? '')

  if (!EMAIL_RE.test(email)) {
    throw createError({ statusCode: 400, statusMessage: '邮箱格式无效' })
  }
  if (password.length < MIN_PASSWORD) {
    throw createError({ statusCode: 400, statusMessage: `密码至少 ${MIN_PASSWORD} 位` })
  }
  if (isDisallowedEmail(email)) {
    throw createError({ statusCode: 400, statusMessage: '该邮箱地址不允许注册' })
  }
  if (UsersRepository.findByEmail(email)) {
    throw createError({ statusCode: 409, statusMessage: '该邮箱已注册' })
  }

  const isFirst = UsersRepository.isEmpty()

  // Non-bootstrap registrations must pass the whitelist and a valid code.
  if (!isFirst) {
    if (!passesWhitelist(email)) {
      throw createError({ statusCode: 403, statusMessage: '该邮箱域名不在允许注册的范围' })
    }
    if (!session || !consumeCode(email, session, code)) {
      throw createError({ statusCode: 400, statusMessage: '验证码无效或已过期' })
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
