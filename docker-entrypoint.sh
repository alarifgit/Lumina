#!/bin/sh
set -e

# Ensure the data directory exists (host-mounted volume for the SQLite DB)
mkdir -p /data

echo "[Lumina] Ensuring database schema at ${DATABASE_URL} ..."

# Older databases may contain multiple rows for the same TMDB identity. Merge
# those rows before creating the unique index expected by the current schema.
node /app/scripts/repair-media-identities.mjs

# Run prisma db push to create or update the database schema.
# This is idempotent for compatible schema changes and safe to run on every start.
#   - On a fresh database: creates all tables.
#   - On an existing database: applies any schema changes.
# Destructive changes are intentionally refused so a bad image cannot silently
# remove data. A schema failure stops the container instead of serving a broken UI.
# `--skip-generate` skips regenerating the client (already generated at build time).
node /opt/prisma/node_modules/prisma/build/index.js db push \
    --schema=/app/prisma/schema.prisma \
    --skip-generate

echo "[Lumina] Starting server on port ${PORT:-3000} ..."
exec "$@"
