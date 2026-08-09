/** List all events (default first). */
import { listEvents } from '../../services/events'

export default defineEventHandler(() => listEvents())
