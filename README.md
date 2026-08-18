# constrainable-ingest

Deployment orchestrator for the Constrainable Ingest proctoring platform. This repo contains **only** docker-compose + docs. Code lives in two separate repos, coupled at runtime via GHCR images.

## Repository Structure

| Repo | Role | Image |
|------|------|-------|
| [`constrainable-app`](../constrainable-app) | Nuxt frontend + API backend + Socket.IO + admin dashboard | `ghcr.io/OWNER/constrainable-app` |
| [`constrainable-media-node`](../constrainable-media-node) | Go RTMP front-door + colocated SRS + DVR recording | `ghcr.io/OWNER/constrainable-media-node` |
| **constrainable-ingest** (this repo) | docker-compose + deployment docs | — |

## Quick Deploy

```bash
git clone https://github.com/OWNER/constrainable-ingest.git
cd constrainable-ingest

# Configure
cp .env.example .env
# Edit .env: set PUBLIC_HOST and SESSION_SECRET

# Start
docker compose up -d
```

## Architecture

```
┌──────────────────────────────────────────┐
│  Docker host                             │
│                                          │
│  ┌────────────────┐  ┌────────────────┐  │
│  │ server         │  │ media-node     │  │
│  │ (constrainable-│  │ (constrainable-│  │
│  │  app)          │◄─┤  media-node)   │  │
│  │ :31954         │  │ :1935 RTMP     │  │
│  │ API+SSR+Socket │  │ :8080 FLV      │  │
│  │ SQLite DB      │  │ SRS colocated  │  │
│  └───────┬────────┘  └───────┬────────┘  │
│          │                   │           │
└──────────│───────────────────│───────────┘
           │                   │
      Browser (admin)     OBS (publisher)
      :31954              :1935
```

## Ports

| Port | Service | Used by |
|------|---------|---------|
| 31954 | server | Browser (web UI, API, Socket.IO) |
| 1935 | media-node | OBS (RTMP push) |
| 8080 | media-node's SRS | Browser (direct FLV, optional) |

## Scaling

Run additional media-nodes on other servers:

```bash
# On a remote server
docker run -d \
  -e NODE_ORIGIN=http://central-server:31954 \
  -e SELF_ORIGIN=remote-node-1 \
  -p 1935:1935 -p 8080:8080 \
  -v /srv/records:/records \
  ghcr.io/OWNER/constrainable-media-node:latest
```

Each media-node registers with the central backend and handles publishers in its region.

## Documentation

- [Deployment Guide](docs/DEPLOY.md) — detailed setup
- [CDN Guide](docs/CDN.md) — frontend on CDN for nationwide access
- [Streaming Architecture](docs/STREAMING.md) — technical deep-dive

## Development

Clone the code repos separately:

```bash
git clone https://github.com/OWNER/constrainable-app.git
git clone https://github.com/OWNER/constrainable-media-node.git
```
