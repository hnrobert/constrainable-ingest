/**
 * Publish-key policy for the RTMP gateway. The gateway calls this at PUBLISH
 * time — the earliest moment the stream key is known — for two decisions:
 *   - `publishKey`: is this token an event publish key? If not (per-student key
 *     / per-event token), the gateway relays the stream name VERBATIM and SRS'
 *     own on_publish paths apply unchanged.
 *   - `requireAccountAuth`: for publish-key events — may a connection that
 *     skipped the authmod dance publish this key?
 * Token-gated like the other /api/srs/rtmp-auth endpoints: never public.
 */
import { createError, getHeader, getQuery } from 'h3'
import { env } from '../../../utils/env'
import { EventsRepository } from '../../../repositories/events.repository'

export default defineEventHandler((event) => {
  if (getHeader(event, 'x-rtmp-auth') !== env.rtmpAuthToken) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const token = String(getQuery(event).token ?? '')
  const row = token ? EventsRepository.findByPublishKey(token) : undefined
  return { publishKey: !!row, requireAccountAuth: row?.requireAccountAuth ?? false }
})
