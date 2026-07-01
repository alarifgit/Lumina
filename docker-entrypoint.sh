#!/bin/sh
set -e

# Ensure the data directory exists (host-mounted volume for the SQLite DB)
mkdir -p /data

echo "[Lumina] Ensuring database schema at ${DATABASE_URL} ..."

# Run prisma db push to create or update the database schema.
# This is idempotent — safe to run on every container start.
#   - On a fresh database: creates all tables.
#   - On an existing database: applies any schema changes.
# `--accept-data-loss` prevents interactive prompts in non-interactive mode.
# `--skip-generate` skips regenerating the client (already generated at build time).
node ./node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss 2>&1 || {
  echo "[Lumina] Warning: prisma db push failed. The server will start anyway."
  echo "[Lumina] If this is a fresh database, table queries may fail until the schema is created."
  echo "[Lumina] You can run 'docker exec lumina node ./node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss' manually."
}

echo "[Lumina] Starting server on port ${PORT:-3000} ..."
exec "$@"
