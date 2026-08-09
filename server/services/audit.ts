/**
 * Audit log writer. Persists via AuditLogRepository and emits an `audit:created`
 * event for the realtime panel. Business logic over the repository layer.
 */
import { AuditLogRepository } from '../repositories/audit-log.repository'
import { emit } from '../utils/bus'
import type { AuditCategory, AuditLevel } from '#shared/events'

export interface AuditInput {
  eventId?: number | null
  streamName?: string | null
  detail?: unknown
}

export function audit(
  level: AuditLevel,
  category: AuditCategory,
  message: string,
  opts: AuditInput = {},
): void {
  const row = AuditLogRepository.insert({
    level,
    category,
    message,
    eventId: opts.eventId ?? null,
    streamName: opts.streamName ?? null,
    detail: opts.detail != null ? JSON.stringify(opts.detail) : null,
  })

  emit('audit:created', {
    id: row.id,
    ts: row.ts.getTime(),
    level,
    category,
    eventId: row.eventId ?? null,
    streamName: row.streamName ?? null,
    message,
    detail: opts.detail,
  })
}
