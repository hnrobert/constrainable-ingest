/** Verify a viewer passphrase for an event; on success grant a viewer unlock. */
import { createError } from 'h3'
import { requestViewerAccess, readViewerUnlocks } from '../../services/viewer'
import { createViewerCookie } from '../../utils/session'
import { getAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const eventId = Number(body?.eventId)
  const passphrase = String(body?.passphrase ?? '')
  if (!Number.isInteger(eventId) || eventId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'eventId is required' })
  }

  // Authenticated accounts bypass the passphrase; anonymous guests must supply it.
  const authenticated = !!getAuth(event)
  const { viewerAccess } = await requestViewerAccess(eventId, passphrase, authenticated)

  // Only anonymous guests need the per-event unlock cookie — a logged-in session
  // grants access on its own.
  if (!authenticated) {
    const unlocked = await readViewerUnlocks(event)
    const cookie = await createViewerCookie(eventId, [...unlocked])
    setCookie(event, cookie.name, cookie.value, cookie.options)
  }
  return { ok: true, viewerAccess, authenticated }
})
