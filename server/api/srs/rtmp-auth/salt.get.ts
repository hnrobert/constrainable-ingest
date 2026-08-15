/**
 * Stage-2 salt lookup for the RTMP gateway, plus the kick-ban flag: a kicked
 * publisher's OBS reconnects within seconds and its dance carries the account
 * email HERE — refusing at this stage with a fatal auth error (the gateway's
 * job) stops the reconnect loop at CONNECT time, before any publish attempt.
 * Unknown users get a random salt (byte-identical challenge, no enumeration).
 * Token-gated like the other /api/srs/rtmp-auth endpoints: never public.
 */
import { createError, getHeader, getQuery } from 'h3'
import { env } from '../../../utils/env'
import { UsersRepository } from '../../../repositories/users.repository'
import { isKickBanned, streamKeyForEmail } from '../../../services/kick-bans'

export default defineEventHandler((event) => {
  if (getHeader(event, 'x-rtmp-auth') !== env.rtmpAuthToken) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const email = String(getQuery(event).email ?? '').trim().toLowerCase()
  const user = email ? UsersRepository.findByEmail(email) : undefined
  const banned = !!email && isKickBanned(streamKeyForEmail(email))
  if (!user?.authmodSalt) {
    // random salt keeps the challenge shape identical for unknown users
    return { salt: randomSalt(), banned }
  }
  return { salt: user.authmodSalt, banned }
})

function randomSalt(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}
