/** Return absolute FLV + WHEP playback URLs for a stream, after access check. */
import { createError } from 'h3'
import { resolveStreamUrls, readViewerUnlocks } from '../../services/viewer'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const eventId = Number(q.eventId)
  const streamName = String(q.streamName ?? '').trim()
  if (!Number.isInteger(eventId) || eventId <= 0 || !streamName) {
    throw createError({ statusCode: 400, statusMessage: 'eventId and streamName are required' })
  }

  const unlocked = await readViewerUnlocks(event)
  return resolveStreamUrls(eventId, streamName, unlocked)
})
