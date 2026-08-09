/** Verify a viewer passphrase for an event; on success grant a viewer unlock. */
import { createError } from 'h3'
import { requestViewerAccess, readViewerUnlocks } from '../../services/viewer'
import { createViewerCookie } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const eventId = Number(body?.eventId)
  const passphrase = String(body?.passphrase ?? '')
  if (!Number.isInteger(eventId) || eventId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'eventId is required' })
  }

  const { viewerAccess } = await requestViewerAccess(eventId, passphrase)

  const unlocked = await readViewerUnlocks(event)
  const cookie = await createViewerCookie(eventId, [...unlocked])
  setCookie(event, cookie.name, cookie.value, cookie.options)
  return { ok: true, viewerAccess }
})
