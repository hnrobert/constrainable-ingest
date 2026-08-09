/**
 * users table — data access only. Auth/session reads. (kaleidodanmu-style
 * repository: pure Drizzle queries, no business logic, no HTTP errors.)
 */
import { eq } from 'drizzle-orm'
import { db } from '../database/db'
import { users, type User } from '../database/schema'

export const UsersRepository = {
  findById(id: number): User | undefined {
    return db.select().from(users).where(eq(users.id, id)).get()
  },
  findByUsername(username: string): User | undefined {
    return db.select().from(users).where(eq(users.username, username)).get()
  },
}
