# Lumina

A self-hosted media server built from scratch — aiming at Plex/Emby/Jellyfin
parity, with deliberate improvements: event-driven libraries, content-hash
identity, honest hardware transcoding. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Phase 2 — what's here

Everything from Phase 1 (three-tier scanner, SQLite, tombstones, compat
shim, *arr webhooks, capability probe), plus **playback**:

- **Embedded web client** (served by the binary at `/`, hls.js vendored —
  works on an air-gapped LAN): browse libraries, grid view, media-info
  panel, playback-mode badge, force-transcode toggle
- **Smart playback decision**: ffprobe info → direct play when the
  container AND all codecs are browser-safe; automatic HLS fallback if a
  direct-play attempt fails at runtime
- **Direct play**: `GET /api/v1/items/{id}/stream` with HTTP Range
  support (seeking) via `http.ServeContent`
- **HLS transcode**: `GET /api/v1/items/{id}/hls/{file}` — on-demand
  FFmpeg sessions, full-speed (not realtime) VOD playlists, 4s mpegts
  segments, segment requests poll-and-wait so transcode latency hides
  behind normal HLS buffering
- **VAAPI-first with automatic software fallback**: decode+filter+encode
  stay in GPU memory (`h264_vaapi`, `tonemap_vaapi` for HDR inputs);
  if a VAAPI session dies (e.g. 10-bit HEVC on an older iGPU) it retries
  once in software (`libx264 veryfast`). Decode coverage is whatever
  FFmpeg supports — h264, HEVC, VP9, AV1, MPEG-2, VC-1, …
- **Idle reaper**: sessions die after 2 min without segment requests;
  `/api/v1/system/sessions` shows what's live

## Phase 3 — what's here

Everything from Phase 2 (embedded web client, direct play, HLS transcode
with VAAPI + software fallback), plus **users and watch state**:

- **Append-only playhead journal** (per user, per item; server-assigned
  versions) — resume position and watched flags are DERIVED from the
  newest row, never stored as mutable state. Rows reference items by
  content-hash identity: rename the file mid-watch and your resume point
  doesn't even notice. (This is the Phase 3 exit test.)
- **Users**: `admin` seeded automatically; `POST /api/v1/users` adds
  more; a header pill in the web client switches between them
- **Client integration**: resume-on-open (skips intros <5s and finished
  items), progress reported every 10s while playing + on pause + on
  close, per-card progress bars and ✓ watched badges (92% threshold,
  mirrored server-side)
- Schema migration included for Phase-1 databases (`playheads.duration_ms`)

API: `GET/POST /api/v1/users`, `GET /api/v1/users/{uid}/playheads`,
`GET/POST /api/v1/items/{id}/playhead`

## Phase 4 — what's here

Everything from Phase 3, plus **transcode refinements and subtitles**
(proper software HDR tone-mapping deliberately deferred — no HDR content
on the current host):

- **Restart-on-seek**: HLS sessions are keyed by start offset
  (`?start=<seconds>`). Seeking beyond produced segments restarts FFmpeg
  with input `-ss` at the absolute target instead of waiting for the
  transcode to catch up. All playhead reporting converts session-relative
  time back to absolute time, so resume points stay correct across restarts.
- **Subtitles**: `GET /api/v1/items/{id}/subtitles` discovers sidecars
  (`Movie.en.srt`, SDH/Forced flags, `Subs/`/`Subtitles/` folders) and
  embedded text streams; `GET .../subtitles/{subid}` serves WebVTT
  (SRT converted in-process, ASS/SSA + embedded via ffmpeg extraction).
  Bitmap subs (PGS/VobSub) are excluded — they need burn-in (Phase 7+).
  The player gets a subtitle selector with forced-track auto-enable.

## Salvaged from `lumina_badattempt`

The Codex/Next.js attempt was rejected as a foundation (API routes doing
scanner/transcode work in Node is the wrong architecture — see
ARCHITECTURE.md §1 for the chosen design), but its good parts were ported:

- **Brand assets**: typographic `Lumina.` header wordmark plus the restored favicon pack (`internal/api/web/brand/`)
- **Procedural poster design**: deterministic title-hue gradients, radial
  glow, film grain, LUMINA watermark (ported to `web/style.css` + `app.js`)
- **Subtitle discovery heuristics**: basename matching, nested subtitle
  dirs, language/forced/SDH filename parsing, SRT→VTT conversion
  (ported to Go in `internal/media/subtitles.go`)

## Phase 5 — what's here

The inbound half shipped in Phases 0–1 (native `/hooks/arr` webhooks,
Emby/Jellyfin compat shim, path mapping, delete tombstoning). Phase 5
adds the **outbound** half:

- `GET /api/v1/arr/status` — per-instance reachability, version,
  download queue (progress %, ETA) and 7-day calendar, queried
  concurrently with an 8s budget per instance
- **Downloads panel** in the web client header (⬇ button): queue +
  upcoming episodes/movies per Radarr/Sonarr instance
- Optional **shim auth**: set `shimApiKey` and Emby/Jellyfin shim calls
  require it (`?api_key=` or `X-Emby-Token`); empty = open (dev default)

## Phase 6 — what's here

**Metadata engine (TMDB)** — real titles, years, overviews, genres,
posters and backdrops:

- Pluggable provider design (TMDB first); **no API key = procedural
  posters, nothing breaks**. Key via `tmdb.apiKey` in lumina.json or
  `LUMINA_TMDB_KEY`
- **Filename parser** (*arr/Plex conventions): strips release tags
  (`1080p`, `BluRay`, `x264`, …), extracts year, parses `S02E04`
- **Rate-limited background worker** (~4 req/s): the scanner enqueues
  unidentified items, TMDB results replace filename titles (episodes show
  as "Series Name S02E04") and posters/backdrops flow to the client —
  which swaps procedural posters for real artwork automatically
- Scanner **never clobbers** provider titles with filename titles; DB
  migration for pre-Phase-6 databases included
- `POST /api/v1/items/{id}/metadata/refresh` — manual re-identification
  (the mismatch UI builds on this later)

## Phase 7 — what's here

**Plex → Lumina watch-state migration import** (matching engine distilled
from lumina_badattempt's plex-sync.ts — its best 900 lines):

- **Identity matching, strongest first**: TMDB Guid ↔ our `tmdb_id` →
  normalized title+year (movies) → normalized show + exact SxxEyy
  (episodes, parsed from Lumina filenames). Ambiguous identities are
  reported, never guessed.
- **Preview before apply**: `POST /api/v1/plex/import` with `apply:false`
  writes nothing and reports scanned/matched/unmatched plus every row
  needing attention; `apply:true` appends a full-length playhead to the
  journal per matched item (derived state → watched, content-hash keyed
  so it survives renames forever).
- **Directions**: pull (Plex → Lumina), push (scrobble Lumina-watched
  back to Plex), two-way.
- **Web UI**: ⇄ button in the header — URL/token (remembered locally),
  Test connection, Preview, Apply (unlocks only after a preview with
  work to do).
- Config: `plex.url` / `plex.token` in lumina.json or
  `LUMINA_PLEX_URL` / `LUMINA_PLEX_TOKEN`; per-request overrides supported.

## Run (dev, needs Go 1.25+)

```sh
go mod tidy                        # first time only: generates go.sum
cp lumina.example.json lumina.json # optional seed; libraries are editable in the UI (⚙)
go run ./cmd/lumina -config lumina.json
curl localhost:8096/healthz
# open http://localhost:8096 → ⚙ Libraries to add/edit/remove roots and rescan
```

## Run (Docker, on the GPU host)

```sh
docker compose -f deployments/docker-compose.example.yml up --build
```

The container needs `--device=/dev/dri` for VAAPI; the entrypoint handles the
host render-group GID automatically (or set `RENDER_GID`).

### Transcode scratch directory

HLS segments are written to `<data>/transcode` by default. Like Plex's
"transcoder temporary directory", you can move that scratch space to fast
local storage or RAM with `LUMINA_TRANSCODE_DIR` — never a network share:

```yaml
services:
  lumina:
    # ...
    environment:
      LUMINA_TRANSCODE_DIR: /transcode
    tmpfs:
      - /transcode:size=4g,mode=1777
```

tmpfs gives the fastest segment reads and zero SSD wear; 4 GB is plenty for
several concurrent sessions (a 4K H.264 QP22 session peaks well under
2 GB). A local SATA/NVMe directory works fine too.

### Hardware acceleration notes (AMD RDNA)

The startup probe asks vainfo which decode profiles the GPU actually has and
picks the pipeline per file: full VAAPI when the GPU can decode the codec,
**vaapi-hybrid** (software decode + GPU encode) when it can't. On RDNA2
(e.g. RX 6800S / Navi 23) there is **no AV1 hardware decode** — AV1 files
therefore always decode on CPU and encode on silicon. H.264/HEVC (incl.
10-bit) decode and encode fully on the GPU. Check what your card reported:
`GET /api/v1/system/capabilities` (`decoders` map).

## Verify the *arr integration

1. Sonarr → Settings → Connect → + → **Emby** → host `lumina`, port `8096` → Test → Save.
2. Import an episode. Lumina's log should show a Tier-2 refresh within a second,
   and the item appears at `GET /api/v1/items`.

## Not here yet (by design)

Auth, metadata providers, subtitles, restart-on-seek transcoding,
quality variants. Roadmap: ARCHITECTURE.md §10.
