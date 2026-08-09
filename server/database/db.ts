/**
 * Drizzle + bun:sqlite singleton with TypeORM-style auto-sync.
 *
 * Instead of versioned migration files, `ensureDbReady()` runs `drizzle-kit push`
 * at startup: it diffs `schema.ts` against the live SQLite file and applies DDL
 * directly (create on a fresh DB, additive/alter on schema changes). This mirrors
 * TypeORM's `synchronize: true` and keeps the repo free of generated SQL files.
 *
 * The client itself is cached on globalThis (survives HMR).
 */
import { Database } from 'bun:sqlite'
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import * as schema from './schema'
import { env } from '../utils/env'

export type DB = BunSQLiteDatabase<typeof schema>

const globalForDb = globalThis as unknown as { __ingestDb?: DB; __ingestDbReady?: boolean }

function createClient(): DB {
  mkdirSync(dirname(env.dbPath), { recursive: true })
  const sqlite = new Database(env.dbPath, { create: true })
  sqlite.exec('PRAGMA journal_mode = WAL;')
  sqlite.exec('PRAGMA foreign_keys = ON;')
  sqlite.exec('PRAGMA busy_timeout = 5000;')
  sqlite.exec('PRAGMA synchronous = NORMAL;')
  return drizzle(sqlite, { schema })
}

/** Shared drizzle instance (auto-imported into server context as `db`). */
export const db: DB = (globalForDb.__ingestDb ??= createClient())

/**
 * Sync schema.ts → DB via `drizzle-kit push` (non-interactive). Idempotent:
 * a no-op when the schema already matches. Must run before seeding.
 */
export async function ensureDbReady(): Promise<void> {
  if (globalForDb.__ingestDbReady) return
  await syncSchemaViaPush()
  globalForDb.__ingestDbReady = true
}

async function syncSchemaViaPush(): Promise<void> {
  const proc = Bun.spawn({
    cmd: ['bun', 'x', 'drizzle-kit', 'push', '--config', 'drizzle.config.ts'],
    cwd: process.cwd(),
    stdin: 'ignore', // force non-interactive; safe changes apply, prompts can't hang
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const out = `${stdout}\n${stderr}`.trim()
  if (exitCode !== 0) {
    throw new Error(`drizzle-kit push failed (exit ${exitCode})\n${out}`)
  }
  // push's "Changes applied"/"No changes detected" banner is unreliable in
  // non-TTY mode, so we don't parse it. Use `bun run db:push` interactively
  // to see exactly what each sync does.
  console.log('[db] schema synced via drizzle-kit push')
}
