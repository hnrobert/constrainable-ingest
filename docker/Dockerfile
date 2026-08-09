# syntax=docker/dockerfile:1
# ---- deps ----
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

# ---- build ----
FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# ---- runtime ----
FROM oven/bun:1 AS runtime
# ffmpeg/ffprobe are required at runtime for probing + recording
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    TZ=Asia/Shanghai

# Nitro bundles the server app into .output (self-contained). We additionally
# ship node_modules + the Drizzle schema/config so the server can run
# `drizzle-kit push` at startup (TypeORM-style auto-sync, no migration files).
COPY --from=build /app/.output /app/.output
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/drizzle.config.ts /app/drizzle.config.ts
COPY --from=build /app/server/database/schema.ts /app/server/database/schema.ts

VOLUME ["/app/data", "/app/records"]
EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "/app/.output/server/index.mjs"]
