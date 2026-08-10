/** Login: verify email + password, set the signed session cookie, return the user. */
import { createError } from 'h3'
import { UsersRepository } from '../../repositories/users.repository'
import { verifyPassword } from '../../utils/password'
import { createSessionCookie } from '../../utils/session'
import { audit } from '../../services/audit'
import { normalizeEmail } from '../../utils/registration'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const email = normalizeEmail(String(body?.email ?? ''))
  const password = String(body?.password ?? '')
  if (!email || !password) {
    throw createError({ statusCode: 400, statusMessage: '邮箱和密码不能为空' })
  }

  const user = UsersRepository.findByEmail(email)
  const ok = user ? await verifyPassword(password, user.passwordHash) : false
  if (!user || !ok) {
    audit('warn', 'auth', `failed login: ${email}`, {})
    throw createError({ statusCode: 401, statusMessage: '邮箱或密码错误' })
  }

  const cookie = await createSessionCookie(user.id, user.role)
  setCookie(event, cookie.name, cookie.value, cookie.options)
  audit('info', 'auth', `login: ${email}`, { detail: { userId: user.id } })
  return { id: user.id, email: user.email, role: user.role }
})
