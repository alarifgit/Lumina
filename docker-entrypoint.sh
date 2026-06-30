#!/bin/sh
set -e

# Ensure the data directory exists (host-mounted volume for the SQLite DB)
mkdir -p /data

# Create or migrate the database schema.
# This is idempotent — safe to run on every container start.
# `--accept-data-loss` is used so schema changes never block startup in
# non-interactive mode. For a personal media library this is safe because
# all data can be rebuilt by re-scanning your media directories.
echo "[Lumina] Ensuring database schema at ${DATABASE_URL} ..."
node ./node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss || {
  echo "[Lumina] Warning: prisma db push failed. The server will start but DB queries may fail."
}

echo "[Lumina] Starting server on port ${PORT:-3000} ..."
exec "$@"
