/**
 * Generate or rotate the per-event publish token. Returns the plaintext token
 * ONCE (only the hash + prefix are persisted). Admin-gated by the middleware.
 */
import { createError } from 'h3'
import { rotatePublishToken } from '../../../services/events'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid event id' })
  }
  return rotatePublishToken(id)
})
