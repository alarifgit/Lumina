# Lumina — multi-stage build, static binary, VAAPI-capable FFmpeg.
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod go.sum* ./
# BuildKit cache mounts: the module + build caches survive across builds,
# so rebuilds after a source-only change skip the dependency download and
# recompile only what changed.
RUN --mount=type=cache,target=/go/pkg/mod go mod download
# Copy ONLY the Go sources — the reference trees, brand tooling and docs
# are excluded via .dockerignore and were never needed to compile.
COPY cmd internal ./
# This repo may not have a checked-in go.sum yet; tidy after the full source
# copy so the image builds from a clean checkout too.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod tidy && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/lumina ./cmd/lumina

FROM debian:bookworm-slim
# Use the jellyfin-ffmpeg GitHub release .deb instead of the ghcr.io image:
# anonymous ghcr pulls 403 on some networks, but the release asset is a plain
# HTTPS download. bookworm matches this base; the package installs into
# /usr/lib/jellyfin-ffmpeg and gives us FFmpeg 7 (better VAAPI/QSV + AV1).
# VAAPI driver: mesa from backports, covering the host's AMD GPUs (RX 6800S
# dGPU + 680M iGPU — both radeonsi). Running on Intel instead? Re-add
# intel-media-va-driver-non-free (and the non-free apt component) here.
ARG JELLYFIN_FFMPEG_VERSION=7.1.4-3
# mesa-va-drivers from bookworm-BACKPORTS, not stable: bookworm stable ships
# Mesa 22.3, which predates RDNA3 (gfx110x, e.g. ASUS G14 dGPU) VCN4 video
# ENCODE support — device init succeeds but every encode fails EINVAL (-22).
RUN echo "deb http://deb.debian.org/debian bookworm-backports main" \
      > /etc/apt/sources.list.d/backports.list \
    && apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl vainfo \
    && apt-get install -y --no-install-recommends -t bookworm-backports \
      mesa-va-drivers \
    && curl -fSL -o /tmp/jellyfin-ffmpeg.deb \
      "https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/v${JELLYFIN_FFMPEG_VERSION}/jellyfin-ffmpeg7_${JELLYFIN_FFMPEG_VERSION}-bookworm_amd64.deb" \
    && apt-get install -y --no-install-recommends /tmp/jellyfin-ffmpeg.deb \
    && rm -f /tmp/jellyfin-ffmpeg.deb \
    # curl only existed to fetch the .deb — purge it (and its now-orphaned
    # deps) in the same layer so the files never reach the final image.
    && apt-get purge -y curl && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/lumina /usr/local/bin/lumina

ENV LUMINA_DATA_DIR=/config \
    LUMINA_HTTP_ADDR=:8096 \
    LUMINA_FFMPEG=/usr/lib/jellyfin-ffmpeg/ffmpeg \
    LUMINA_FFPROBE=/usr/lib/jellyfin-ffmpeg/ffprobe

# PUID/PGID pattern (linuxserver.io style): entrypoint adjusts the lumina
# user's IDs and adds the host render GID so /dev/dri/renderD128 is usable.
COPY deployments/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME ["/config"]
EXPOSE 8096
ENTRYPOINT ["/entrypoint.sh"]
