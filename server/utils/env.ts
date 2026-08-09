/**
 * Centralized env reading. All server modules read config from here,
 * never directly from process.env. (Mirrors kaleidodanmu lib/env.ts.)
 */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',

  /** SQLite file path */
  dbPath: process.env.DB_PATH || './data/app.db',
  /** Recordings root dir */
  recordDir: process.env.RECORD_DIR || './records',

  /** Session signing secret */
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',

  /** SRS HTTP API base (server-to-server) */
  srsApiBase: process.env.SRS_API_BASE || 'http://127.0.0.1:1985/api/v1',
  /** SRS RTMP host (server-to-server, for ffprobe/ffmpeg pull) */
  srsRtmpHost: process.env.SRS_RTMP_HOST || '127.0.0.1',
  /** Browser-facing SRS ports (for viewer playback URLs) */
  srsFlvPort: Number(process.env.SRS_FLV_PORT || '8080'),
  srsApiPort: Number(process.env.SRS_API_PORT || '1985'),

  /** ffmpeg / ffprobe binaries */
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',

  /** Socket.IO standalone fallback port */
  socketPort: Number(process.env.SOCKET_PORT || '3001'),
  /** Browser-visible SRS host for playback URLs (LAN/public IP) */
  publicHost: process.env.PUBLIC_HOST || '127.0.0.1',

  /** First-boot admin credentials */
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
} as const

export type Env = typeof env
