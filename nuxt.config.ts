// Nuxt 4 + Bun configuration for Constrainable Ingest
// SSR single-process app; API lives in server/, Vue UI in app/.
export default defineNuxtConfig({
  compatibilityDate: '2025-07-30',
  devtools: { enabled: true },
  ssr: true,

  // vue-sonner toast host: auto-registers the client-only <Toaster> component
  // (mounted once in app.vue) and injects vue-sonner/style.css. Pages fire
  // toasts via useToast() instead of a per-page element.
  modules: ['vue-sonner/nuxt'],

  // node-server preset. Socket.IO attaches to the same HTTP server via a
  // first-request lazy attach (server/middleware/00-socket.ts) — the Nitro
  // `listen` hook is NOT emitted by this preset, so we can't attach at startup.
  nitro: {
    preset: 'node-server',
    experimental: { tasks: false },
    // `bun:sqlite` is a Bun-only built-in (not an npm pkg, not a node: builtin),
    // so Rollup can't resolve it statically and warns "could not be resolved –
    // treating it as an external dependency". That's correct: it's resolved at
    // runtime by `bun`. Silence just that warning; keep Nitro's default filter
    // (CIRCULAR_DEPENDENCY / EVAL / unsupported sourcemap comments).
    rollupConfig: {
      onwarn(warning, warn) {
        const code = warning.code || ''
        if (code === 'UNRESOLVED_IMPORT' && warning.message?.includes('bun:sqlite')) return
        if (
          !['CIRCULAR_DEPENDENCY', 'EVAL'].includes(code) &&
          !warning.message.includes('Unsupported source map comment')
        ) {
          warn(warning)
        }
      },
    },
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
    public: {
      // browser-visible SRS host for playback URLs (your LAN/public IP)
      srsPublicHost: process.env.PUBLIC_HOST || '127.0.0.1',
      srsFlvPort: process.env.SRS_FLV_PORT || '8080',
      srsApiPort: process.env.SRS_API_PORT || '1985',
      srsRtmpPort: process.env.SRS_RTMP_PORT || '1935',
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
