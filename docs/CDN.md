# CDN Deployment Guide — Static Frontend + Remote API

How to deploy the frontend as pre-generated static pages on a CDN (Alibaba Cloud OSS + CDN, Tencent Cloud COS + CDN, or Cloudflare Pages) while the backend API runs on your own server. This gives sub-50ms page loads nationwide for 100+ concurrent users.

## Architecture

```
┌────────────────────────────────┐
│  CDN (frontend static pages)   │  ← nuxt generate output
│  e.g. cdn.example.com          │
│  Serves: HTML / JS / CSS       │
└──────────┬─────────────────────┘
           │ /api/*  /socket/*
           ▼
┌────────────────────────────────┐
│  Your server (backend API)     │  ← Nuxt server in Docker
│  e.g. api.example.com          │
│  Serves: API + Socket.IO + DB  │
└────────────────────────────────┘
```

## Step 1 — Generate static pages

```bash
bun run generate
```

Output: `.output/public/` (static HTML/JS/CSS/favicon). This directory is what you upload to the CDN.

> **Note:** Authenticated dashboard pages are client-rendered (SPA mode). The generate step pre-renders public pages (login, event guides, homepage) for instant loads. Dashboard pages load the shell then fetch data via API.

## Step 2 — Upload to CDN storage

### Alibaba Cloud (OSS + CDN)

1. Create an OSS bucket in the region closest to your users (e.g. `cn-beijing`)
2. Upload the generate output:

```bash
# Using ossutil
ossutil cp -r .output/public/ oss://your-bucket/ --update

# Or using the Alibaba Cloud console (drag and drop .output/public/* )
```

3. Enable static website hosting on the bucket:
   - Default homepage: `index.html`
   - Default 404: `index.html` (SPA fallback for client-side routes)

4. Add a CDN domain pointing to the bucket:
   - Acceleration domain: `cdn.example.com`
   - Origin: your OSS bucket
   - Cache settings:
     - `/_nuxt/**` → 30 days (hashed filenames, immutable)
     - `/index.html` → 60 seconds (must revalidate)
     - `/api/**` → no cache (if routing through CDN, see Step 3)

### Tencent Cloud (COS + CDN)

1. Create a COS bucket
2. Upload: `coscmd upload -r .output/public/ /`
3. Enable static website: index document `index.html`, error document `index.html`
4. Add CDN domain → origin: COS bucket → same cache rules as above

### Cloudflare Pages

```bash
bun run generate
# Push to Git → Cloudflare Pages → build command: bun run generate → output: .output/public
```

Cloudflare automatically handles SPA fallback and cache headers.

## Step 3 — Route API calls to your backend

The generated pages make API calls to relative paths (`/api/...`). You have two options:

### Option A: CDN origin rules (recommended — zero code changes)

Configure your CDN to NOT cache `/api/*` and `/socket/*` and instead forward them to your backend server:

**Alibaba Cloud CDN → Origin Rules:**
- Rule 1: `Path = /api/*` → origin: `http://your-server-ip:31954`, no cache
- Rule 2: `Path = /socket/*` → origin: `http://your-server-ip:31954`, no cache, enable WebSocket
- Rule 3: everything else → origin: OSS bucket, cache per Step 2

**Cloudflare → Page Rules / Workers:**
- `/api/*` → Resolve Override: `api.example.com`
- `/socket/*` → Resolve Override + WebSocket: on

With this approach, the frontend and API are same-origin from the user's perspective — no CORS, no cookie changes needed.

### Option B: Separate API domain + CORS

If your CDN doesn't support origin rules:

1. Set the API base URL at generate time:

```bash
# nuxt.config.ts → runtimeConfig
NUXT_PUBLIC_API_BASE=https://api.example.com bun run generate
```

2. Enable CORS on the backend:

```ts
// server/middleware/02-cors.ts (new file)
export default defineEventHandler((event) => {
  if (getRequestURL(event).pathname.startsWith('/api/')) {
    setHeader(event, 'access-control-allow-origin', 'https://cdn.example.com')
    setHeader(event, 'access-control-allow-credentials', 'true')
    setHeader(event, 'access-control-allow-headers', 'content-type')
    setHeader(event, 'access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS')
    if (getMethod(event) === 'OPTIONS') { setResponseStatus(event, 204) }
  }
})
```

3. Socket.IO client connects to the API domain:

```ts
// app/composables/useSocket.ts — change the io() call
io('https://api.example.com', { path: '/socket', ... })
```

4. Cookies need `SameSite=None; Secure` in `server/utils/session.ts` (requires HTTPS on both domains).

**Option A is strongly recommended** — it avoids all CORS/cookie complexity.

## Step 4 — Configure your backend

The backend server runs in Docker as usual:

```bash
# On your ECS/cloud server
PUBLIC_HOST=api.example.com \
SESSION_SECRET=long-random-string \
AUTHMOD_VERIFIER_SECRET=another-long-random-string \
docker compose -f docker/docker-compose.yml up server
```

If using Option A (CDN origin rules), no backend changes needed — the CDN proxies to the same origin.

## Step 5 — Verify

1. Visit `https://cdn.example.com` — page loads from CDN (check response headers for CDN cache hit)
2. Login — auth cookie is set (same-origin via CDN proxy, or cross-domain with CORS)
3. Open dashboard — real-time metrics flow via Socket.IO
4. Open an event guide (`/e/<slug>`) — loads from CDN, API data fetched from backend

## Cache purge after redeploys

When you deploy a new frontend version:

```bash
bun run generate
ossutil cp -r .output/public/ oss://your-bucket/ --update
# Purge CDN cache for index.html (hashed /_nuxt/ files don't need purging)
aliyun cdn RefreshObjectCaches --ObjectPath https://cdn.example.com/index.html --ObjectType File
```

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| API 404 from CDN | CDN not routing /api/* to backend | Check origin rules (Step 3A) |
| Login doesn't persist | Cookie blocked cross-domain | Use Option A (same-origin) or set `SameSite=None; Secure` |
| Socket.IO disconnects | CDN blocking WebSocket | Enable WebSocket pass-through on /socket/* rule |
| Page loads but data empty | API base URL wrong | Check `NUXT_PUBLIC_API_BASE` or CDN origin rules |
| Old version after deploy | CDN cache not purged | Purge index.html (hashed assets auto-update) |
