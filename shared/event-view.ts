/**
 * Event catalog item + create/update input (mirrors server services/events.ts).
 * Visibility controls who may see an event; group scoping applies when
 * visibility === 'groups' (see event_groups).
 */
export type EventStatus = 'draft' | 'scheduled' | 'live' | 'ended' | 'archived'
export type EventVisibility = 'public' | 'registered' | 'groups'

export interface EventGroupRef {
  id: number
  name: string
}

export interface EventView {
  id: number
  name: string
  slug: string
  description: string | null
  startsAt: number | null
  endsAt: number | null
  status: EventStatus
  limitsOverride: Record<string, number | null> | null
  recordEnabled: boolean
  visibility: EventVisibility
  /** groups linked to this event (meaningful when visibility === 'groups'). */
  groups: EventGroupRef[]
  /** fingerprint (prefix) of the per-event publish token, or null if none set. */
  publishTokenPreview: string | null
  createdAt: number
  updatedAt: number
}

export interface EventInput {
  name?: string
  slug?: string
  description?: string | null
  startsAt?: number | null
  endsAt?: number | null
  status?: EventStatus
  limitsOverride?: Record<string, number | null> | null
  recordEnabled?: boolean
  visibility?: EventVisibility
  /** group ids to scope the event to (applied when visibility === 'groups'). */
  groupIds?: number[]
}
