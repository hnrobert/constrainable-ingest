/** Public catalog: scheduled/live events and their currently-live streams. */
import { listViewableEvents } from '../../services/viewer'

export default defineEventHandler(() => listViewableEvents())
