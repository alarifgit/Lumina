# syntax=docker/dockerfile:1

# ── Stage 1: Install dependencies (Bun is fast for installs) ──────
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# ── Stage 2: Build the Next.js standalone app ──────────────────────
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma generate needs a DATABASE_URL (doesn't connect, just generates the client)
ENV DATABASE_URL="file:/tmp/build.db"
ENV NEXT_TELEMETRY_DISABLED=1

RUN bun run db:generate
RUN bun run build:docker

# Install only Prisma's migration CLI and its transitive dependencies. Keeping
# it separate avoids copying the complete build-time node_modules into runtime.
FROM node:20-slim AS prisma-cli
WORKDIR /opt/prisma
RUN npm init -y \
    && npm install --omit=dev --no-audit --no-fund --no-package-lock prisma@6.19.3 \
    && npm cache clean --force

# ── Stage 3: Production runner (Node.js for best Prisma CLI compat) ─
# We use node:20-slim instead of oven/bun:1 here because the Prisma CLI
# (used by the entrypoint to run `db push` on startup) is designed for
# Node.js and has deep transitive deps that Bun's resolver can struggle
# with. The Next.js standalone server runs perfectly on Node 20.
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# The SQLite database lives on a host-mounted volume (see docker-compose.yml)
ENV DATABASE_URL=file:/data/lumina.db
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Prisma's query engine needs openssl + ca-certificates on slim images.
# ffmpeg is bundled so Lumina can decode/transcode any media codec (AC3, DTS,
# TrueHD, HEVC, etc.) to browser-friendly formats on the fly — no need for
# you to pre-encode your library.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Next.js standalone server (includes its own minimal node_modules)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma CLI is isolated from the app's minimal standalone dependencies.
COPY --from=prisma-cli /opt/prisma/node_modules /opt/prisma/node_modules

# Prisma schema (needed by `db push`)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts/repair-media-identities.mjs ./scripts/repair-media-identities.mjs

# Entrypoint that ensures the DB schema exists, then starts the server
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
