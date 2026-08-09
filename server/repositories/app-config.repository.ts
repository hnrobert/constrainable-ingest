/**
 * app_config table — the single JSON row (key = 'app_config') that holds all
 * runtime config. Data access only.
 */
import { eq } from 'drizzle-orm'
import { db } from '../database/db'
import { appConfig, type AppConfigRow } from '../database/schema'

const KEY = 'app_config'

export const AppConfigRepository = {
  find(): AppConfigRow | undefined {
    return db.select().from(appConfig).where(eq(appConfig.key, KEY)).get()
  },
  /** Insert or update the config row (hot-reload write). */
  upsert(value: string): void {
    db.insert(appConfig)
      .values({ key: KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appConfig.key, set: { value, updatedAt: new Date() } })
      .run()
  },
}
