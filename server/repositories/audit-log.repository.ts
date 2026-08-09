/**
 * audit_log table — data access only. Append-only; the service layer emits the
 * realtime `audit:created` event on top of the insert.
 */
import { db } from '../database/db'
import { auditLog, type AuditEntry, type NewAuditEntry } from '../database/schema'

export const AuditLogRepository = {
  insert(values: NewAuditEntry): AuditEntry {
    return db.insert(auditLog).values(values).returning().get()
  },
}
