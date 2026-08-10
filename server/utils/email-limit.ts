/**
 * Rate limiting for outbound transactional emails — sliding-window counters keyed
 * per recipient address (and per flow): 1/minute, 10/day. Applied to every
 * user-initiated send (registration code, mail test) so one address can't be
 * spammed. In-memory, single-instance; counters are sliding windows of timestamps.
 *
 * Ported from unnc-freshmen-verifier-gateway/server/utils/emailLimit.ts (the
 * per-account dimension is dropped — this app has no per-user mail initiator; the
 * only authenticated send is the admin "test mail" which the per-target cap covers).
 */
import { createError } from 'h3'

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000

export const EMAIL_DAILY_LIMIT = 10
const TARGET_PER_MINUTE = 1

const minuteBuckets = new Map<string, number[]>()
const dayBuckets = new Map<string, number[]>()

/** Prune a bucket to timestamps still inside `windowMs` (and keep the map tight). */
function windowHits(bucket: Map<string, number[]>, key: string, windowMs: number, now: number): number[] {
  const arr = (bucket.get(key) ?? []).filter((t) => now - t < windowMs)
  bucket.set(key, arr)
  return arr
}

export interface EmailLimitResult {
  allowed: boolean
  /** Which cap was hit, when not allowed. */
  reason?: 'minute' | 'day'
  /** Daily send count for this key (including this attempt when allowed). */
  dailyCount: number
  /** Seconds until the per-minute cap resets (only when reason === 'minute'). */
  retryInSeconds?: number
}

/** Per-recipient cap for `flow` ('code' | 'test'). 1/min, 10/day. */
export function checkEmailSend(flow: string, email: string, now: Date = new Date()): EmailLimitResult {
  const t = now.getTime()
  const day = windowHits(dayBuckets, `target:${flow}:${email.toLowerCase()}`, DAY_MS, t)
  if (day.length >= EMAIL_DAILY_LIMIT) return { allowed: false, reason: 'day', dailyCount: day.length }
  const minute = windowHits(minuteBuckets, `target:${flow}:${email.toLowerCase()}`, MINUTE_MS, t)
  if (minute.length >= TARGET_PER_MINUTE) {
    const retry = Math.max(1, Math.ceil(((minute[0] ?? t) + MINUTE_MS - t) / 1000))
    return { allowed: false, reason: 'minute', dailyCount: day.length, retryInSeconds: retry }
  }
  minute.push(t)
  day.push(t)
  return { allowed: true, dailyCount: day.length }
}

/** Throw the HTTP error for a blocked send (wording for the UI). */
export function throwEmailLimit(r: EmailLimitResult): never {
  const statusMessage =
    r.reason === 'minute'
      ? `Sending too frequently — please wait ${r.retryInSeconds ?? 60} seconds and try again`
      : `Daily send limit reached (${EMAIL_DAILY_LIMIT}/day)`
  throw createError({ statusCode: 429, statusMessage })
}
