# Lumina — multi-stage build, static binary, VAAPI-capable FFmpeg.
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
# This repo may not have a checked-in go.sum yet; tidy after the full source
# copy so the image builds from a clean checkout too.
RUN go mod tidy && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/lumina ./cmd/lumina

FROM debian:bookworm-slim
# Use the jellyfin-ffmpeg GitHub release .deb instead of the ghcr.io image:
# anonymous ghcr pulls 403 on some networks, but the release asset is a plain
# HTTPS download. bookworm matches this base; the package installs into
# /usr/lib/jellyfin-ffmpeg and gives us FFmpeg 7 (better VAAPI/QSV + AV1).
# VAAPI drivers for both GPU vendors: mesa (AMD — e.g. G14 dGPU) and
# iHD (Intel Arc/newer iGPUs, lives in non-free).
ARG JELLYFIN_FFMPEG_VERSION=7.1.4-3
RUN sed -i 's/^Components: main$/Components: main contrib non-free non-free-firmware/' \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl vainfo mesa-va-drivers intel-media-va-driver-non-free \
    && curl -fSL -o /tmp/jellyfin-ffmpeg.deb \
      "https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/v${JELLYFIN_FFMPEG_VERSION}/jellyfin-ffmpeg7_${JELLYFIN_FFMPEG_VERSION}-bookworm_amd64.deb" \
    && apt-get install -y --no-install-recommends /tmp/jellyfin-ffmpeg.deb \
    && rm -f /tmp/jellyfin-ffmpeg.deb \
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
