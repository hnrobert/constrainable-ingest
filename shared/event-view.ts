/**
 * Event catalog item + create/update input (mirrors server services/events.ts).
 * Visibility controls who may see an event; group scoping applies when
 * visibility === 'groups' (see event_groups).
 */
import type { Limits } from './config'

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
  /** fingerprint (prefix) of the shared publish key, or null if none set. */
  publishKeyPreview: string | null
  /** admin-authored custom instructions shown on the participant guide. */
  streamGuide: string | null
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
  /** admin-authored custom instructions shown on the participant guide. */
  streamGuide?: string | null
  /** group ids to scope the event to (applied when visibility === 'groups'). */
  groupIds?: number[]
}

/**
 * Participant push-streaming guide for one event. Identical for every viewer of
 * the same event. The stream key the contestant pastes into OBS is
 * `${streamNameHint}?token=${publishKey}` — the publish key is shared by the
 * whole class; the stream NAME is each contestant's own account email (unique,
 * so concurrent publishing works with one shared key).
 */
export interface EventGuide {
  name: string
  slug: string
  /** RTMP server URL the contestant enters in OBS (rtmp://host:1935/live). */
  server: string
  /** shared publish key (the ?token= value), or null if the organizer hasn't set one. */
  publishKey: string | null
  /** what the contestant uses as the OBS stream NAME (their account email). */
  streamNameHint: string
  /** recommended OBS output limits (global merged with the event override). */
  limits: Limits
  startsAt: number | null
  endsAt: number | null
  /** admin-authored custom instructions, or null. */
  streamGuide: string | null
}
