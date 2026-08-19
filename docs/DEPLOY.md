# Deployment Guide — GHCR Images

Deploy the full stack (backend + Go media-node) using pre-built GHCR images. No source code, no building — just pull and run.

## Architecture (single server, 3 containers)

```mermaid
graph TB
    subgraph "Docker host"
        app["constrainable-app<br/>:31954<br/>API + SSR + Socket.IO<br/>SQLite DB"]
        mn["media-node<br/>(constrainable-media-node)<br/>:1935 RTMP<br/>Go front-door"]
        srs["SRS (ossrs/srs:6)<br/>relay + DVR + FLV<br/>config rendered by media-node"]
        obs -->|"relay"| srs
        mn -->|"renders config"| srs
        app -->|"pull FLV (internal DNS)"| srs
        app <-->|"Socket.IO"| mn
    end
    browser["Browser (admin)"]
    obs["OBS (publisher)"]
    browser -->|":31954 HTTP"| app
    obs -->|":1935 RTMP"| mn
```

Single RTMP entry point (:1935), two auth levels:

- OBS "Use authentication" **ON** → account auth (identity-bound proctoring)
- OBS "Use authentication" **OFF** → credless, event-key check (quick access)

## Quick Start

### 1. Download the compose file

```bash
mkdir constrainable-ingest && cd constrainable-ingest
curl -O https://raw.githubusercontent.com/hnrobert/constrainable-ingest/main/docker-compose.yml
```

### 2. Create `.env` (optional but recommended)

```bash
cat > .env << 'ENVEOF'
# Required
SESSION_SECRET=$(openssl rand -hex 32)
AUTHMOD_VERIFIER_SECRET=$(openssl rand -hex 32)

# Optional — leave empty for no auth between backend and media-node
# MEDIA_NODE_AUTH_TOKEN=$(openssl rand -hex 32)

# Optional — WebRTC (WHEP) playback only: the public IP browsers' ICE should
# target. FLV playback (default) and OBS ingest need NO host configuration —
# OBS URLs are derived from wherever users browse the app.
# PUBLIC_HOST=192.168.1.100

TZ=Asia/Shanghai
ENVEOF
```

### 3. Start

```bash
docker compose up -d
```

### 4. Verify

```bash
# Backend is up
curl http://localhost:31954/api/health

# Media-node's SRS is up (API is internal to the Docker network)
docker compose logs media-node 2>&1 | grep -q "API is up" && echo "SRS API reachable"

# Both containers running
docker compose ps
```

## Configuration

All configuration is via environment variables in `.env` or the compose file.

### Required

| Var | Description |
| ----- | ------------- |
| `SESSION_SECRET` | JWT signing secret. Generate: `openssl rand -hex 32`. |

No host/IP configuration is required: OBS ingest URLs are derived at runtime
from the origin users browse the app at, and playback is same-origin.

### Optional

| Var | Default | Description |
| ----- | --------- | ------------- |
| `AUTHMOD_VERIFIER_SECRET` | auto | AES key for authmod verifier encryption. |
| `MEDIA_NODE_AUTH_TOKEN` | _(empty)_ | Shared secret between backend and media-node. Empty = no auth. |
| `PUBLIC_HOST` | _(auto)_ | WebRTC (WHEP) ICE candidate + explicit ingest-host override. |
| `CORS_ORIGINS` | _(empty)_ | Split deployment: allowed frontend origins (see docs/CDN.md Option B). |
| `SELF_ORIGIN` | `media-node` | Media-node's public identifier (multi-node deployments). |
| `TZ` | `Asia/Shanghai` | Timezone for recordings directory naming. |

## Data persistence

| Host path | Container path | Contents |
| ----------- | --------------- | ---------- |
| `./data/` | `/app/data/` | SQLite database (users, events, sessions) |
| `./records/` | `/records/` | DVR recording files (FLV) |

Backup: copy the `data/` directory. Recordings can be backed up or offloaded separately.

## Scaling to multiple servers

The backend (`constrainable-app`) is the control plane. Media-nodes can run on additional servers:

```mermaid
graph TB
    subgraph "Central server"
        app["constrainable-app :31954<br/>API + Socket.IO + DB"]
    end
    subgraph "Beijing node (2 containers)"
        mn1["media-node<br/>:1935 RTMP"]
        srs1["SRS sidecar<br/>DVR"]
        mn1 -->|"renders config"| srs1
    end
    subgraph "Shanghai node (2 containers)"
        mn2["media-node<br/>:1935 RTMP"]
        srs2["SRS sidecar<br/>DVR"]
        mn2 -->|"renders config"| srs2
    end
    app <-->|"Socket.IO"| mn1
    app <-->|"Socket.IO"| mn2
```

Each media-node:

- Connects to the central backend via Socket.IO
- Registers itself (backend routes viewers to the right node)
- Runs with its own SRS sidecar container (recording stays local)
- Owns the SRS config (template embedded in the node image, rendered at startup)

```bash
# On a remote server (node + SRS sidecar via the media-node repo's compose)
git clone https://github.com/hnrobert/constrainable-media-node && cd constrainable-media-node
API_ORIGIN=http://central-server:31954 \
SELF_ORIGIN=shanghai-node \
PUBLIC_ORIGIN=http://shanghai-node:38080 \
SRS_FLV_BASE=http://shanghai-node:38080 \
docker compose up -d
```

## Ports

| Port | Service | Protocol | Used by |
| ------ | --------- | ---------- | --------- |
| 31954 | constrainable-app | HTTP | Browser (web UI, API, Socket.IO) |
| 1935 | media-node | RTMP | OBS (push streaming) |

SRS's ports (38080 FLV, 1985 API) are NOT published on a compose host: the app backend reaches them over the Docker network by service name (`http://srs:38080`), and viewers play through the app's same-origin proxy. A standalone remote media-node (see Scaling above) publishes 38080 on its SRS sidecar because the central backend pulls playback over the network. The FLV port is configurable on the node (`SRS_HTTP_PORT`, default 38080 — deliberately uncommon to avoid clashes with other services).

## Updating

```bash
docker compose pull
docker compose up -d
```

## Troubleshooting

| Issue | Check |
| ------- | ------- |
| Page loads but API 404 | request not reaching the app container; check `docker compose ps` and port 31954 |
| OBS can't connect | Port 1935 blocked by firewall; check `docker logs constrainable-media-node` |
| No recordings | Check `./records/` is writable; check SRS log in media-node container |
| Media-node not registering | Check `API_ORIGIN` is reachable from the media-node container |
| Wrong stream metrics | SRS API might be slow to start; wait 15s after first publish |
