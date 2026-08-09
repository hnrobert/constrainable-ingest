/**
 * recordings table — data access only. Archived MP4 (or FLV fallback) metadata.
 * `filePath` is relative to RECORD_DIR; file I/O itself lives in the service.
 */
import { desc, eq, lt } from 'drizzle-orm'
import { db } from '../database/db'
import { recordings, type Recording, type NewRecording } from '../database/schema'

export const RecordingsRepository = {
  findAll(): Recording[] {
    return db.select().from(recordings).orderBy(desc(recordings.startedAt)).all()
  },
  findById(id: number): Recording | undefined {
    return db.select().from(recordings).where(eq(recordings.id, id)).get()
  },
  /** Retention sweep: recordings started before the cutoff date. */
  findExpired(cutoff: Date): Recording[] {
    return db.select().from(recordings).where(lt(recordings.startedAt, cutoff)).all()
  },
  insert(values: NewRecording): Recording {
    return db.insert(recordings).values(values).returning().get()
  },
  remove(id: number): void {
    db.delete(recordings).where(eq(recordings.id, id)).run()
  },
}
