/**
 * Public-facing viewer catalog + playback URL builder (business logic). Viewers
 * are unauthenticated; passphrase-protected events require a per-event unlock
 * (signed `viewer` cookie, see session.ts). Playback URLs point the browser
 * straight at SRS (no proxy) using the browser-visible public host. DB access
 * goes through the repositories.
 */
import { createError, getCookie, type H3Event } from 'h3'
import { EventsRepository } from '../repositories/events.repository'
import { PublishSessionsRepository } from '../repositories/publish-sessions.repository'
import type { Event } from '../database/schema'
import { verifyPassword } from '../utils/password'
import { readViewerCookie } from '../utils/session'
import { env } from '../utils/env'

export interface ViewerEvent {
  id: number
  name: string
  slug: string
  description: string | null
  status: Event['status']
  viewerAccess: Event['viewerAccess']
  liveStreams: ViewerStream[]
}

export interface ViewerStream {
  streamName: string
  studentLabel: string | null
  width: number | null
  height: number | null
}

const VIEWABLE_STATUS: Event['status'][] = ['scheduled', 'live']

/** Events the public may see (scheduled/live) with their currently-live streams. */
export function listViewableEvents(): ViewerEvent[] {
  const evs = EventsRepository.findViewable(VIEWABLE_STATUS)
  if (evs.length === 0) return []

  const liveSessions = PublishSessionsRepository.findLiveForCatalog()

  return evs.map((e) => ({
    id: e.id,
    name: e.name,
    slug: e.slug,
    description: e.description,
    status: e.status,
    viewerAccess: e.viewerAccess,
    liveStreams: liveSessions
      .filter((s) => s.eventId === e.id)
      .map((s) => ({
        streamName: s.streamName,
        studentLabel: null,
        width: s.width ?? null,
        height: s.height ?? null,
      })),
  }))
}

/** event ids this viewer has unlocked via passphrase (from the signed cookie). */
export async function viewerUnlockedEvents(cookieValue?: string): Promise<Set<number>> {
  return new Set(await readViewerCookie(cookieValue))
}

/** Does the viewer have access to watch this event? */
export function viewerCanAccess(
  event: Pick<Event, 'id' | 'viewerAccess'>,
  unlocked: Set<number>,
): boolean {
  if (event.viewerAccess === 'public') return true
  return unlocked.has(event.id)
}

/** Verify a passphrase for an event; returns the event row (throws on failure). */
export async function verifyEventPassphrase(eventId: number, passphrase: string): Promise<Event> {
  const e = EventsRepository.findById(eventId)
  if (!e) throw createError({ statusCode: 404, statusMessage: 'event not found' })
  if (e.viewerAccess !== 'passphrase' || !e.viewerPassphraseHash) {
    throw createError({ statusCode: 400, statusMessage: 'event is not passphrase-protected' })
  }
  if (!(await verifyPassword(passphrase, e.viewerPassphraseHash))) {
    throw createError({ statusCode: 403, statusMessage: '口令错误' })
  }
  return e
}

/**
 * Resolve a viewer access request for the access endpoint. Public events need
 * no passphrase; passphrase events must verify. Returns the access mode; the
 * caller (handler) is responsible for setting the unlock cookie. Throws on any
 * failure (400/403/404).
 */
export async function requestViewerAccess(
  eventId: number,
  passphrase: string,
): Promise<{ viewerAccess: Event['viewerAccess'] }> {
  const e = EventsRepository.findById(eventId)
  if (!e) throw createError({ statusCode: 404, statusMessage: 'event not found' })
  if (e.viewerAccess === 'public') return { viewerAccess: 'public' }
  if (!passphrase) throw createError({ statusCode: 400, statusMessage: '口令不能为空' })
  await verifyEventPassphrase(eventId, passphrase)
  return { viewerAccess: 'passphrase' }
}

export interface StreamUrls {
  eventName: string
  streamName: string
  flv: string
  whep: string
}

const APP = 'live'

/** Absolute browser→SRS playback URLs for a stream. */
export function buildStreamUrls(eventName: string, streamName: string): StreamUrls {
  const host = env.publicHost
  const streamQ = encodeURIComponent(streamName)
  return {
    eventName,
    streamName,
    flv: `http://${host}:${env.srsFlvPort}/${APP}/${streamQ}.flv`,
    whep: `http://${host}:${env.srsApiPort}/rtc/v1/whep/?app=${APP}&stream=${streamQ}`,
  }
}

/**
 * Resolve playback URLs for the stream-url endpoint: loads the event, enforces
 * the viewer-access gate, then builds the FLV/WHEP URLs. Throws 403 if the
 * viewer hasn't unlocked a passphrase event.
 */
export function resolveStreamUrls(
  eventId: number,
  streamName: string,
  unlocked: Set<number>,
): StreamUrls {
  const e = EventsRepository.findById(eventId)
  if (!e) throw createError({ statusCode: 404, statusMessage: 'event not found' })
  if (!viewerCanAccess(e, unlocked)) {
    throw createError({ statusCode: 403, statusMessage: '需要口令' })
  }
  return buildStreamUrls(e.name, streamName)
}

/** helper for handlers: read the viewer unlocks off an h3 event. */
export async function readViewerUnlocks(event: H3Event): Promise<Set<number>> {
  return viewerUnlockedEvents(getCookie(event, 'viewer'))
}
