/**
 * Drizzle schema for constrainable-ingest (SQLite via bun:sqlite).
 *
 * One schema file mirroring kaleidodanmu's single-entities-file convention,
 * but expressed with Drizzle. Snake_case DB columns, camelCase TS accessors.
 */
import { sqliteTable, integer, text, real, index, unique, primaryKey } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

const now = sql`(unixepoch())`

/* ---------------------------------- users --------------------------------- */
// Email is the login identifier + verified at registration via a 6-digit code
// (see server/utils/email-code.ts). Mirrors unnc-freshmen-verifier-gateway.
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'viewer'] }).notNull().default('admin'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
})

/* ------------------------------- app_config ------------------------------- */
export const appConfig = sqliteTable('app_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // JSON
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
})

/* --------------------------------- events --------------------------------- */
export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description'),
    startsAt: integer('starts_at', { mode: 'timestamp' }),
    endsAt: integer('ends_at', { mode: 'timestamp' }),
    status: text('status', { enum: ['draft', 'scheduled', 'live', 'ended', 'archived'] })
      .notNull()
      .default('draft'),
    /** JSON: per-event limits override (null fields = inherit global) */
    limitsOverride: text('limits_override'),
    recordEnabled: integer('record_enabled', { mode: 'boolean' }).notNull().default(true),
    viewerAccess: text('viewer_access', { enum: ['public', 'passphrase'] })
      .notNull()
      .default('public'),
    viewerPassphraseHash: text('viewer_passphrase_hash'),
    /** argon2id hash of the per-event publish token (alternative to per-student stream keys). */
    publishTokenHash: text('publish_token_hash'),
    /** first chars of the plaintext token — indexed for on_publish prefix lookup. */
    publishTokenPrefix: text('publish_token_prefix'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
  },
  (t) => [
    index('events_status_idx').on(t.status),
    index('events_publish_token_prefix_idx').on(t.publishTokenPrefix),
  ],
)

/* -------------------------------- students -------------------------------- */
export const students = sqliteTable(
  'students',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** student ID */
    studentNumber: text('student_number').notNull().unique(),
    name: text('name').notNull(),
    email: text('email'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  },
)

/* ---------------------------- event_enrollments --------------------------- */
export const eventEnrollments = sqliteTable(
  'event_enrollments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    seatLabel: text('seat_label'),
    status: text('status', { enum: ['invited', 'active', 'absent', 'done'] })
      .notNull()
      .default('invited'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  },
  (t) => [
    unique('uq_enrollment_event_student').on(t.eventId, t.studentId),
    index('enrollment_event_idx').on(t.eventId),
    index('enrollment_student_idx').on(t.studentId),
  ],
)

/* ------------------------------- stream_keys ------------------------------ */
export const streamKeys = sqliteTable(
  'stream_keys',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    enrollmentId: integer('enrollment_id').references(() => eventEnrollments.id, {
      onDelete: 'set null',
    }),
    /** SRS stream name — what the publisher pushes as the RTMP stream key */
    streamName: text('stream_name').notNull(),
    /** argon2id hash of the secret token (OBS key = `${streamName}?token=...`) */
    tokenHash: text('token_hash').notNull(),
    /** first/last chars for display, e.g. `abcd…wxyz` */
    tokenPreview: text('token_preview').notNull(),
    revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  },
  (t) => [
    // hot path: on_publish resolves by streamName
    index('stream_keys_name_idx').on(t.streamName),
    unique('uq_stream_keys_event_name').on(t.eventId, t.streamName),
    index('stream_keys_event_idx').on(t.eventId),
  ],
)

/* ----------------------------- publish_sessions --------------------------- */
export const publishSessions = sqliteTable(
  'publish_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventId: integer('event_id').references(() => events.id, { onDelete: 'cascade' }),
    streamKeyId: integer('stream_key_id').references(() => streamKeys.id, {
      onDelete: 'set null',
    }),
    streamName: text('stream_name').notNull(),
    srsClientId: text('srs_client_id'),
    status: text('status', {
      enum: ['pending', 'allowed', 'rejected', 'compliant', 'violating', 'killed', 'ended'],
    })
      .notNull()
      .default('pending'),
    rejectReason: text('reject_reason'),
    width: integer('width'),
    height: integer('height'),
    fps: real('fps'),
    bitrateKbps: integer('bitrate_kbps'),
    compliant: integer('compliant', { mode: 'boolean' }).notNull().default(false),
    startedAt: integer('started_at', { mode: 'timestamp' }).notNull().default(now),
    endedAt: integer('ended_at', { mode: 'timestamp' }),
  },
  (t) => [
    index('sessions_status_event_idx').on(t.status, t.eventId),
    index('sessions_stream_name_idx').on(t.streamName),
    index('sessions_event_idx').on(t.eventId),
  ],
)

/* ------------------------------- recordings ------------------------------- */
export const recordings = sqliteTable(
  'recordings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventId: integer('event_id').references(() => events.id, { onDelete: 'cascade' }),
    sessionId: integer('session_id').references(() => publishSessions.id, {
      onDelete: 'set null',
    }),
    streamName: text('stream_name').notNull(),
    studentLabel: text('student_label'),
    /** path relative to RECORD_DIR */
    filePath: text('file_path').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    durationSec: real('duration_sec'),
    width: integer('width'),
    height: integer('height'),
    startedAt: integer('started_at', { mode: 'timestamp' }).notNull().default(now),
    retainedUntil: integer('retained_until', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  },
  (t) => [
    index('recordings_event_started_idx').on(t.eventId, t.startedAt),
    index('recordings_session_idx').on(t.sessionId),
    index('recordings_retained_idx').on(t.retainedUntil),
  ],
)

/* -------------------------------- audit_log ------------------------------- */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts', { mode: 'timestamp' }).notNull().default(now),
    level: text('level', { enum: ['info', 'warn', 'error'] }).notNull().default('info'),
    category: text('category', {
      enum: ['auth', 'publish', 'access', 'config', 'recording', 'system', 'admin'],
    }).notNull(),
    eventId: integer('event_id'),
    streamName: text('stream_name'),
    message: text('message').notNull(),
    /** JSON detail */
    detail: text('detail'),
  },
  (t) => [index('audit_ts_idx').on(t.ts), index('audit_event_idx').on(t.eventId)],
)

/* ------------------------------- relations -------------------------------- */
// Drizzle relations enable the relational query API (db.query.events.findMany({...})).
// Kept minimal; services mostly use SQL-style builders for hot paths.
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
export type Student = typeof students.$inferSelect
export type NewStudent = typeof students.$inferInsert
export type Enrollment = typeof eventEnrollments.$inferSelect
export type NewEnrollment = typeof eventEnrollments.$inferInsert
export type StreamKey = typeof streamKeys.$inferSelect
export type NewStreamKey = typeof streamKeys.$inferInsert
export type PublishSession = typeof publishSessions.$inferSelect
export type NewPublishSession = typeof publishSessions.$inferInsert
export type Recording = typeof recordings.$inferSelect
export type NewRecording = typeof recordings.$inferInsert
export type AuditEntry = typeof auditLog.$inferSelect
export type NewAuditEntry = typeof auditLog.$inferInsert
export type AppConfigRow = typeof appConfig.$inferSelect
