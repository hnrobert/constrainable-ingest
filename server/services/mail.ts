/**
 * Outbound transactional email. Two transports, picked by `config.provider`:
 *   - 'smtp': Nodemailer direct SMTP (implicit-TLS `secure` for :465, or
 *     STARTTLS `requireTLS` for :587/:25; auth only when usePassword).
 *   - 'post': HTTP POST webhook relaying to a downstream mailer — two payload
 *     schemas, 'smtogo' ({from,to,subject,html}) and 'powerautomate'
 *     ({email,content,subject}).
 *
 * Ported from unnc-freshmen-verifier-gateway/server/utils/mail.ts (TypeORM
 * removed; MailConfig comes from shared/mail.ts via mail-config.ts).
 */
import { randomBytes } from 'node:crypto'
import nodemailer from 'nodemailer'
import type { MailConfig } from '#shared/mail'
import { EMAIL_RE } from '../utils/registration'

export interface SendMailInput {
  to: string
  subject: string
  body: string
  /** Send `body` as text/html instead of text/plain. */
  html?: boolean
}

/** Envelope From. When authenticated it must match the SMTP login (senderEmail);
 *  the display name is what the recipient sees. */
function fromAddress(c: MailConfig): string {
  const display = c.senderDisplay.trim()
  if (c.usePassword) {
    return display && display !== c.senderEmail ? `${display} <${c.senderEmail}>` : c.senderEmail
  }
  return display || c.senderEmail
}

function validate(c: MailConfig, input: SendMailInput): void {
  if (!EMAIL_RE.test(input.to)) throw new Error('Invalid recipient email format')
  if (input.to.length > c.maxLenRecipientEmail) {
    throw new Error(`Recipient email too long (max ${c.maxLenRecipientEmail})`)
  }
  if (input.subject.length > c.maxLenSubject) {
    throw new Error(`Subject too long (max ${c.maxLenSubject})`)
  }
}

/** Send via HTTP POST webhook (provider 'post'). */
async function sendViaPost(c: MailConfig, input: SendMailInput): Promise<string> {
  if (!c.postUrl) throw new Error('Webhook URL not configured')
  validate(c, input)
  const payload =
    c.postSchema === 'powerautomate'
      ? { email: input.to, subject: input.subject, content: input.body }
      : { from: fromAddress(c), to: input.to, subject: input.subject, html: input.body }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (c.postAuthToken) headers.Authorization = `Bearer ${c.postAuthToken}`
  const res = await fetch(c.postUrl, { method: 'POST', headers, body: JSON.stringify(payload) })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Webhook returned ${res.status}${detail ? ': ' + detail.slice(0, 200) : ''}`)
  }
  return `<post-${randomBytes(8).toString('hex')}@webhook>`
}

/** Send using an explicit config. Returns the message id. */
export async function sendMailWithConfig(c: MailConfig, input: SendMailInput): Promise<string> {
  if (c.provider === 'post') return sendViaPost(c, input)
  if (!c.host) throw new Error('SMTP server not configured')
  validate(c, input)
  const transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.useSsl, // implicit TLS (direct socket TLS, e.g. :465)
    requireTLS: c.useTls, // force STARTTLS (e.g. :587/:25)
    auth: c.usePassword ? { user: c.senderEmail, pass: c.senderPassword } : undefined,
  })
  try {
    const info = await transporter.sendMail({
      from: fromAddress(c),
      to: input.to,
      subject: input.subject,
      messageId: c.senderDomain ? `<${randomBytes(12).toString('hex')}@${c.senderDomain}>` : undefined,
      ...(input.html ? { html: input.body } : { text: input.body }),
    })
    return info.messageId
  } finally {
    transporter.close()
  }
}
