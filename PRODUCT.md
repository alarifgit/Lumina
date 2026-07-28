# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Lumina is primarily for technically capable self-hosters who already run Radarr, Sonarr, or adjacent *arr tools and keep movie and TV libraries on local disks or NAS-mounted storage. They want to operate and watch their own media without depending on a hosted account, while retaining the library automation, playback, user profiles, and watch-state continuity expected from Plex-class software.

The core job is to keep an automated media library current and reliably playable with little manual maintenance, even as *arr upgrades, renames, or moves files.

## Product Purpose

Lumina is a self-hosted movies-and-TV media server. It discovers and organizes media, enriches it with optional metadata, serves an embedded browser client, chooses direct playback or transcoding, and maintains per-user watch state.

Success means:

- *arr imports and filesystem changes appear promptly without routine full-library rescans;
- renames, upgrades, remounts, and temporary storage failures do not destroy identity or watch history;
- playback selects a path the current browser and host can actually support;
- operators can understand library, integration, and transcode state without the server pretending unavailable capabilities exist;
- the core experience remains useful on a private or air-gapped LAN.

## Positioning

Lumina is the *arr-native media server: event-driven library updates, content-hash identity that survives path changes, and hardware transcoding decisions based on measured host capabilities rather than assumed support.

This combination is the durable product wedge. A neighboring media server could copy individual features, but it could not truthfully claim this position without changing how it identifies media, receives library changes, and selects transcode pipelines.

## Operating Context

- Lumina runs as a Go server, commonly in Docker on the machine with access to the media library and GPU.
- Local disks, NAS shares, SMB/NFS mounts, and rclone-backed storage reach Lumina as ordinary filesystem paths. Mounting and network filesystem behavior remain the host's responsibility.
- Radarr and Sonarr notify Lumina through native webhooks or its Emby/Jellyfin compatibility endpoints. Path mappings reconcile differing container mount conventions.
- Users browse and play media through the web client embedded in the server binary. The client is intended to work without external frontend dependencies.
- FFmpeg and ffprobe provide media inspection and transcoding. Intel/AMD acceleration is exposed through the host's render device when available.
- TMDB enrichment and Plex watch-history migration are optional integrations; missing credentials must not break the local library.

## Capabilities and Constraints

Confirmed capabilities include:

- event-fed and filesystem-watched library updates with incremental sweeps as a fallback;
- content-derived item identity, multi-path tracking, and missing-item tombstones;
- movie and episodic-TV browsing, search, detail views, metadata correction, bookmarks, users, resume positions, and watched state;
- direct play with HTTP range support and automatic HLS transcoding fallback;
- capability-probed VAAPI/software transcode selection, restart-on-seek, quality selection, and session visibility;
- sidecar and embedded text subtitles served as WebVTT;
- optional TMDB titles, artwork, genres, and overviews with procedural artwork as the no-key fallback;
- Radarr/Sonarr queue and calendar visibility;
- preview-first Plex watch-state import with pull, push, and two-way directions;
- a native REST API plus selected Emby/Jellyfin compatibility routes.

Durable constraints:

- The shipped client platform is web. Native mobile and TV applications are not current product scope.
- Current library scope is movies and TV, not music, photos, DVR, or live television.
- The server remains self-hosted and local-first, including support for air-gapped LAN use.
- The core architecture is Go, an embedded web client, SQLite in WAL mode, and external FFmpeg/ffprobe processes.
- Lumina does not implement SMB or NFS clients; it consumes paths already mounted by the host.
- Missing files are tombstoned rather than automatically purged. A vanished mount must not become a destructive library update.
- Authentication is not currently shipped. Future work must not imply that an Internet-exposed deployment is protected unless authentication is implemented and verified.
- Optional integrations must degrade cleanly when credentials, providers, hardware acceleration, or remote services are unavailable.
- No plugin marketplace is currently promised.

## Brand Commitments

- The product name is **Lumina**.
- Preserve the existing Lumina wordmark, emblem, favicon family, avatar set, and icon family under `internal/api/web/`.
- Product language is direct and operational: name the real action, state, limitation, and recovery path. Avoid invented superiority claims or vague automation language.
- Product identity remains centered on user-owned media and infrastructure rather than cloud accounts or subscription gating.

## Evidence on Hand

- [README.md](README.md) documents shipped workflows, integrations, playback behavior, deployment, and verification steps.
- [ARCHITECTURE.md](ARCHITECTURE.md) records the identity, scanner, storage, integration, and transcode mechanisms.
- [lumina.example.json](lumina.example.json) and [deployments/docker-compose.example.yml](deployments/docker-compose.example.yml) provide runnable configuration and deployment examples.
- `internal/api/web/brand/`, `internal/api/web/avatars/`, and `internal/api/web/icons/` contain the committed product assets.
- The Go implementation, embedded client, API routes, and automated tests are the available product demonstration.

There are no confirmed customer testimonials, adoption figures, independent benchmarks, press claims, pricing facts, or case studies in the repository. Future work must not fabricate them. No license file is currently present, so public-repository visibility must not be presented as a confirmed licensing commitment.

## Product Principles

1. **Identity must outlive location.** Renames, upgrades, hardlinks, and mount changes must not sever metadata or watch state from the media.
2. **React to events before rescanning.** Prefer precise notifications and cheap incremental verification over routine brute-force library work.
3. **Report capabilities honestly.** Probe browsers, codecs, GPUs, integrations, and paths; expose failures and fall back instead of assuming support.
4. **Protect user state from infrastructure failure.** Temporary disappearance is not deletion, ambiguous matches are not guessed, and imports are previewed before mutation.
5. **Keep the core locally complete.** External metadata and migration services may enrich Lumina, but local browsing and playback cannot depend on a hosted account.

## Accessibility & Inclusion

No formal conformance target has been confirmed. Preserve and extend the web client's existing keyboard operation, visible focus, reduced-motion support, semantic control labels, touch targets, and responsive layouts. Do not make pointer hover, fine motor control, color alone, or animation the only way to understand or complete an action.
