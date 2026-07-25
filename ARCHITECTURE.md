# Lumina — Architecture

Lumina is a self-hosted media server built from scratch, targeting feature parity
with Plex / Emby / Jellyfin and deliberate improvements where the incumbents are weak.

> **Design wedge:** the best media server for *arr users — instant, event-driven
> libraries, unbreakable watch state, honest hardware transcoding.

---

## 1. High-level shape

```
                        ┌────────────────────────────────────────────┐
                        │                Lumina server               │
                        │                                            │
  Web client (React) ──►│  HTTP API (REST + WebSocket)               │
  Future clients     ──►│    ├─ /api/v1/...        (native API)      │
                        │    ├─ /emby/... /        (Jellyfin/Emby    │
  Radarr / Sonarr    ──►│    │   jellyfin/...        compat shim)    │
  webhooks           ──►│    └─ /hooks/arr         (native webhooks) │
                        │                                            │
                        │  Scanner ──► Library DB (SQLite, WAL)      │
                        │     ▲            ▲                         │
                        │     │            │                         │
                        │  Watcher tiers   Metadata engine           │
                        │  (inotify /      (TMDB, TVDB,              │
                        │   events / poll)  pluggable)               │
                        │                                            │
                        │  Transcode orchestrator ──► FFmpeg         │
                        │  (capability-probed)         (VAAPI/QSV    │
                        │                            via /dev/dri)   │
                        └────────────────────────────────────────────┘
```

**Language: Go.** Single static binary, goroutines fit scanner + transcode
orchestration + API fan-out, trivially cross-compiled for the Docker image.
Dependencies are kept minimal (see §9).

---

## 2. Core principles

1. **Media identity is a content hash, not a path.** Paths change (renames,
   remounts, *arr upgrades). Hash = head + tail chunks + size — never whole-file.
   Watch state, resume points, and metadata overrides hang off the hash.
2. **The scanner is event-driven, not scan-driven.** Full scans are a last resort.
3. **Lumina never speaks network file protocols.** SMB/NFS mounting is the host's
   job; bind mounts are Docker's job. Lumina sees filesystem paths, period.
4. **Disappearance ≠ deletion.** Missing files are tombstoned, never purged
   automatically (protects libraries from dropped SMB mounts).
5. **Hardware capabilities are probed, not assumed.** The transcode layer tests
   the GPU at startup and reports honestly in the admin UI.

---

## 3. Storage layer & the three-tier scanner

### 3.1 What Lumina accepts

A **library root** is any filesystem path visible to the process:

| Source                        | How it reaches Lumina                          |
|-------------------------------|------------------------------------------------|
| Local disk                    | Direct path / bind mount                       |
| SMB/NFS share                 | Host mount → `docker run -v /mnt/nas:/media`   |
| Anything else (rclone, etc.)  | Same pattern — Lumina never knows the difference |

Docker volume *plugins* for SMB are explicitly not recommended (slow, flaky).

### 3.2 Three watcher tiers (per library root, auto-selected)

1. **Tier 1 — inotify.** Local paths only. Instant, zero cost.
2. **Tier 2 — Event-fed.** *arr webhooks (`/hooks/arr`) and the compat shim's
   `POST /Library/Media/Updated` deliver exact paths. Instant *and* precise.
3. **Tier 3 — mtime sweep.** Cheap incremental stat-walk for network mounts
   (inotify does **not** propagate remote changes over CIFS/NFS), cadence
   ~minutes. Deep hash verification only for changed entries.

The admin UI shows which tier is live per root — no silent failures like Plex's
"auto-detect changes" over SMB.

> Open item (later): SMB attribute caching on the host mount (`actimeo=0` /
> `cache=none`) can delay mtime updates that Tier 3 depends on. Revisit when
> tuning real deployments.

### 3.3 Tombstone rule

A previously-known item that vanishes becomes `state=missing` with a timestamp.
It returns automatically when the path/hash reappears. Only explicit user purge
removes rows. Library-wide "everything is gone" (empty mount point) triggers a
safety halt, never a wipe.

---

## 4. Path mapping & *arr integration

### 4.1 Path mapping (first-class config)

Containers rarely share mount conventions. Sonarr may report
`/data/movies/Foo (2024)/...` while Lumina sees `/media/movies/...`.

```yaml
path_mappings:
  - from: "/data/movies"     # as reported by the *arr instance
    to:   "/media/movies"    # as seen by Lumina
```

Mappings are longest-prefix, applied to every inbound event path. Unmappable
paths are logged visibly, not dropped silently.

### 4.2 Inbound integration (Radarr/Sonarr → Lumina)

Two doors, both supported:

- **Native webhooks** — `POST /hooks/arr` with `eventType` (Grab, Download,
  Upgrade, Rename, Delete). Best fidelity.
- **Compat shim** — Lumina implements the Emby/Jellyfin endpoints Radarr/Sonarr
  call for their built-in "Connect" integration:
  - `GET  /System/Info` (emby + jellyfin paths)
  - `POST /Library/Media/Updated` (jellyfin) / `POST /Library/Media/Updated` (emby)
  - `POST /Library/Refresh`
  - `GET  /Library/VirtualFolders`
  
  Configure Radarr/Sonarr → Settings → Connect → Emby/Jellyfin → point at Lumina.
  The same shim later unlocks Jellyseerr/Overseerr, Bazarr, Notifiarr, etc.

### 4.3 Outbound integration (Lumina → *arr)

REST clients for `/api/v3/queue`, `/api/v3/history`, `/api/v3/calendar` —
powers a Lumina UI panel (download queue, upcoming episodes).

---

## 5. Library DB

SQLite in WAL mode. Single file, single writer — correct for this scale.

Core tables (sketch):

- `items(id, hash, kind, library_id, title, year, state, created_at, ...)`
- `paths(item_id, path, seen_at)` — many paths per item (hardlinks, renames)
- `playheads(user_id, item_id, position_ms, updated_at, version)` — versioned,
  append-only journal for watch events; resume state is derived, not stored
- `metadata_overrides(item_id, field, value)` — user edits always win over providers
- `users(id, name, ...)`, `sessions(...)`, `scan_events(...)`

Content hash: `blake3(size ‖ head 8 MiB ‖ tail 8 MiB)`.

---

## 6. Metadata engine

Pluggable providers behind one interface; TMDB + TVDB first, nfo-file provider
for *arr users (nfo always beats remote providers when present).

```go
type Provider interface {
    Identify(ctx context.Context, hint IdentifyHint) ([]Candidate, error)
    Fetch(ctx context.Context, id string) (Metadata, error)
}
```

Overrides flow: `nfo > user override > provider`. Mismatch UI (pick the right
match from candidates) is a first-class screen, not an afterthought.

---

## 7. Transcoding

### 7.1 Capability probe (startup, cached)

1. `ffmpeg -hide_banner -hwaccels` → is `vaapi`/`qsv` available?
2. Test-encode tiny clips: `h264_vaapi`, `hevc_vaapi`, `av1_vaapi` (encode),
   decode probes for h264/hevc/av1/vp9.
3. HDR→SDR tone-map test via `tonemap_vaapi` (+ OpenCL fallback on Intel).
4. Results cached in DB; exposed at `GET /api/v1/system/capabilities` and in
   the admin UI ("HEVC encode: ✓ hardware — AV1 decode: ✗").

Target GPU: Intel/AMD via `/dev/dri/renderD128`. Container needs
`--device=/dev/dri` and membership of the host's `render` group (GID handled via
`group_add` / PUID-PGID pattern, linuxserver.io style).

### 7.2 Pipeline

- **Direct play** whenever the client supports the container + codecs.
- **Direct stream** (remux only) when only the container is wrong.
- **Transcode** otherwise → **HLS (fMP4) output**; one session manager owns
  FFmpeg processes, kills on client disconnect, throttles to buffer-ahead.
- Filters run in GPU memory (`scale_vaapi`, `tonemap_vaapi`); avoid GPU↔RAM
  round trips mid-pipeline.

---

## 8. API & clients

- REST under `/api/v1`, OpenAPI-documented from day one (enables third-party
  clients later). WebSocket channel for playhead sync, scan progress, queue.
- Web client: React + TypeScript (separate repo phase later).
- Deliberately **no native TV/mobile apps in v1** — that's where the incumbents
  burn years. Web + compat shim first.

---

## 9. Dependencies (intentionally thin)

- Router: stdlib `net/http` (Go 1.22+ pattern routing) — upgrade to `chi` only if needed
- SQLite: `modernc.org/sqlite` (pure Go, no cgo — keeps the binary static) ✅ Phase 1
- inotify: `github.com/fsnotify/fsnotify` ✅ Phase 1
- Hashing: stdlib `crypto` (sha256 today) or `zeebo/blake3` later
- FFmpeg/ffprobe: external binaries, exec'd

Toolchain: **Go 1.25+** (required by modernc.org/sqlite v1.54).

---

## 10. Phased roadmap

| Phase | Deliverable                                              | Exit test |
|-------|----------------------------------------------------------|-----------|
| 0 ✅  | Skeleton: config, HTTP API, healthz, capability probe    | `lumina serve` answers `/healthz` |
| 1 ✅  | Scanner tiers 1+3, SQLite, content hashing, tombstones   | Point at a dir → browse API lists items; remount a dir → nothing is lost |
| 2 ✅  | Web client: browse + direct play; HLS transcode (VAAPI-first, software fallback) | Play a file end-to-end in browser; force-transcode a 4K HDR file → watchable SDR HLS |
| 3 ✅  | Users, watch-state journal, resume                       | Resume survives rename of the file |
| 4 ✅  | Restart-on-seek transcoding, subtitles (sidecar+embedded→VTT) | Seek past produced segments restarts FFmpeg at -ss |
| 4⏸   | Software HDR tone-map, subtitle burn-in, quality variants | — (deferred: no HDR content on host) |
| 5 ✅  | *arr integration: webhooks + shim + path mapping (P0/1) + outbound queue/calendar panel + shim auth | Sonarr import → item appears in Lumina within seconds |
| 6 ✅  | Metadata engine (TMDB): real titles, posters, genres; filename parser; rate-limited worker | Wrong match fixable… (mismatch UI still TODO) |
| 7 ✅  | Plex watch-state migration import (pull/push/two-way, preview-first) | Preview report matches; Apply → watched badges appear in Lumina |
| 8+    | Differentiators: intro-skip (chapter/audio detection), recommendations, multi-user polish, mismatch UI, auth | — |

---

## 11. What Lumina will NOT do (for now)

- No SMB/NFS client inside the server
- No DVR/live-TV, no photos/music libraries (v1 is movies + TV)
- No native mobile/TV clients
- No plugin store — plugins are compiled-in Go interfaces until the API stabilises
