/**
 * users table — data access only. Auth/session reads + registration writes.
 * (kaleidodanmu-style repository: pure Drizzle queries, no business logic, no
 * HTTP errors.) Email is the unique login identifier. `isEmpty()` drives the
 * first-registrant-is-super-admin rule (and the bootstrap code-verification
 * exemption) in the auth handlers, not here.
 */
import { count, eq } from 'drizzle-orm'
import { db } from '../database/db'
import { users, type NewUser, type User } from '../database/schema'

export const UsersRepository = {
  findById(id: number): User | undefined {
    return db.select().from(users).where(eq(users.id, id)).get()
  },
  /** Email is normalized (trimmed + lowercased) before lookup. */
  findByEmail(email: string): User | undefined {
    return db.select().from(users).where(eq(users.email, email)).get()
  },
  count(): number {
    const row = db.select({ n: count() }).from(users).get()
    return row?.n ?? 0
  },
  /** True when no users exist yet → the next registrant becomes super admin. */
  isEmpty(): boolean {
    const row = db.select({ n: count() }).from(users).get()
    return (row?.n ?? 0) === 0
  },
  insert(values: NewUser): User {
    return db.insert(users).values(values).returning().get()
  },
}
