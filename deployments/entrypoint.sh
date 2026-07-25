#!/bin/sh
# Lumina container entrypoint: PUID/PGID + render-group handling, then exec.
set -eu

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

groupadd -f -g "$PGID" lumina 2>/dev/null || true
useradd -u "$PUID" -g "$PGID" -M -s /usr/sbin/nologin lumina 2>/dev/null || true

# Grant access to the GPU render node: add the HOST's render-group GID to
# the lumina user. Without this, VAAPI silently falls back to software.
if [ -n "${RENDER_GID:-}" ]; then
  groupadd -f -g "$RENDER_GID" render-host 2>/dev/null || true
  usermod -aG "$RENDER_GID" lumina 2>/dev/null || true
elif [ -e /dev/dri/renderD128 ]; then
  # Auto-detect the host group of the render node.
  RGID="$(stat -c %g /dev/dri/renderD128 2>/dev/null || echo '')"
  if [ -n "$RGID" ] && [ "$RGID" != "0" ]; then
    groupadd -f -g "$RGID" render-host 2>/dev/null || true
    usermod -aG "$RGID" lumina 2>/dev/null || true
  fi
fi

mkdir -p "$LUMINA_DATA_DIR"
chown -R "$PUID:$PGID" "$LUMINA_DATA_DIR" 2>/dev/null || true

# No su-exec/gosu in slim image: run as root in Phase 0 if PUID tooling is
# unavailable; drop privileges properly in Phase 1 hardening.
exec lumina -config "$LUMINA_DATA_DIR/lumina.json" "$@"
