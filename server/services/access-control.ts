/**
 * Publish authorization. Called from on_publish BEFORE allowing a stream.
 *
 * OBS stream key = `${streamName}?token=${plaintext}` → SRS splits it into
 * `stream` = streamName and `param` = "?token=plaintext" in the on_publish body.
 *
 * Resolution: look up stream_keys by streamName → for each non-revoked key,
 * verify the token → on match, allow (and return event/student context).
 * No key at all: allowed only when access.rejectUnknownPublishers is false
 * (open-access mode; the session is recorded against no event).
 */
import { StreamKeysRepository } from '../repositories/stream-keys.repository'
import { EventsRepository } from '../repositories/events.repository'
import { EnrollmentsRepository } from '../repositories/enrollments.repository'
import { StudentsRepository } from '../repositories/students.repository'
import { getConfig } from '../utils/config-store'
import { verifyToken } from '../utils/token'

export interface AuthContext {
  stream: string
  param: string
}

export interface AuthAllow {
  allow: true
  eventId: number | null
  streamKeyId: number
  studentLabel: string | null
}
export interface AuthReject {
  allow: false
  reason: string
}

export type AuthResult = AuthAllow | AuthReject

export function parseToken(param: string): string | null {
  if (!param) return null
  const q = param.startsWith('?') ? param.slice(1) : param
  return new URLSearchParams(q).get('token')
}

export async function authorizePublish(ctx: AuthContext): Promise<AuthResult> {
  const cfg = getConfig()

  // All keys for this streamName (a reissue rotates in place; old ones revoked)
  const keys = StreamKeysRepository.findAllByStreamName(ctx.stream)

  if (keys.length === 0) {
    return cfg.access.rejectUnknownPublishers
      ? { allow: false, reason: 'unknown stream name' }
      : { allow: true, eventId: null, streamKeyId: -1, studentLabel: null }
  }

  const token = parseToken(ctx.param)
  if (!token) return { allow: false, reason: 'missing token' }

  for (const key of keys) {
    if (key.revoked) continue
    const ok = await verifyToken(token, key.tokenHash)
    if (!ok) continue

    const event = EventsRepository.findById(key.eventId)
    if (!event || event.status === 'archived') {
      return { allow: false, reason: 'event closed' }
    }

    // record last use + resolve student label
    StreamKeysRepository.touch(key.id)
    const studentLabel = resolveStudentLabel(key.enrollmentId)

    return {
      allow: true,
      eventId: event.id,
      streamKeyId: key.id,
      studentLabel,
    }
  }

  // keys exist but none matched (all revoked or bad token)
  return { allow: false, reason: keys.some((k) => !k.revoked) ? 'bad token' : 'key revoked' }
}

function resolveStudentLabel(enrollmentId: number | null): string | null {
  if (!enrollmentId) return null
  const enr = EnrollmentsRepository.findById(enrollmentId)
  if (!enr) return null
  const student = StudentsRepository.findById(enr.studentId)
  return student ? student.name : null
}
