# Constrainable Ingest

ICPC-style online-proctoring **stream-ingest + management platform** for SRS. A rewrite of a Python/Flask gatekeeper (`server_for_icpc/check_server.py`) into a full-stack **Nuxt 4 + Bun + TypeScript** app: an admin panel (events, roster, stream keys, realtime monitoring, recordings, config) and a public viewer page, with persistent SQLite storage, passphrase/auth gating, and one-command Docker deployment.

The app is the **orchestration layer** — SRS (RTMP ingest) and ffmpeg/ffprobe (probe/record) remain external. It preserves the original behaviour: allow publish immediately → async ffprobe → kick streams over limit → record compliant streams to MP4, discard non-compliant.

## Stack

| Layer | Choice |
| --- | --- |
| Runtime / framework | **Nuxt 4** (`app/`) on **Bun**, Nitro `node-server` preset, SSR single process |
| DB | **SQLite** (`bun:sqlite`) + **Drizzle ORM**, `drizzle-kit push` auto-sync (no migration files) |
| Auth | Admin login (argon2id, HttpOnly signed cookie) + viewer passphrase gate |
| Realtime | **Socket.IO**, same-origin on the app HTTP server (lazy-attach; dev + prod) |
| Media | SRS (RTMP) + HTTP-FLV playback (mpegts.js) with optional WebRTC (WHEP) |
| Deploy | `docker compose`: `app` + `srs` (ossrs/srs:6), single machine, intranet, HTTP |

## Quick start (dev)

```bash
bun install
bun run dev          # http://localhost:31954  (socket.io, same-origin)
```

On first boot the DB auto-syncs its **schema** (`drizzle-kit push`) but seeds **nothing** — there is no `ADMIN_PASSWORD` env. Register at the panel to create the admin: when no users exist the app is in **bootstrap mode** and the first registration becomes the super-admin (the email allowlist is bypassed). Events, roster, and stream keys are then created through the UI.

## Production (Docker)

Single machine, intranet, no reverse proxy, no TLS. Set your LAN/public IP as `PUBLIC_HOST` (used for WebRTC candidate + viewer playback URLs):

```bash
cd docker
echo "PUBLIC_HOST=192.168.1.10"            >> .env
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d --build
```

| Port | Service | Purpose |
| --- | --- | --- |
| 31954 | app | admin panel + API (SSR) + Socket.IO (same origin) |
| 1935 | srs | RTMP ingest (OBS target) |
| 8080 | srs | HTTP-FLV playback (browser → SRS) |
| 1985 | srs | HTTP API + WHEP |
| 8000/udp | srs | WebRTC (optional) |

`docker/srs-entrypoint.sh` substitutes the WebRTC `candidate` from `PUBLIC_HOST` into `srs.conf` at startup (the stock ossrs image won't envsubst a mounted config). http_hooks point at the compose hostname `app:31954`.

## End-to-end smoke test (OBS → SRS → app)

This is the deploy-time verification the code can't self-test (needs OBS + a camera/LAN). With `docker compose up` running:

1. **Create an event + roster + keys.** Log in (`http://<PUBLIC_HOST>:31954`), go to **Events**, create an event, paste a CSV roster (`student_id,name[,email][,seat]`), and **bulk-generate** keys. Copy a student's OBS config: server `rtmp://<PUBLIC_HOST>:1935/live`, key `<streamName>?token=…`.
2. **Push from OBS** to that RTMP URL. The **Realtime** tab should show a session + live metrics within seconds (Socket.IO).
3. **Exceed a limit** (e.g. raise resolution past the configured max). The panel shows a violation toast, SRS kicks the stream, and the non-compliant stream is **not** archived.
4. **Stop OBS.** A compliant session produces an MP4 under `records/<date>/`, appears in **Recordings**, and plays inline (HTTP Range) / downloads.
5. **Hot-reload limits** in **Config** — new pushes use the new thresholds without a restart.
6. **Reject off-roster** — push with an unknown/revoked token: `on_publish` returns `200` body `"1"` and SRS drops the stream (audited).
7. **Viewer** — open `http://<PUBLIC_HOST>:31954/viewer`, pick the live event (enter its passphrase if protected), and watch via FLV (WebRTC toggle optional). The browser connects to SRS directly (CORS handled by `srs.conf`).
8. **Retention** — set `retentionDays`; the next sweep deletes older recordings (audited).

## Automated load / stress testing

`scripts/stress-streams.ts` emulates many OBS clients from one machine (a looped clip pushed with `-c copy`, so each pusher uses ~zero CPU) and reports how many streams are actually publishing, app-side sessions/compliance, and the app container's CPU/memory. See **[docs/STREAMING.md](docs/STREAMING.md)** for the full ingest architecture, the harness flags, and the measured capacity.

```bash
docker compose -f docker/docker-compose.yml up -d --build   # stack must be running
bun run stress --count 20 --hold 15                          # real auth path (argon2id)
bun run stress --ramp 10,25,50,75,100 --mode open --hold 15  # raw ingest capacity
```

**Measured on a single machine (open mode):** clean linear scaling to **~100–150 concurrent streams**; ceiling ~200–250 where SRS's single CPU core saturates. Auth mode scales lower (~15–20 simultaneous *new* publishers) because each publish does a synchronous argon2id verify — see STREAMING.md for numbers, bottlenecks, and the SRS-API measurement gotchas.

## Layout

```bash
app/          Vue UI (pages, components, composables, layouts, middleware)
server/       Nitro: api/, services/, database/ (schema + Drizzle), plugins/, middleware/, utils/
shared/       types shared between app and server (config, events, event-view, recordings)
docker/       Dockerfile, docker-compose.yml, srs.conf, srs-entrypoint.sh
```

## Notes

- **HTTP-only intranet:** session cookies are HttpOnly + SameSite=Lax, no `Secure`. Threat model assumes a trusted internal network; sniffing risk is documented and accepted.
- **Stream tokens** are returned **once** at generation (argon2id hash stored). Re-issuing a key for the same `(event, streamName)` rotates the token in place and clears any revoke.
- `drizzle-kit push` runs at startup (auto-sync, no migration files) — schema is the source of truth. Under Bun this requires **`@libsql/client`** (installed in the image); `better-sqlite3` is a NAPI addon that crashes Bun on linux/arm64. `db.ts` verifies the schema synced at boot and refuses to start otherwise.
- **Capacity & testing:** see **[docs/STREAMING.md](docs/STREAMING.md)** — ingest architecture, the `scripts/stress-streams.ts` harness, measured concurrent-stream limits, and the SRS-API measurement gotchas.
