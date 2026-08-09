/**
 * Open registration. Auto-allowlisted (lives under /api/auth/). The FIRST user
 * to register (empty users table) becomes the super admin (role 'admin'); every
 * later registrant is a 'viewer' — they can authenticate and watch /viewer
 * streams without a passphrase, but cannot reach the admin panel (the 01-auth
 * gate admits only admin sessions). On success the session cookie is set so the
 * caller is logged in immediately.
 */
import { createError } from 'h3'
import { UsersRepository } from '../../repositories/users.repository'
import { hashPassword } from '../../utils/password'
import { createSessionCookie } from '../../utils/session'
import { audit } from '../../services/audit'

const MAX_USERNAME = 32
const MIN_PASSWORD = 4

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const username = String(body?.username ?? '').trim()
  const password = String(body?.password ?? '')

  if (!username) {
    throw createError({ statusCode: 400, statusMessage: '用户名不能为空' })
  }
  if (username.length > MAX_USERNAME) {
    throw createError({ statusCode: 400, statusMessage: `用户名最长 ${MAX_USERNAME} 个字符` })
  }
  if (password.length < MIN_PASSWORD) {
    throw createError({ statusCode: 400, statusMessage: `密码至少 ${MIN_PASSWORD} 位` })
  }

  if (UsersRepository.findByUsername(username)) {
    throw createError({ statusCode: 409, statusMessage: '用户名已存在' })
  }

  const isFirst = UsersRepository.isEmpty()
  const role = isFirst ? 'admin' : 'viewer'
  const passwordHash = await hashPassword(password)
  const user = UsersRepository.insert({ username, passwordHash, role })

  const cookie = await createSessionCookie(user.id, user.role)
  setCookie(event, cookie.name, cookie.value, cookie.options)
  audit('info', 'auth', `register: ${username} (${role})`, {
    detail: { userId: user.id, role, first: isFirst },
  })
  return { id: user.id, username: user.username, role: user.role }
})
