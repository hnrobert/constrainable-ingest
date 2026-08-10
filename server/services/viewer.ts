/**
 * Public-facing event schedule (business logic). Ordinary registered users
 * (role 'viewer') and anonymous visitors see only event times — live streams
 * are monitored by admins/proctors, not from this page. DB access goes through
 * the repository.
 */
import { EventsRepository } from '../repositories/events.repository'
import type { Event } from '../database/schema'

export interface ViewerEvent {
  id: number
  name: string
  slug: string
  description: string | null
  status: Event['status']
  startsAt: number | null
  endsAt: number | null
}

const VIEWABLE_STATUS: Event['status'][] = ['scheduled', 'live']

/** Scheduled/live events with their time windows, for the public schedule. */
export function listViewableEvents(): ViewerEvent[] {
  return EventsRepository.findViewable(VIEWABLE_STATUS).map((e) => ({
    id: e.id,
    name: e.name,
    slug: e.slug,
    description: e.description,
    status: e.status,
    startsAt: e.startsAt ? e.startsAt.getTime() : null,
    endsAt: e.endsAt ? e.endsAt.getTime() : null,
  }))
}
