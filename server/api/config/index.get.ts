/** Read the full runtime config. */
import { getCurrentConfig } from '../../services/config'

export default defineEventHandler(() => getCurrentConfig())
