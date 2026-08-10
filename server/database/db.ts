/**
 * Drizzle + bun:sqlite singleton with TypeORM-style auto-sync.
 *
 * Instead of versioned migration files, the schema is synced by `drizzle-kit
 * push`: it diffs `schema.ts` against the live SQLite file and applies DDL
 * directly (create on a fresh DB, additive/alter on schema changes). This
 * mirrors TypeORM's `synchronize: true` and keeps the repo free of generated
 * SQL files.
 *
 * The sync runs SYNCHRONOUSLY inside createClient(), at db.ts module load —
 * not as a top-level await (Nitro transpiles server code to es2019, which has
 * no top-level await) and not deferred to a Nitro plugin (too late). Some
 * server modules read `app_config` at import time (e.g. stream-lifecycle.ts
 * seeds its probe semaphore from getConfig() at module top-level), which
 * evaluates during bundle load, before any plugin. Because every config reader
 * imports `db`, ESM evaluation order guarantees createClient() — and thus the
 * schema — is ready before that first read. The client itself is cached on
 * globalThis (survives HMR), so the sync runs once.
 */
import { Database } from 'bun:sqlite'
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import * as schema from './schema'
import { env } from '../utils/env'

export type DB = BunSQLiteDatabase<typeof schema>

const globalForDb = globalThis as unknown as { __ingestDb?: DB; __ingestDbReady?: boolean }

/**
 * Sync schema.ts → DB via `drizzle-kit push` (synchronous, non-interactive).
 * Idempotent at the call site (guarded by `__ingestDbReady`). Safe changes
 * apply with stdin ignored; prompts can't hang.
 */
function syncSchema(): void {
  const r = Bun.spawnSync({
    cmd: ['bun', 'x', 'drizzle-kit', 'push', '--config', 'drizzle.config.ts'],
    cwd: process.cwd(),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  })
  if (r.exitCode !== 0) {
    const out = `${r.stdout?.toString() ?? ''}\n${r.stderr?.toString() ?? ''}`.trim()
    throw new Error(`drizzle-kit push failed (exit ${r.exitCode})\n${out}`)
  }
  // push's "Changes applied"/"No changes detected" banner is unreliable in
  // non-TTY mode, so we don't parse it. Use `bun run db:push` interactively
  // to see exactly what each sync does.
  console.log('[db] schema synced via drizzle-kit push')
}

/**
 * Idempotent data fixes that `drizzle-kit push` (pure DDL) can't express. Each
 * step guards on the current row state so it's a no-op once applied. Runs on
 * the raw sqlite handle right after syncSchema(), once per process.
 */
function runDataMigrations(sqlite: Database): void {
  // role enum narrowed admin|viewer → admin|user: convert legacy accounts.
  // SQLite CHECK constraints aren't retroactive on existing rows, so any
  // 'viewer' rows from before the enum change survive until rewritten here.
  try {
    const r = sqlite.run('UPDATE users SET role = ? WHERE role = ?', ['user', 'viewer'])
    if (r.changes > 0) console.log(`[db] migrated ${r.changes} legacy viewer→user role(s)`)
  } catch (err) {
    // E.g. a fresh DB where the users table exists but is empty — ignore.
    console.warn('[db] role migration skipped:', err instanceof Error ? err.message : err)
  }
}

function createClient(): DB {
  mkdirSync(dirname(env.dbPath), { recursive: true })
  const sqlite = new Database(env.dbPath, { create: true })
  sqlite.exec('PRAGMA journal_mode = WAL;')
  sqlite.exec('PRAGMA foreign_keys = ON;')
  sqlite.exec('PRAGMA busy_timeout = 5000;')
  sqlite.exec('PRAGMA synchronous = NORMAL;')
  // Tables must exist before this client is handed out (see file header).
  if (!globalForDb.__ingestDbReady) {
    syncSchema()
    runDataMigrations(sqlite)
    globalForDb.__ingestDbReady = true
  }
  return drizzle(sqlite, { schema })
}

/**
 * Shared drizzle instance (auto-imported into server context as `db`).
 * Evaluating this export runs createClient() — and thus the schema sync — at
 * module load, gating every transitive importer on the tables existing.
 */
export const db: DB = (globalForDb.__ingestDb ??= createClient())

/**
 * Ensure the schema is synced. In practice a no-op: createClient() already
 * synced synchronously at module load. Kept for the 00-db startup plugin
 * (which awaits it for the `[db] ready` log) and any explicit caller.
 */
export async function ensureDbReady(): Promise<void> {
  if (globalForDb.__ingestDbReady) return
  syncSchema()
  globalForDb.__ingestDbReady = true
}
