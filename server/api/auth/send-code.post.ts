/**
 * Step 1 of two-step email registration: email a 6-digit verification code.
 * Auto-allowlisted (lives under /api/auth/). The code is keyed by
 * `${email}:${session}` so concurrent tabs don't collide; step 2 (register)
 * consumes it. Bootstrap mode (no users yet) short-circuits — the first admin
 * needs no code — so the frontend simply won't call this until a user exists.
 */
import { createError } from 'h3'
import { randomInt } from 'node:crypto'
import { UsersRepository } from '../../repositories/users.repository'
import {
  EMAIL_RE,
  isDisallowedEmail,
  normalizeEmail,
  passesWhitelist,
} from '../../utils/registration'
import { issueCode } from '../../utils/email-code'
import { checkEmailSend, throwEmailLimit } from '../../utils/email-limit'
import { getMailConfig, isMailConfigured } from '../../utils/mail-config'
import { sendMailWithConfig } from '../../services/mail'
import { renderVerificationEmail, VERIFICATION_CODE_SUBJECT } from '../../utils/mail-template'
import { audit } from '../../services/audit'

const CODE_MINUTES = 10

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const email = normalizeEmail(String(body?.email ?? ''))
  const session = String(body?.session ?? '')

  if (!EMAIL_RE.test(email)) {
    throw createError({ statusCode: 400, statusMessage: '邮箱格式无效' })
  }
  if (!session) {
    throw createError({ statusCode: 400, statusMessage: '缺少会话标识' })
  }

  // Bootstrap: no users yet → first admin needs no code.
  if (UsersRepository.isEmpty()) {
    return { ok: true, bootstrap: true }
  }

  if (isDisallowedEmail(email)) {
    throw createError({ statusCode: 400, statusMessage: '该邮箱地址不允许注册' })
  }
  if (UsersRepository.findByEmail(email)) {
    throw createError({ statusCode: 409, statusMessage: '该邮箱已注册' })
  }
  if (!passesWhitelist(email)) {
    throw createError({ statusCode: 403, statusMessage: '该邮箱域名不在允许注册的范围' })
  }

  const limit = checkEmailSend('code', email)
  if (!limit.allowed) throwEmailLimit(limit)

  if (!isMailConfigured()) {
    throw createError({ statusCode: 503, statusMessage: '邮件服务未配置，请联系管理员' })
  }

  const code = String(randomInt(100000, 1000000))
  issueCode(email, session, code)

  try {
    await sendMailWithConfig(getMailConfig(), {
      to: email,
      subject: VERIFICATION_CODE_SUBJECT,
      body: renderVerificationEmail(code, CODE_MINUTES),
      html: true,
    })
  } catch (err) {
    audit('error', 'auth', `verification code send failed: ${email}`, {
      detail: { error: err instanceof Error ? err.message : String(err) },
    })
    throw createError({ statusCode: 502, statusMessage: '验证码发送失败，请稍后重试或联系管理员' })
  }

  audit('info', 'auth', `verification code sent: ${email}`)
  return { ok: true }
})
