/**
 * Participant push-streaming guide for one event, keyed by slug. Public surface
 * (allowlisted) but visibility-gated: public events need no session; registered
 * needs any login; groups needs membership. Draft/archived events 404 (no
 * existence leak). The payload is identical for every viewer of the same event:
 * it carries the shared publish key plus a hint to use each contestant's own
 * account email as the stream name.
 */
import { createError } from 'h3'
import { EventsRepository } from '../../../../repositories/events.repository'
import { GroupsRepository } from '../../../../repositories/groups.repository'
import { canViewEvent } from '../../../../services/groups'
import { getLimitsFor } from '../../../../utils/config-store'
import type { EventGuide } from '#shared/event-view'

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'missing slug' })

  const row = EventsRepository.findBySlug(slug)
  // Missing / draft / archived → 404 (don't leak that the event exists).
  if (!row || row.status === 'draft' || row.status === 'archived') {
    throw createError({ statusCode: 404, statusMessage: 'event not found' })
  }

  const groupIds = GroupsRepository.findGroupsForEvent(row.id).map((g) => g.id)
  if (!canViewEvent(event.context.auth, { visibility: row.visibility, groupIds })) {
    throw createError({ statusCode: 403, statusMessage: 'not authorized for this event' })
  }

  const cfg = useRuntimeConfig(event)
  const server = `rtmp://${cfg.public.srsPublicHost}:${cfg.public.srsRtmpPort}/live`

  return {
    name: row.name,
    slug: row.slug,
    server,
    publishKey: row.publishKey ?? null,
    streamNameHint: 'your account email',
    limits: getLimitsFor(row),
    startsAt: row.startsAt ? row.startsAt.getTime() : null,
    endsAt: row.endsAt ? row.endsAt.getTime() : null,
    streamGuide: row.streamGuide ?? null,
  } satisfies EventGuide
})
