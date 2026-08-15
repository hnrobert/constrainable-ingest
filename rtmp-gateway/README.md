# rtmp-gateway

An RTMP front-proxy in front of SRS. It enforces **per-event account authentication** (website email + login password via OBS' native "Use authentication" fields) for events that opt in — on a **single URL** (`rtmp://host/live`) shared by auth and no-auth events alike.

- **Account auth** (who may push) lives **here**, via the Adobe RTMP `authmod=adobe` challenge-response — OBS' Username/Password fields finally do something real. The password never travels; the gateway verifies a response the client computes from a server-issued salt.
- **Event auth** (which event, in-window?) still happens at **SRS' `on_publish` hook → `authorizePublish`**, unchanged. The gateway replays OBS' stream key (`<email>?token=<publishKey>`) verbatim to SRS, so the `?token=` path keeps working exactly as before.

Pure Go standard library — no external dependencies. Build with `go build`, ship as a tiny distroless container.

## How single-URL per-event auth works

Three verified facts about OBS' vendored librtmp shape the design:

1. Clients **never volunteer credentials** in the connect command — verified by capturing a real OBS connect (see `capture.go`); the dance can only be triggered by an `_error` answering a still-pending `connect`.
2. A client answers the challenge **only when BOTH username and password are configured** — OBS' fork has an explicit guard; without credentials it fails outright (no empty-user fallback, unlike rtmpdump).
3. The stream key naming the event only arrives at `publish`, after connect.

So **everyone keeps "Use authentication" ON in OBS** — auth events: real account credentials; no-auth events: anything non-empty (e.g. `live`/`live`) — and the gateway challenges every connection with **graceful verification**:

| conn | OBS sends (`app` field) | Gateway replies |
|------|--------------------------|-----------------|
| 1 | `live` | `_error "authmod=adobe&code=403 need auth"` (challenge) |
| 2 | `live?authmod=adobe&user=<email>` | `_error "?reason=needauth&...&salt=<S>&opaque=<O>"` |
| 3 | `live?...&challenge=<C>&response=<R>` | verify via app → `_result` **either way**: match → `authed`; miss/unknown user → accepted unauthenticated |

A failed verification is not fatal because OBS cannot re-authenticate mid-session — rejection happens at `publish`, where the per-event policy (below) finally knows the event. The whole exchange is internal to librtmp; contestants just see a normal connect.

**Enforcement happens at `publish`**, the only point where the stream key — and hence the event — is known. The OBS stream key is the publish key ALONE (no username prefix); the gateway asks the app (`GET /api/srs/rtmp-auth/policy?token=`) what kind of token it is and derives the stream NAME itself:

- auth-requiring key + unauthenticated connection (wrong/absent credentials) → rejected (`NetStream.Publish.BadName`)
- auth-requiring key + authed connection → relays as `<authenticated-email>?token=<key>` (an explicit `<name>?token=` prefix must match the authenticated email — no impersonation)
- no-auth key → relays as `<name>?token=<key>` with `<name>` = explicit prefix, else the authenticated email when authed, else a stable name from the client IP (`ip-192.168.50.27`) — concurrent publishers stay unique without any username in the key
- unknown token (per-student key, per-event publish token) → relayed VERBATIM; SRS' own on_publish paths apply unchanged

SRS' `on_publish` hook and session attribution see the same `<name>?token=<key>` format as before, so nothing downstream changes.

The participant guide (`/e/<slug>`) always shows the same `rtmp://host/live` and the bare key; auth events additionally show the "Use authentication" block.

librtmp computes, locally: `salted2 = base64(md5(user+salt+password))`, `response = base64(md5(salted2 + opaque + challenge))`. Only the app can verify this, because it stored `salted2` (AES-encrypted at rest) at registration — see `server/utils/authmod.ts`. Unknown users get a random salt so the challenge is byte-identical and stage 3 simply fails (no enumeration via the dance).

## Configuration (environment)

| var | default | meaning |
|-----|---------|---------|
| `RTMP_LISTEN` | `:1935` | Address the gateway listens on (OBS points here). |
| `SRS_ADDR` | `localhost:1935` | Where to relay media (`host:port`). |
| `APP_BASE` | `http://localhost:31954` | The Nuxt app base URL (for salt/verify/policy). |
| `RTMP_AUTH_TOKEN` | _(none — must set)_ | Shared secret; must equal the app's `RTMP_AUTH_TOKEN`. |
| `CAPTURE` | _(off)_ | `CAPTURE=1` runs the diagnostic dump server instead (see `capture.go`). |

The gateway calls three internal, token-gated app endpoints (never public, never session-auth) — see `server/api/srs/rtmp-auth/`:

- `GET  /api/srs/rtmp-auth/salt?email=` → `{ salt }` (404 unknown)
- `POST /api/srs/rtmp-auth/verify` `{email, opaque, challenge, response}` → `{ allow }`
- `GET  /api/srs/rtmp-auth/policy?token=` → `{ publishKey, requireAccountAuth }`

`verify` is a **password-equivalent oracle** — it is reachable only behind the `RTMP_AUTH_TOKEN` header (and, in production, network isolation between the gateway and the app). Never expose it publicly.

## Run (dev)

The gateway owns RTMP's default port 1935 so contestants use a portless `rtmp://host/live`. In dev that means remapping SRS off 1935 and letting the gateway take it. Hybrid setup (app on the host via `bun run dev`, SRS in Docker, gateway on the host via `go run`):

```bash
# 1. app on the host, with the shared RTMP-auth token set:
RTMP_AUTH_TOKEN=dev-insecure-rtmp-token bun run dev

# 2. SRS in Docker, remapped to host :11935 (off 1935) via the dev override:
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up srs

# 3. the gateway on :1935, relaying to SRS on :11935, auth against the app:
RTMP_LISTEN=:1935 \
SRS_ADDR=localhost:11935 \
APP_BASE=http://localhost:31954 \
RTMP_AUTH_TOKEN=dev-insecure-rtmp-token \
go run ./rtmp-gateway
```

Then in OBS (any event — the URL and key format are always the same):

- **Server:** `rtmp://localhost/live` (no port — 1935 is the RTMP default)
- **Stream key:** `<publishKey>` (the key alone — no username prefix)
- **Use authentication:** ✅ ALWAYS on (required — OBS won't connect through the challenge otherwise). Auth-required events: your account email + website password. Other events: any non-empty username/password (e.g. `live`/`live`).

## Test

```bash
go test ./...
```

`gateway_test.go` covers the whole matrix against a mock app and a fake SRS (no OBS needed):

- the full 3-connection dance (right password succeeds, wrong is rejected)
- a credless client passes via the empty-user escape hatch
- publish matrix: auth key + credless conn → rejected; authed + bare key → upstream name is the authenticated email; explicit mismatched name → rejected; credless + bare no-auth key → upstream name from the client IP; explicit name on a no-auth key → honored; unknown token (per-student key) → relayed verbatim

## Diagnostics

`CAPTURE=1 RTMP_LISTEN=:11935 go run ./rtmp-gateway` runs a silent RTMP server that completes the handshake, sends **no** challenge, and dumps OBS' full AMF0 connect object — this is how we proved OBS never volunteers credentials without a challenge. See `capture.go`.

## Limitations / TODO

- **Non-authmod clients can't pass the challenge.** Every connection gets the stage-1 challenge; only librtmp-based clients (OBS, rtmpdump) answer it. ffmpeg's *native* RTMP implementation fails on the challenge — push to SRS directly for such clients, or build ffmpeg against librtmp.
- **Extended timestamps on fmt-3 chunks** are not re-read: only matters after ~4.6h of wall-clock stream time, well past any exam window.
- **Outbound chunking always uses fmt-0** (full header per message). Correct, slightly verbose; can be optimized to fmt-1/3 later if bandwidth matters.
- **Relay media direction is OBS → SRS only** (publish); there is no SRS → OBS return path, which is correct for publishing.
- The policy check fails **open** when the app is unreachable: acceptable because SRS' `on_publish` hook validates the same key against the same app, so an app outage already blocks publishing downstream.
