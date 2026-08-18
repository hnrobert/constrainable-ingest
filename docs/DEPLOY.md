# Deployment Guide — GHCR Images

Deploy the full stack (backend + Go media-node + SRS) using pre-built GHCR images. No source code, no building — just pull and run.

## Architecture (single server)

```
┌──────────────────────────────────────────────┐
│  Docker on your server                      │
│                                             │
│  ┌─────────────┐    ┌────────────────────┐ │
│  │ server      │    │ media-node          │ │
│  │ (Nuxt API)  │◄───┤ (Go RTMP + SRS      │ │
│  │ :31954      │    │  colocated child)   │ │
│  │ Socket.IO   │    │ :1935 RTMP           │ │
│  │ SQLite DB   │    │ :8080 FLV playback  │ │
│  └─────────────┘    └────────────────────┘ │
│        ↑                      ↑             │
└────────│──────────────────────│─────────────┘
         │                      │
    Browser (admin)        OBS (publisher)
    :31954                :1935
```

## Quick Start

### 1. Download the compose file

```bash
mkdir constrainable-ingest && cd constrainable-ingest
curl -O https://raw.githubusercontent.com/OWNER/constrainable-ingest/main/docker/docker-compose.ghcr.yml
```

Replace `OWNER` with the GitHub user/org that owns the packages.

### 2. Create `.env` (optional but recommended)

```bash
cat > .env << 'EOF'
# Required
PUBLIC_HOST=192.168.1.100        # your server's LAN/public IP (browsers + OBS use this)
SESSION_SECRET=$(openssl rand -hex 32)
AUTHMOD_VERIFIER_SECRET=$(openssl rand -hex 32)

# Optional — leave empty for no auth between backend and media-node
# MEDIA_NODE_AUTH_TOKEN=$(openssl rand -hex 32)

TZ=Asia/Shanghai
EOF
```

### 3. Start

```bash
docker compose -f docker-compose.ghcr.yml up -d
```

### 4. Verify

```bash
# Backend is up
curl http://localhost:31954/api/health

# Media-node is up (health endpoint)
curl http://localhost:8080/api/v1/versions

# Both containers running
docker compose -f docker-compose.ghcr.yml ps
```

## Configuration

All configuration is via environment variables in `.env` or the compose file.

### Required

| Var | Description |
|-----|-------------|
| `PUBLIC_HOST` | Your server's IP/hostname. Browsers use it for the web UI; OBS uses it for RTMP push. |
| `SESSION_SECRET` | JWT signing secret. Generate: `openssl rand -hex 32`. |

### Optional

| Var | Default | Description |
|-----|---------|-------------|
| `AUTHMOD_VERIFIER_SECRET` | auto | AES key for authmod verifier encryption. |
| `MEDIA_NODE_AUTH_TOKEN` | _(empty)_ | Shared secret between backend and media-node. Empty = no auth. |
| `TZ` | `Asia/Shanghai` | Timezone for recordings directory naming. |

## Data persistence

| Host path | Container path | Contents |
|-----------|---------------|----------|
| `./data/` | `/app/data/` | SQLite database (users, events, sessions) |
| `./records/` | `/records/` | DVR recording files (FLV) |

Backup: copy the `data/` directory. Recordings can be backed up or offloaded separately.

## Scaling to multiple servers

The backend (`server`) is the control plane. Media-nodes can run on additional servers:

```bash
# On server 2 (e.g. Shanghai), run only a media-node:
docker run -d \
  -e NODE_ORIGIN=http://central-server:31954 \
  -e SELF_ORIGIN=shanghai-node \
  -e RTMP_PORT=1935 \
  -e SRS_ADDR=localhost:1935 \
  -e SRS_API_BASE=http://localhost:1985/api/v1 \
  -e SRS_BIN=/usr/local/srs/objs/srs \
  -e RECORD_DIR=/records \
  -p 1935:1935 -p 8080:8080 \
  -v /srv/records:/records \
  ghcr.io/OWNER/constrainable-media-node:latest
```

Each media-node:
- Connects to the central backend via Socket.IO
- Registers itself (backend routes viewers to the right node)
- Runs its own colocated SRS (recording stays local)
- Is fully self-contained (config template embedded in the image)

## Ports

| Port | Service | Protocol | Used by |
|------|---------|----------|---------|
| 31954 | server | HTTP | Browser (web UI, API, Socket.IO) |
| 1935 | media-node | RTMP | OBS (push streaming) |
| 8080 | media-node's SRS | HTTP | Browser (direct FLV playback, optional) |

## Updating

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

## Troubleshooting

| Issue | Check |
|-------|-------|
| Page loads but API 404 | `PUBLIC_HOST` not set correctly |
| OBS can't connect | Port 1935 blocked by firewall; check `docker logs ingest-media-node` |
| No recordings | Check `./records/` is writable; check SRS log in media-node container |
| Media-node not registering | Check `NODE_ORIGIN` is reachable from the media-node container |
| Wrong stream metrics | SRS API might be slow to start; wait 15s after first publish |

## Building from source (instead of GHCR)

```bash
git clone https://github.com/OWNER/constrainable-ingest.git
cd constrainable-ingest
docker compose -f docker/docker-compose.yml up -d --build
```

This builds both images locally (takes 2-3 minutes) and runs the same topology.
