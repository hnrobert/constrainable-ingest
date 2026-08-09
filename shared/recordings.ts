/** Recording catalog item (GET /api/recordings, GET /api/recordings/:id). */
export interface RecordingView {
  id: number
  eventId: number | null
  sessionId: number | null
  streamName: string
  studentLabel: string | null
  filePath: string
  sizeBytes: number
  durationSec: number | null
  width: number | null
  height: number | null
  startedAt: number
  retainedUntil: number | null
  createdAt: number
}
