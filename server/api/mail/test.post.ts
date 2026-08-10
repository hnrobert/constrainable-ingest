/**
 * Admin: send a test email to `to` using the current site mail config. Per-
 * recipient rate-limited (1/min, 10/day). Lets the admin verify SMTP/webhook
 * connectivity right after editing the config.
 */
import { createError } from 'h3'
import { EMAIL_RE, normalizeEmail } from '../../utils/registration'
import { checkEmailSend, throwEmailLimit } from '../../utils/email-limit'
import { getMailConfig, isMailConfigured } from '../../utils/mail-config'
import { sendMailWithConfig } from '../../services/mail'
import { audit } from '../../services/audit'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const to = normalizeEmail(String(body?.to ?? ''))
  if (!EMAIL_RE.test(to)) {
    throw createError({ statusCode: 400, statusMessage: '收件人邮箱格式无效' })
  }

  const limit = checkEmailSend('test', to)
  if (!limit.allowed) throwEmailLimit(limit)

  if (!isMailConfigured()) {
    throw createError({ statusCode: 503, statusMessage: '邮件服务未配置' })
  }

  try {
    await sendMailWithConfig(getMailConfig(), {
      to,
      subject: '【监考收流平台】测试邮件',
      body: '<p>这是一封来自监考收流平台的测试邮件，如果你收到了它，说明邮件配置正常。</p>',
      html: true,
    })
  } catch (err) {
    audit('error', 'config', `mail test failed → ${to}`, {
      detail: { error: err instanceof Error ? err.message : String(err) },
    })
    throw createError({
      statusCode: 502,
      statusMessage: '发送失败：' + (err instanceof Error ? err.message : String(err)),
    })
  }

  audit('info', 'config', `mail test sent → ${to}`)
  return { ok: true }
})
