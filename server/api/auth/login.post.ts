/** Login: verify credentials, set the signed session cookie, return the user. */
import { createError } from 'h3'
import { UsersRepository } from '../../repositories/users.repository'
import { verifyPassword } from '../../utils/password'
import { createSessionCookie } from '../../utils/session'
import { audit } from '../../services/audit'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const username = String(body?.username ?? '').trim()
  const password = String(body?.password ?? '')
  if (!username || !password) {
    throw createError({ statusCode: 400, statusMessage: 'username and password are required' })
  }

  const user = UsersRepository.findByUsername(username)
  const ok = user ? await verifyPassword(password, user.passwordHash) : false
  if (!user || !ok) {
    audit('warn', 'auth', `failed login: ${username}`, {})
    throw createError({ statusCode: 401, statusMessage: '用户名或密码错误' })
  }

  const cookie = await createSessionCookie(user.id, user.role)
  setCookie(event, cookie.name, cookie.value, cookie.options)
  audit('info', 'auth', `login: ${username}`, { detail: { userId: user.id } })
  return { id: user.id, username: user.username, role: user.role }
})
