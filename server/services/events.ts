/**
 * Event CRUD (business logic). An event scopes a set of students/keys/sessions/
 * recordings. DB access goes through EventsRepository; this layer owns slug
 * derivation, validation, passphrase hashing, DTO mapping, and audit.
 */
import { createError } from 'h3'
import { EventsRepository } from '../repositories/events.repository'
import type { Event } from '../database/schema'
import { limitsOverrideSchema, type LimitsOverride } from '#shared/config'
import { hashPassword } from '../utils/password'
import { generateToken, hashToken } from '../utils/token'
import { audit } from './audit'

export interface EventView {
  id: number
  name: string
  slug: string
  description: string | null
  startsAt: number | null
  endsAt: number | null
  status: Event['status']
  limitsOverride: LimitsOverride | null
  recordEnabled: boolean
  viewerAccess: Event['viewerAccess']
  hasViewerPassphrase: boolean
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
  status?: Event['status']
  limitsOverride?: LimitsOverride | null
  recordEnabled?: boolean
  viewerAccess?: Event['viewerAccess']
  /** plaintext passphrase to set (empty string clears it); never returned */
  viewerPassphrase?: string
}

function toView(e: Event): EventView {
  return {
    id: e.id,
    name: e.name,
    slug: e.slug,
    description: e.description,
    startsAt: e.startsAt ? e.startsAt.getTime() : null,
    endsAt: e.endsAt ? e.endsAt.getTime() : null,
    status: e.status,
    limitsOverride: e.limitsOverride ? (JSON.parse(e.limitsOverride) as LimitsOverride) : null,
    recordEnabled: e.recordEnabled,
    viewerAccess: e.viewerAccess,
    hasViewerPassphrase: !!e.viewerPassphraseHash,
    publishTokenPreview: e.publishTokenPrefix ?? null,
    createdAt: e.createdAt.getTime(),
    updatedAt: e.updatedAt.getTime(),
  }
}

function getRow(id: number): Event {
  const row = EventsRepository.findById(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'event not found' })
  return row
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function toTs(ms: number | null | undefined): Date | null {
  if (ms == null) return null
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d
}

function ensureSlugUnique(slug: string, exceptId?: number): void {
  if (EventsRepository.findBySlugExcept(slug, exceptId)) {
    throw createError({ statusCode: 409, statusMessage: 'slug already used' })
  }
}

export function listEvents(): EventView[] {
  return EventsRepository.findAll().map(toView)
}

export function getEvent(id: number): EventView {
  return toView(getRow(id))
}

export function createEvent(input: EventInput): EventView {
  const name = (input.name ?? '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name is required' })
  const slug = slugify(input.slug ?? name)
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'could not derive a valid slug' })
  ensureSlugUnique(slug)

  const limitsOverride =
    input.limitsOverride != null ? JSON.stringify(limitsOverrideSchema.parse(input.limitsOverride)) : null

  const row = EventsRepository.insert({
    name,
    slug,
    description: input.description ?? null,
    startsAt: toTs(input.startsAt),
    endsAt: toTs(input.endsAt),
    status: input.status ?? 'draft',
    limitsOverride,
    recordEnabled: input.recordEnabled ?? true,
    viewerAccess: input.viewerAccess ?? 'public',
  })

  audit('info', 'admin', `event created: ${name}`, { eventId: row.id, detail: { slug } })
  return toView(row)
}

export async function updateEvent(id: number, patch: EventInput): Promise<EventView> {
  const existing = getRow(id)
  const set: Record<string, unknown> = { updatedAt: new Date() }

  if (patch.name != null) {
    const name = patch.name.trim()
    if (!name) throw createError({ statusCode: 400, statusMessage: 'name cannot be empty' })
    set.name = name
  }
  if (patch.slug != null) {
    const slug = slugify(patch.slug)
    if (!slug) throw createError({ statusCode: 400, statusMessage: 'invalid slug' })
    if (slug !== existing.slug) ensureSlugUnique(slug, id)
    set.slug = slug
  }
  if (patch.description !== undefined) set.description = patch.description
  if (patch.startsAt !== undefined) set.startsAt = toTs(patch.startsAt)
  if (patch.endsAt !== undefined) set.endsAt = toTs(patch.endsAt)
  if (patch.status != null) set.status = patch.status
  if (patch.recordEnabled != null) set.recordEnabled = patch.recordEnabled
  if (patch.viewerAccess != null) set.viewerAccess = patch.viewerAccess
  if (patch.viewerPassphrase !== undefined) {
    const pp = patch.viewerPassphrase.trim()
    set.viewerPassphraseHash = pp ? await hashPassword(pp) : null
  }
  if (patch.limitsOverride !== undefined) {
    set.limitsOverride =
      patch.limitsOverride == null ? null : JSON.stringify(limitsOverrideSchema.parse(patch.limitsOverride))
  }

  EventsRepository.update(id, set)
  audit('info', 'admin', `event updated: ${existing.name}`, {
    eventId: id,
    detail: { fields: Object.keys(set) },
  })
  return toView(getRow(id))
}

export function deleteEvent(id: number): void {
  const existing = getRow(id)
  EventsRepository.remove(id)
  audit('warn', 'admin', `event deleted: ${existing.name}`, { eventId: id })
}

/**
 * Generate (or rotate) the per-event publish token. The plaintext is returned
 * ONCE; only its argon2id hash + an 8-char prefix (for on_publish lookup and
 * display) are stored. A publisher may then push
 * `${streamName}?token=${publishToken}` inside the event's time window.
 */
export async function rotatePublishToken(id: number): Promise<{ token: string; preview: string }> {
  const existing = getRow(id)
  const token = generateToken()
  const hash = await hashToken(token)
  const prefix = token.slice(0, 8)
  EventsRepository.update(id, {
    publishTokenHash: hash,
    publishTokenPrefix: prefix,
    updatedAt: new Date(),
  })
  audit('info', 'admin', `publish token rotated: ${existing.name}`, { eventId: id })
  return { token, preview: prefix }
}

/** Clear (revoke) the per-event publish token. */
export function clearPublishToken(id: number): void {
  const existing = getRow(id)
  EventsRepository.update(id, {
    publishTokenHash: null,
    publishTokenPrefix: null,
    updatedAt: new Date(),
  })
  audit('warn', 'admin', `publish token cleared: ${existing.name}`, { eventId: id })
}
