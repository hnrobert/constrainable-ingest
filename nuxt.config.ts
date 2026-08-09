// Nuxt 4 + Bun configuration for Constrainable Ingest
// SSR single-process app; API lives in server/, Vue UI in app/.
export default defineNuxtConfig({
  compatibilityDate: '2025-07-30',
  devtools: { enabled: true },
  ssr: true,

  // node-server preset ensures the Nitro `listen` hook fires so we can attach
  // Socket.IO to the underlying HTTP server (with a standalone-port fallback).
  nitro: {
    preset: 'node-server',
    experimental: { tasks: false },
  },

  runtimeConfig: {
    // server-only (overridable via NUXT_* env at runtime)
    sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
    dbPath: process.env.DB_PATH || './data/app.db',
    recordDir: process.env.RECORD_DIR || './records',
    srsApiBase: process.env.SRS_API_BASE || 'http://127.0.0.1:1985/api/v1',
    srsRtmpHost: process.env.SRS_RTMP_HOST || '127.0.0.1',
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
    socketPort: Number(process.env.SOCKET_PORT || '3001'),
    public: {
      // browser-visible SRS host for playback URLs (your LAN/public IP)
      srsPublicHost: process.env.PUBLIC_HOST || '127.0.0.1',
      srsFlvPort: process.env.SRS_FLV_PORT || '8080',
      srsApiPort: process.env.SRS_API_PORT || '1985',
      srsRtmpPort: process.env.SRS_RTMP_PORT || '1935',
      // Socket.IO: dev connects to a standalone port (listen hook doesn't fire
      // under `nuxt dev`); prod is same-origin (attached via the listen hook).
      socketPort: process.env.SOCKET_PORT || '3001',
    },
  },

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: 'Constrainable Ingest',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },
})
