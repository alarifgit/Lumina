# Lumina — Personal Media Streaming Frontend · Worklog

## Current Handoff

Updated: 2026-07-13. This section,
[Detailed Current Handoff](#detailed-current-handoff), and
[Prioritized Roadmap](#prioritized-roadmap) are authoritative. Every task log
or old design/API specification is historical context only.

### Continue Here

1. Read `AGENTS.md`, this section, and
   [Detailed Current Handoff](#detailed-current-handoff); then inspect
   `git status`, `git diff --stat`, and the complete diff. Never reset or
   discard the current working tree.
2. Do not begin another broad visual redesign. The user likes the current
   direction; the uncommitted responsive pass needs real-library verification.
3. Before any production rescan, implement the P0 scanner safety and diagnostic
   gate in [Prioritized Roadmap](#prioritized-roadmap). The audit found
   confirmed destructive and path-collision risks in the current scanner.
4. Build on the capable host, transfer/import the image, preserve the exact NAS
   `/data` and media mounts, and follow `DEPLOYMENT.md` for verification and
   rollback.

### Current State

- Branch: `main`; last commit: `853e156`, also present at `origin/main`.
- The working tree contains substantial intentional, locally validated
  redesign work plus documentation changes. `scripts/seed.ts` appears modified
  because of line-ending/index state but currently has no content diff; do not
  fold an accidental normalization into the feature commit.
- The local tree contains the artwork-led smoked-glass redesign and responsive
  follow-up: a fluid 3200px shell, proportional ultrawide cards/heroes, aligned
  full-width scrolled navigation, persistent shelf controls, stable detail
  scrolling, and the redesigned player.
- The currently deployed service is `http://10.41.6.100:3422`; that image
  predates the local responsive follow-up.
- The last reported deployed counts were 475 Lumina movies vs 478 NAS movies,
  and 181 Lumina TV shows vs 180 NAS TV directories. Both anime counts matched.
  Those differences are unresolved, not proof that the local scanner fixes
  them.
- Lint, TypeScript, Prisma validation/generation, and `build:docker` passed on
  2026-07-13 against the current code tree. Local fixture-browser checks passed
  at 390px, 1024px, 1694px, and 3440px.
- Docker and FFmpeg are unavailable on this development host. Container
  startup, production scanning, hardware acceleration, embedded subtitle
  extraction, and bitmap subtitle burn-in remain unverified here.

### Verification Vocabulary

- **Compile-validated**: lint, TypeScript, Prisma validation/generation, and the
  production build pass.
- **Fixture-browser-validated**: a controlled local database was exercised in a
  browser at named viewport sizes.
- **Deployment-verified**: the transferred image started on the NAS with the
  preserved database/mounts and passed real-library checks.

Do not promote compile- or fixture-validated behavior to deployment-verified.

Project: A YouTube/Apple TV/Plex/Netflix-like frontend for a personal movie + TV library.
Brand name: **Lumina** (luminous cinema light). Artwork-led steel-blue glass,
porcelain type, ink controls, and restrained warm-gold state accents.
Single user-visible route: `/` (everything else is client-side view state via Zustand + overlays).

---

## Historical Bootstrap Notes — Non-Authoritative

Everything from this heading until `Detailed Current Handoff` describes an
earlier bootstrap state. It is retained for history and must not be used as the
current API, component, Docker, or design specification.

Task ID: 1
Agent: orchestrator (main)
Task: Foundation — schema, types, store, theme, branding.

Work Log:
- Defined Prisma schema (Media, Episode, Genre, MediaGenre, WatchProgress, Collection, CollectionItem, LibraryConfig). Pushed to SQLite + generated client.
- Wrote shared types in `src/lib/types.ts` (MediaSummary, MediaDetail, Episode, Season, ContentRow, HomeData, SaveProgressPayload, LibraryStats, ScanResult).
- Wrote Zustand store `src/store/media-store.ts` (route, searchQuery, genreFilter, selectedMediaId, watchMediaId/episodeId/startAt + actions).
- Wrote `src/lib/media-utils.ts` (formatRuntime, formatTimecode, formatNumber, hashString, hueForMedia, posterGradient, posterInitials, progressPercent, groupEpisodesBySeason).
- Rewrote `src/app/globals.css` with cinematic dark-first palette (amber/gold primary `oklch(0.84 0.15 78)`, near-black bg `oklch(0.14 0.006 75)`). Added utilities: no-scrollbar, thin-scrollbar, text-shadow-lg, mask-fade, film-grain, lumina-range input styling.
- Kicked off AI image generation (logo mark + 2 hero backdrops) into `public/brand/` in background.

Stage Summary:
- DB synced. Types + store + utils + theme are the contract layer both backend and frontend build against.

---

### Historical API Contract — Obsolete

All responses are JSON. Media image fields are full URLs (TMDB CDN: `https://image.tmdb.org/t/p/<size><path>`). Procedural poster fallback used client-side when `posterUrl` is null.

#### Historical: GET `/api/library/home` → `HomeData`
```
{ featured: MediaSummary[], continueWatching: MediaSummary[], rows: ContentRow[] }
```
- `featured`: up to 6 items that have a backdrop (featured flag or top popularity).
- `continueWatching`: up to 12 items with progress, sorted by `updatedAt` desc.
- `rows`: ContentRow[] — keys like `trending`, `popular-movies`, `popular-tv`, `top-rated`, and one row per top genre (e.g. `genre-Action`). Each row up to 20 items.

#### Historical: GET `/api/library/stats` → `LibraryStats`

#### Historical: GET `/api/library/genres` → `string[]`

#### Historical: GET `/api/library/browse?type=MOVIE|TV&genre=&q=&sort=popular|rating|year|title&page=1&pageSize=24`
→ `{ items: MediaSummary[], total, page, pageSize, genres: string[] }`

#### Historical: GET `/api/media/:id?season=N` → `MediaDetail`
- `MediaDetail` extends `MediaSummary` with `seasons: Season[]`, `episodes: Episode[]` (for the requested/first season), `nextEpisode: Episode | null`, `streamUrl`, `filePath`, `tmdbId`, `imdbId`, `voteCount`, `status`, `releaseDate`.
- If `season` omitted, returns episodes for first season that has episodes (or season 1).

#### Historical: GET `/api/media/:id/stream` → video byte stream (HTTP Range supported, `Content-Type: video/mp4`). Only used when client determines the source is local (no remote `streamUrl`). Returns 404 + JSON `{ error }` if no file.

#### Historical: GET `/api/episodes/:id/stream` → same streaming behaviour for an episode.

#### Historical: GET `/api/search?q=foo` → `{ items: MediaSummary[], query }`

#### Historical: GET `/api/progress` → `{ items: MediaSummary[] }` (continue-watching list, up to 24)

#### Historical: POST `/api/progress` body `SaveProgressPayload { mediaId, episodeId?, position, duration, completed? }` → `{ ok: true }`

#### Historical: GET `/api/collections` → `{ items: MediaSummary[] }` (My List)

#### Historical: POST `/api/collections/toggle` body `{ mediaId }` → `{ ok: true, inMyList: boolean }`

#### Historical: POST `/api/library/scan` body `{ mediaDir?, tmdbKey? }` → `ScanResult`
- Scans the filesystem under the configured `MEDIA_DIR` (env) or `mediaDir`. Detects movies (`.mp4/.mkv/.webm` files) and TV shows (folder structure `Show Name/Season 01/S01E01.*`). Auto-matches TMDB metadata when a key is present, otherwise creates stubs. Idempotent.

#### Historical: POST `/api/metadata/search` body `{ title, type, year? }` → `{ results: { tmdbId, title, year, overview, posterUrl, type }[] }`

#### Historical: POST `/api/metadata/apply` body `{ mediaId, tmdbId, type }` → `{ ok: true, media: MediaDetail }` (fetches + saves full TMDB metadata incl. episodes for TV)

### Historical `MediaSummary` Shape — Obsolete
```
{ id, type:"MOVIE"|"TV", title, posterUrl, backdropUrl, year, rating, runtime, genres:string[],
  certification, overview, tagline, featured, trending, popularity, inMyList,
  progressPercent?, progressPosition?, progressDuration?, progressEpisodeId?,
  progressSeason?, progressEpisode?, progressUpdatedAt? }
```

### Historical Frontend Design Spec — Obsolete

- **Theme**: dark-first (default `dark` class on `<html>` via next-themes, `defaultTheme="dark"`). Amber/gold accent. NO indigo/blue.
- **Layout shell** (`AppShell`): fixed top nav (transparent → blurred/solid on scroll), main content (swaps by route), sticky footer (`mt-auto`, minimal: Lumina wordmark + "Personal media library" + scan status). Root wrapper `min-h-screen flex flex-col bg-background text-foreground`.
- **TopNav**: Logo (SVG luminous aperture mark + "Lumina" wordmark), nav links (Home / Movies / TV Shows / My List / Library) — active state underlined in primary; expandable search input (icon → expands); theme toggle; profile avatar. Mobile: hamburger → Sheet with nav.
- **HeroCarousel** (home): full-bleed backdrop with gradient scrim (bottom→top dark), title (large), tagline, meta row (year • rating ★ • runtime • certification • genres), Play ▶ + More Info ℹ buttons + My List ⊕. Auto-rotate every 8s, dots/arbudget indicators, pause on hover. Procedural backdrop fallback when no `backdropUrl`.
- **ContentRow**: title + horizontally scrollable cards (scroll-snap), left/right arrow buttons (appear on hover, desktop), `no-scrollbar`. On mobile, swipe scroll.
- **MediaCard**: 2:3 poster. On hover: scale 1.05, lift, show info overlay (title, year, rating, genres, quick-play + add-to-list). If `progressPercent>0`: thin progress bar at bottom. Procedural poster (`posterGradient` + `posterInitials` + small "LUMINA" mark) when no `posterUrl`. Image with `onError` → swap to procedural.
- **ContinueWatchingCard**: landscape (16:9) backdrop/still thumbnail with title, S/Ep badge, progress bar, resume play.
- **BrowseView** (Movies/TV): header + filter bar (genre select, sort select, optional search within). Responsive grid (2 cols mobile → 6 cols xl). "Load more" pagination.
- **SearchView**: large search input (autofocus) + results grid + empty state.
- **MyListView**: grid + friendly empty state ("Your list is empty — add titles with the + button").
- **LibraryView** (admin): stats cards (titles, movies, series, episodes, total runtime hours, last scan), "Scan Library" button (POST scan → toast with ScanResult), media directory display + edit, TMDB key input, scan log/results. List of all media with metadata status + "Fetch metadata" per item. This is the "point at my media" feature.
- **DetailOverlay**: large Dialog. Backdrop hero, title, meta, Play + My List, tagline, overview, genres. For TV: Season selector (Select) + episode list (scrollable `max-h-96 overflow-y-auto thin-scrollbar`) with still thumbnails, episode numbers, titles, runtime, play buttons, progress. Recommended/similar row at bottom.
- **VideoPlayer** (fullscreen overlay): custom HTML5 player. Controls (auto-hide after 3s, show on mousemove): play/pause, seek bar (lumina-range), current/total time, volume, skip ±10s, playback speed menu, fullscreen, back button (top-left), title (top). Resume from `watchStartAt`. Save progress every 5s + on pause + on unmount (POST /api/progress). Keyboard: space=play/pause, arrows=seek/volume, f=fullscreen, esc=back. For TV: "Next Episode" button when ended. Loading spinner while buffering.
- **Animations**: Framer Motion — overlay fade/scale, card hover, hero slide. Subtle, premium.
- **Loading states**: skeletons (cards + rows). **Errors**: toast (sonner) + inline messages.
- **Accessibility**: semantic main/header/nav/footer, aria-labels on icon buttons, focus-visible rings, keyboard operable, alt text.

### Historical Component List — Obsolete
AppShell, TopNav, Logo, Footer, HeroCarousel, ContentRow, MediaCard, ContinueWatchingCard, ProceduralPoster, DetailOverlay, SeasonEpisodeList, VideoPlayer, BrowseView, SearchView, MyListView, LibraryView, RatingBadge, MetaRow, Skeletons, GenreSelect, SortSelect.

### Historical Bootstrap Rules — Obsolete
- Use existing shadcn/ui components (`@/components/ui/*`) — do NOT recreate.
- TanStack Query (`@tanstack/react-query`) for all server state. Query keys: `["home"]`, `["browse", {type,genre,sort,page,q}]`, `["media", id, season]`, `["search", q]`, `["collections"]`, `["progress"]`, `["stats"]`, `["genres"]`.
- Only `/` route (src/app/page.tsx). All "pages" are view-state in the Zustand store; detail & watch are overlays.
- `z-ai-web-dev-sdk` backend only.
- z.ai web dev SDK not needed in frontend.

---

## Detailed Current Handoff

Updated: 2026-07-13

This section is authoritative for the next Codex task. Historical entries below
describe how Lumina evolved and can be stale or contradictory.

### Repository State

- Primary branch: `main`.
- The working tree contains intentional, uncommitted visual-system and player
  changes alongside documentation updates. Do not discard or reset them;
  inspect `git status` and the complete diff before editing.
- Last committed revision at this handoff: `853e156` (“Rework media browsing
  and playback state management”).
- Commit `853e156` is present on both local `main` and `origin/main`.

### Current Architecture

- Lumina is a single-page Next.js App Router application. Client-side view and
  overlay state lives in `src/store/media-store.ts`.
- Prisma/SQLite state is persisted at `/data/lumina.db` in production.
- Local files are authoritative. User-facing counts and browse grids include
  locally playable movies and shows rather than stale metadata rows.
- TMDB identity is unique by `(type, tmdbId)`. Container startup runs
  `scripts/repair-media-identities.mjs` to merge legacy duplicates and create
  the expected unique index before guarded `prisma db push`.
- Docker uses Next.js standalone output and a dedicated Prisma CLI stage. The
  full build dependency tree is no longer copied into the runtime image.
- Direct play remains preferred. FFmpeg compatibility transcoding uses VAAPI
  automatically when `/dev/dri/renderD128` is usable and otherwise falls back
  to `libx264`.

### Implemented Work Covered By This Handoff

- Replaced the ornate dark-gold application chrome with an artwork-led
  smoked-glass system: steel-blue ambient canvas, cool translucent panels,
  porcelain typography, near-black control capsules, and gold limited to
  ratings/progress/selection/focus.
- Replaced the image wordmark in application chrome with a compact typographic
  `Lumina.` lockup and centered the primary navigation inside an ink capsule.
- Reworked the Home feature carousel into an asymmetric two-title artwork deck
  and aligned all shelves to the same bounded page width.
- Made that shared page frame fluid through 3200px, kept one 16/24/32px gutter
  system across navigation, hero, shelves, grids, and footer, and moved the
  scrolled glass treatment to the full-width header so its edges stay
  symmetric at every viewport.
- Added a shared resize-aware horizontal rail with persistent directional
  controls whenever content is hidden, native touch scrolling, snap alignment,
  and matching scroll padding. Continue Watching now uses the same controls as
  poster shelves.
- Hardened the rail's animation-frame cleanup for React Strict Mode so a
  setup/cleanup/setup cycle cannot suppress later arrow measurements.
- Scaled hero, shelf, card, and grid proportions through ultrawide layouts;
  browse grids expand to eight columns, while the secondary Home feature hides
  below `xl` instead of becoming a cramped tablet tile.
- Made poster titles, ratings, years, and type readable without hover; retained
  the central play action and consistent three-dot menu, including touch
  discoverability.
- Unified browse filters, search, My List, category, settings, dialogs,
  skeletons, and empty states with the same surface language and 8px radius.
- Restyled the player surround, title treatment, controls, menus, and artwork
  wash to match the application while preserving open gradient scrims,
  independent menus, centered transport, and subtitle clearance.
- Replaced the detail dialog's viewport-width-derived scroll height with a
  bounded flex layout, preventing ultrawide windows from collapsing its
  scrollable content body.

- Removed obsolete generator scripts, examples, local database, upload scratch
  files, unused Caddy configuration, and the unused logo-review component.
- Tightened `.dockerignore`/`.gitignore` and reduced Docker runtime dependency
  duplication.
- Added safe startup repair for duplicate TMDB identities.
- Introduced path-aware rescans, same-path row merging, media-row availability,
  recursive movie collection scanning, and common-extras filtering. The audit
  below identifies incomplete title-fallback, traversal, and episode-history
  safety in that implementation.
- Aligned library statistics, section counts, browse, and search with locally
  playable media.
- Fixed player settings/caption menu positioning. The shared `lumina-panel`
  class forced `position: relative` and previously stretched the controls bar.
- Changed the cog to a real Settings root with Playback Speed and Compatibility
  Mode rather than opening a speed list directly.
- Rebalanced player controls into three stable zones: volume/status left,
  transport centered, and captions/settings/fullscreen right.
- Expanded subtitles to detect sidecars in sibling and `Subs`/`Subtitles`
  folders, probe embedded streams, convert text tracks to WebVTT, and offer
  embedded bitmap tracks such as PGS/DVD subtitles through burn-in transcoding.
- Added `Subtitle.streamIndex` and `Subtitle.codec`; startup `db push` applies
  these additive columns on deployment.

### Uncommitted Change Map

- Visual tokens and shared surfaces: `src/app/globals.css` and
  `src/components/ui/card.tsx`.
- Shell and identity: `top-nav.tsx`, `logo.tsx`, and `footer.tsx`.
- Home composition and responsive shelves: `home-view.tsx`,
  `hero-carousel.tsx`, `content-row.tsx`, `continue-watching-card.tsx`, and the
  new `horizontal-rail.tsx`.
- Poster/browse surfaces: `media-card.tsx`, `browse-view.tsx`,
  `category-view.tsx`, `search-view.tsx`, `my-list-view.tsx`, and
  `skeletons.tsx`.
- Settings and action/dialog surfaces: `library-view.tsx`,
  `media-actions-menu.tsx`, `media-info-dialog.tsx`, and
  `media-match-dialog.tsx`.
- Playback surfaces: `detail-overlay.tsx` and `video-player.tsx`.
- Handoff and operating guidance: `AGENTS.md`, `README.md`, `DEPLOYMENT.md`,
  this file, and the brand asset-pack README.

The current documentation pass does not yet fix scanner, query, watcher, or
player correctness findings in the roadmap below. Do not infer those fixes
from the redesign diff.

### Validation State

- `npm run lint` passes.
- `npx tsc --noEmit` passes.
- `npx prisma validate` passes.
- `npx prisma generate` passes.
- `npm run build:docker` passes without Turbopack trace warnings.
- These checks were rerun successfully on 2026-07-13 after resuming the
  deployment checklist.
- Lint, TypeScript, Prisma validation/generation, and `build:docker` were run
  again successfully after the smoked-glass redesign. Desktop and 390px mobile
  shell/skeleton states were also browser-inspected locally.
- The same complete validation set passed again after the responsive follow-up.
  A disposable populated database was browser-tested at 390px, 1024px, 1694px,
  and 3440px, then removed. Page geometry had no document-level horizontal
  overflow; shelf controls advanced to the final snap point; header, hero, and
  shelf gutters aligned; the 1024px hero stayed single-column; and the detail
  body remained independently scrollable on mobile.
- Local standalone output measured approximately 177.45 MB before system
  FFmpeg and isolated Prisma CLI layers.
- Docker and FFmpeg are not installed on this Windows development host, so the
  container startup repair, NAS scanning, embedded subtitle extraction, and
  bitmap subtitle burn-in still require runtime verification in the deployed
  image.

### Confirmed Audit Findings

These were confirmed by code inspection on 2026-07-13. They are defects or
safety gaps to fix; they are not yet proven to be the exact cause of each live
count discrepancy.

- `src/lib/scanner.ts` looks up movies and shows with `filePath OR title/year`.
  A second live path with the same parsed title/year can overwrite the first
  row before path reconciliation. Alternate editions and parser collisions are
  therefore silent instead of explainable.
- Several nested `readdir`/`stat` failures become an empty list or a logged
  skip, but the scan still performs missing-path reconciliation. A partial NAS
  traversal can mark undiscovered media unavailable.
- The scanner deletes episode rows after clearing missing `filePath` values,
  and TMDB cleanup also deletes rows without a current file/stream. The Prisma
  relation cascades an episode deletion into episode watch progress. This
  contradicts the local-media/history invariants.
- Browse, search, headline counts, and section counts use the shared playable
  predicate, but Home feature/trending/popular/recent/genre queries, Continue
  Watching, My List, top-genre grouping, and runtime totals do not apply it
  consistently. The earlier statement that all user-facing queries were
  aligned was too broad.
- Show-level playback resolves a playable episode for the stream but saves
  progress using `activeEpId`; when no episode was supplied initially, a TV
  progress row can be written with `episodeId: null`.
- The global player key handler closes over stale `current` and `duration`
  values because its effect omits them, so left/right keyboard seeking can use
  an outdated position.
- The filesystem watcher is initialized once, handles add/add-directory/raw
  rename events only, and does not reconcile section edits or removals. Manual
  and watcher scans have no per-section concurrency lock.
- Every rescan probes subtitle streams again; there is no path/size/mtime media
  analysis cache.
- There is no automated test suite or CI workflow. `/api` still returns
  `Hello, world!`, and the image has no Docker health check.

### Prioritized Roadmap

#### P0-A — Make Production Scans Safe And Explainable

1. Match an exact normalized path first. Reuse a title/year row only when its
   previous path is absent/unavailable; never overwrite a second path that was
   discovered in the same scan.
2. Define how multiple files/editions for one TMDB title should be represented.
   Until a versions model exists, surface every identity collapse in the scan
   manifest instead of silently losing a path from reconciliation evidence.
3. Track traversal completeness. If any directory needed for a section cannot
   be read reliably, return an incomplete scan and skip all missing-path
   reconciliation for that section.
4. Preserve missing episode rows, metadata, subtitles, and watch history by
   marking them unavailable rather than deleting them. Remove the equivalent
   destructive TMDB cleanup.
5. Serialize scans per section across manual requests and the watcher.
6. Return and expose a path-level reconciliation manifest: discovered videos,
   unsupported/ignored entries with reasons, traversal errors, parser output,
   duplicate path/title/TMDB collisions, and database rows proposed as stale.
7. Add focused temporary-directory/SQLite scanner tests for numeric titles,
   collection recursion, extras, same-title distinct paths, rename recovery,
   partial traversal, missing episodes/history, and idempotent rescans.

Definition of done: an incomplete scan cannot remove availability/history; the
manifest explains every discovered or excluded path; destructive test fixtures
pass; lint, TypeScript, Prisma validation/generation, and `build:docker` pass.

#### P0-B — Deploy, Reconcile Counts, And Verify Real Media

1. Follow `DEPLOYMENT.md`: inventory the live container, use an immutable image
   tag, import a `docker save` archive, stop and back up the complete `/data`
   bind, retain the old container/image, and recreate with the exact existing
   port/mount/environment/device contract.
2. Confirm duplicate repair and guarded schema push complete before
   `Starting server on port 3000`, then compare stats/sections with the captured
   pre-deployment JSON before scanning.
3. After P0-A is complete, scan one section at a time and retain each manifest.
   Reconcile the three movie differences and the extra TV row path-by-path.
   Determine whether any difference is an intentional TMDB/edition collapse or
   a mismatched NAS-vs-Lumina counting definition. Keep anime counts unchanged
   and confirm *Harry Potter and the Deathly Hallows: Part 2* appears.
4. Exercise Home, Movies, TV, Search, My List, Settings, detail, rails, and the
   player at mobile, desktop, and ultrawide/high-DPI widths.
5. Test direct play, compatibility fallback, resume, menus, external SRT/ASS,
   embedded text, and PGS/DVD burn-in against named real files. Subtitles must
   remain clear of controls.

Definition of done: startup and rollback evidence is retained; every count
difference has an itemized explanation; no unresolved scan error exists; real
subtitle/player checks pass; the deployed image is explicitly recorded as
deployment-verified.

#### P1 — Playback, Query, Watcher, And Analysis Correctness

- Apply one explicit playable predicate to every discovery surface and runtime
  aggregate. Decide whether My List preserves offline items; if it does, label
  them unavailable and disable playback rather than presenting a broken card.
- Save TV progress against the resolved episode, validate that the episode
  belongs to the submitted media, enforce/update a single logical progress row,
  and repair stale show-level/episode resume records.
- Make keyboard seeking read from the video element or current refs. Add
  browser checks for keyboard, menu, transport, subtitle-clearance, shelf, and
  responsive-detail behavior.
- Refine codec/container direct-play decisions and fatal direct-play fallback
  with small media fixtures.
- Refresh watcher subscriptions when sections change; handle change/unlink and
  unlink-directory events through the safe serialized scan path.
- Cache codec/subtitle analysis by normalized path, size, and modification time
  so unchanged media skips repeated `ffprobe` work.
- Replace `/api` with a structured health/readiness response and consider a
  Docker `HEALTHCHECK` after the endpoint is meaningful.

Definition of done: query/progress/player/watcher tests cover the listed
regressions, unchanged files skip analysis, and all standard validations pass.

#### P1 — Establish A Test And CI Baseline

- Add query tests proving unavailable media cannot leak into discovery shelves
  or counts.
- Add progress tests for show-level playback, dismissal/resume restoration,
  completion, and next-episode selection.
- Add subtitle/transcoder command tests and byte-range streaming tests.
- Add a browser regression suite for the locally verified responsive geometry
  and player interactions.
- Run lint, TypeScript, Prisma validation/generation, tests, `build:docker`, and
  a legacy-database startup fixture in CI.

#### P2 — Operations And UX Hardening

- Show/export the full reconciliation manifest instead of only a note count.
- Replace hard-coded section “Active” status with path, watcher, and last-scan
  health; add clear offline treatment if My List retains unavailable items.
- Add empty-library onboarding after correctness work is stable.
- Untrack the legacy `.env` and replace it with a non-secret example; align the
  isolated Prisma CLI with the lockfile version; pin or intentionally update
  base images; evaluate a non-root runtime without breaking NAS permissions.

### Deployment Verification Needed

The exact build/save/transfer/import, backup, startup, functional verification,
and rollback procedure now lives in `DEPLOYMENT.md`. The key order is:

1. Complete P0-A before any production rescan.
2. Import and start the new image with the preserved live configuration.
3. Verify state before scanning, then run section scans only with manifests and
   a restore-ready backup.
4. Complete real-library player and responsive checks.
5. Review the complete diff, commit intentionally, and push `main` only after
   the deployment is accepted.

### Known Risks And Scope Guardrails

- Bitmap subtitle burn-in is compile-validated but not exercised on this host.
- The live image predates the responsive pass; current count discrepancies are
  investigation targets, not guaranteed fixes.
- No further broad redesign is queued. Make targeted corrections from deployed
  evidence and preserve the current visual system.
- Authentication, multi-user support, new page routes, and a media-versions
  data model are separate product decisions; do not introduce them as incidental
  fixes.
- Historical notes below mention full runtime `node_modules`, seeded demo
  behavior, glow-heavy cards, old logos, hover-only arrows, and earlier player
  layouts. None is current guidance.

---

## Historical Task Log — Append-Only, Non-Authoritative

Task ID: 2
Agent: orchestrator (main)
Task: Backend — API routes + lib modules.

Work Log:
- `src/lib/media-queries.ts`: serialization + all DB queries (home, featured, trending, popular movies/tv, top-rated, new releases, by-genre, continue-watching, detail with seasons/episodes/nextEpisode, browse, search, my-list, stats, saveProgress, toggleMyList). Bulk-attaches My List flags + latest progress.
- `src/lib/tmdb.ts`: TMDB client (search, fetch movie/TV, apply metadata incl. episodes + genres). Reads key from LibraryConfig or env.
- `src/lib/scanner.ts`: filesystem scanner — detects movies (files) & TV shows (Season folders / SxxExx files), cleans titles, creates stub Media + Episode rows, optional TMDB auto-match. Idempotent.
- `src/lib/streamer.ts`: HTTP Range video streamer (206 partial content, content-type by extension).
- 14 API routes under `/api/*`: library/{home,stats,genres,browse,scan}, media/[id], media/[id]/stream, episodes/[id]/stream, search, progress (GET+POST), collections, collections/toggle, metadata/search, metadata/apply.

Stage Summary:
- Full REST backend matching the API contract in this worklog. Seeded DB returns 6 featured / 9 rows / 6 continue-watching / 28 titles / 50 episodes / 85h.

---
Task ID: 3
Agent: orchestrator (main)
Task: Frontend — all UI components + single-page app.

Work Log:
- `src/components/providers.tsx` (QueryClient + next-themes, dark default), `src/app/layout.tsx` (Lumina metadata, favicon=generated logo-mark).
- `src/lib/queries.ts`: TanStack Query hooks (useHome, useStats, useGenres, useMediaDetail, useBrowse, useBrowseInfinite, useSearch, useMyList, useContinueWatching, useToggleMyList, useSaveProgress, useScan, useMetadataSearch, useApplyMetadata).
- `src/store/media-store.ts`: Zustand view-state router (home/movies/tv/search/mylist/library) + detail & watch overlays.
- Components: Logo (SVG luminous aperture + ThemeToggle), TopNav (scroll blur, desktop nav, expandable search, mobile Sheet), Footer (sticky, stats-aware), HeroCarousel (auto-rotate, scrim, procedural/brand/TMDB backdrop fallback), ContentRow (arrow scroll, snap), MediaCard (poster, hover info, progress bar, quick play/add), ContinueWatchingCard, ProceduralPoster (boutique gradient art), DetailOverlay (Dialog, seasons/episodes, More Like This), VideoPlayer (custom: seek/volume/speed/fullscreen/±10s/next-ep, resume, progress save every 5s + on close, keyboard shortcuts), BrowseView (genre+sort filters, infinite load-more), SearchView, MyListView, LibraryView (stats cards, scan form, media table w/ TMDB fetch), Skeletons.
- `src/app/page.tsx` → `<AppShell/>` (only route). Cinematic dark theme + amber accent (no indigo/blue).

Stage Summary:
- Complete Netflix/Apple TV/Plex-style UI. Lint clean. Renders with HTTP 200, no console/runtime errors.

---
Task ID: 4
Agent: orchestrator (main)
Task: Seed + branding.

Work Log:
- `scripts/seed.ts`: 18 movies + 10 TV shows with real metadata (titles, years, ratings, genres, overviews, taglines, runtimes, certifications, TMDB genre IDs), 5 episodes per show, watch progress on 6 titles, 4 My List items. Playable sample MP4 streamUrls (reachable hosts: vjs.zencdn, media.w3.org, w3schools, test-videos.co.uk).
- Branding via image-generation skill: `public/brand/logo-mark.png` (1024²), `hero-1.png` + `hero-2.png` (1344×768 cinematic amber backdrops). SVG Logo component for crisp vector mark.
- Procedural poster system as graceful fallback (no broken images).

Stage Summary:
- Demo is immediately rich & playable. Real local media + TMDB key wired for production use.

---
Task ID: 5
Agent: orchestrator (main)
Task: Integration + browser verification.

Work Log:
- Fixed: invalid lucide export `FilmClapper`→`Film` (caused 500); React set-state-in-effect lint errors (keyed `PlayerSession` remount + keyed `DetailContent`); 403 sample-video host swapped for reachable hosts; player now uses `streamUrl` directly.
- Agent-browser end-to-end verification (desktop 1440×900 + mobile 390×844):
  - Home: hero carousel (Breaking Bad/Dark Knight), Continue Watching (6), 9 content rows, cards with hover play/add + progress bars.
  - Detail overlay (Breaking Bad): overview, 5 episodes w/ play buttons, "More Like This" row, My List state correct.
  - Video player: video loads & plays (readyState 4, duration 52s, paused=false), seek bar advances, controls (Pause/Rewind/Forward/Mute/Next-ep/Fullscreen) auto-hide & reappear on mousemove, resume works, Esc closes.
  - Movies (18 cards), TV Shows (10 cards), My List (4 cards), Search "dark"→The Dark Knight, Library (stats + scan form + media table; Scan button returns "Scan finished" with stats).
  - Sticky footer confirmed (short page: footer at viewport bottom; long page: pushed down naturally). Mobile: hamburger nav, hero, no errors.
  - dev.log clean (no errors/warnings/hydration issues); ESLint clean.

Stage Summary:
- Browser-verified, fully interactive, production-ready personal media streaming frontend.

---
Task ID: 6
Agent: orchestrator (main)
Task: Library sections (separate scan roots, unified display) + subtitle detection/playback + host-mounted DB + Docker deployment.

Work Log:
- Schema: added `LibrarySection` (name, type, category, mediaDir, tmdbKey, autoMatch, scan stats) + `Subtitle` (language, label, filePath/streamUrl, format, isDefault) models. Added `sectionId`/`category` to Media (denormalised for fast unified queries). Pushed to DB.
- `src/lib/subtitles.ts`: subtitle format detection, language parsing from filenames, `findSubtitlesForVideo` (detects sibling .srt/.vtt/.ass files matching video base name), `srtToVtt` converter, `readSubtitleAsVtt` (serves local subs as VTT).
- `src/lib/scanner.ts`: rewritten for per-section scanning (`scanSection` takes a sectionId, reads that section's mediaDir, assigns sectionId + category to each media, detects + persists subtitle tracks for every video file).
- `src/lib/media-queries.ts`: added `serializeSubtitles` helper, included subtitles in MediaDetail + Episode responses, added optional `category` filter to browse, added section CRUD (getSections, createSection, updateSection, deleteSection, getSubtitle).
- API routes: `/api/sections` (GET/POST), `/api/sections/[id]` (PATCH/DELETE), `/api/sections/scan` (POST — per-section scan), `/api/subtitles/[id]` (GET — serves VTT, converts SRT, redirects remote). Updated `/api/library/scan` to scan all sections sequentially.
- `src/lib/queries.ts`: added useSections, useCreateSection, useUpdateSection, useDeleteSection, useScanSection hooks. Added optional `category` to BrowseParams.
- Video player: added `<track>` elements for each subtitle, CC button (Captions icon) with menu (Off + language list), `applySubtitle` sets track.mode showing/disabled. Default subtitle auto-shows on load. CC icon turns primary when active.
- Library view: rewritten with section cards (name, type/category badges, editable media dir, per-section Scan button, delete), Add Section form (name/type/category/dir), Scan All Sections button, global TMDB key, inline scan results per section. Media table kept below.
- Seed: 4 sections (Movies, Movies-Anime, TV Shows, TV-Anime), 6 anime titles added (3 movies + 3 TV shows), all media assigned to sections by type+category, 6 subtitle records attached (sample VTT at /public/subtitles/sample-en.vtt). 34 titles total, 65 episodes.
- Docker: `Dockerfile` (3-stage: deps → build → runner, copies standalone + prisma CLI for db push), `docker-entrypoint.sh` (runs `prisma db push` on start, idempotent), `docker-compose.yml` (Portainer stack with host bind mounts for /data DB + 4 media directories, no Docker volumes), `.dockerignore`.

Stage Summary:
- Browser-verified: 4 sections render with per-section Scan buttons; per-section scan returns result inline; home/browse show anime + regular unified (Attack on Titan, Death Note, Akira appear alongside regular titles); subtitle CC button appears in player, menu shows Off/English, toggling changes track mode showing↔disabled; video plays with subtitles on by default. Lint clean, no runtime errors.
- Docker: build with `docker build -t lumina .`, deploy via Portainer stack. DB on host-mounted `./data`, media on host-mounted paths. Entrypoint auto-creates schema on first start.

---
Task ID: 7
Agent: orchestrator (main)
Task: Fix Docker prisma CLI "Cannot find package 'effect'" error on container startup.

Work Log:
- Diagnosed: Dockerfile only copied `node_modules/prisma`, `node_modules/@prisma`, `node_modules/.prisma` into the runner — missing transitive deps like `effect` (required by `@prisma/config`). The Prisma CLI failed to run `db push` on startup.
- Root cause compounded: `oven/bun:1` runner image ran the Prisma CLI under Bun (the `node` command delegated to Bun), whose module resolution couldn't find the missing `effect` package.
- Fix 1: Switched runner stage from `oven/bun:1` to `node:20-slim` — the Prisma CLI is designed for Node.js, and the Next.js standalone server runs perfectly on Node 20. Added `openssl` + `ca-certificates` install (Prisma query engine needs openssl on slim images).
- Fix 2: Copy the FULL `node_modules` from the builder instead of cherry-picking packages. This guarantees ALL transitive dependencies (effect, etc.) are present. The full node_modules overlays the standalone's minimal node_modules (superset).
- Updated `docker-entrypoint.sh`: clearer error message with manual fix command, still non-blocking (server starts even if db push fails, for existing DBs).

Stage Summary:
- User rebuilds: `docker build -t lumina:latest .` then redeploy. On a fresh /data volume, `prisma db push` will now succeed and create all tables before the server starts.

---
Task ID: 8
Agent: orchestrator (main)
Task: Audio diagnosis + Recently Added home rows + TMDB key persistence + scan warnings clarity.

Work Log:
- **Audio diagnosis**: Added `audioError` + `audioHintDismissed` state to video player. Added `onError` handler on `<video>` that flags `MEDIA_ERR_DECODE`. Added a useEffect that checks `audioTracks` for disabled tracks after playback starts. Renders a dismissible amber banner explaining the likely cause (AC3/DTS/TrueHD codec) with an ffmpeg re-encode command. (Note: real audio transcoding via ffmpeg is a future feature; this surfaces the problem clearly.)
- **Recently Added rows**: Added `getRecentlyAddedEpisodes(limit)` (newest episodes, deduped by show, with episode S/Ep context) and `getRecentlyAddedMovies(limit)` to media-queries. Wired both into `getHomeData` as the first two rows after Continue Watching: "Recently Added Episodes" + "Recently Added Movies". Added `createdAt` to MediaSummary type + `toSummary`. Added a "NEW" badge to MediaCard for items added within 14 days.
- **TMDB key persistence**: Added `saveTmdbKey(key)` to media-queries (upserts LibraryConfig.tmdbKey). Added `tmdbKey` to LibraryStats response. New API route POST `/api/library/config`. New `useSaveTmdbKey` hook. Updated Library view: useEffect loads saved key from stats into the input, a "Save" button persists it, a "Saved" indicator appears when a key is stored. Verified key survives page reload.
- **Scan warnings clarity**: Scanner now distinguishes ENOENT (directory doesn't exist) with a helpful message about checking docker-compose volume mappings, vs other read errors.

Stage Summary:
- Browser-verified: Home shows Continue Watching → Recently Added Episodes → Recently Added Movies → Trending → ...; New badges appear on recently-added cards; TMDB key Save button persists the key to DB (survives reload, "Saved" indicator shows); audio decode errors surface a dismissible hint banner with ffmpeg fix. Lint clean, no runtime errors.

---
Task ID: 9
Agent: orchestrator (main)
Task: Hero carousel edge alignment + bundle ffmpeg for native codec decoding/transcoding.

Work Log:
- **Hero carousel redesign**: Rewrote HeroCarousel with consistent `px-4 sm:px-6 lg:px-8` padding matching ContentRow. Content now vertically centered in a flex column (justify-end), aligned to the same horizontal padding as rows. Added left/right slide arrows (desktop). Slide indicators aligned to the right edge with the same padding. Top scrim added for nav legibility. Home view now pulls hero up under the transparent nav (`-mt-16`) for full-bleed cinematic feel. Verified: hero H1, Continue Watching H2, and row H2s all align at exactly 32px left.
- **Dockerfile**: Added `ffmpeg` to the apt-get install in the runner stage — Lumina now bundles ffmpeg/ffprobe so it can decode any codec (AC3, DTS, TrueHD, HEVC, etc.) without you pre-encoding your library.
- **`src/lib/transcoder.ts`**: `probeCodecs(filePath)` runs ffprobe to detect video/audio codecs + browser compatibility. `spawnTranscode(filePath, codecs, opts)` spawns ffmpeg: copies H.264/HEVC video (fast), transcodes incompatible video to H.264, always transcodes audio to AAC, outputs fragmented MP4 (streamable) to stdout. Supports `-ss` start time for resume.
- **Stream routes**: `/api/media/[id]/stream?transcode=1` and `/api/episodes/[id]/stream?transcode=1` — when transcode=1, runs ffmpeg and pipes output. Added `/api/media/[id]/probe` + `/api/episodes/[id]/probe` returning CodecInfo.
- **`src/lib/queries.ts`**: Added `useProbe(kind, id, enabled)` hook + `CodecInfo` type.
- **Video player**: Added `transcodeOverride` state (null=auto, true/false=user choice). Effective `transcode` = override ?? auto-from-probe. Source URL appends `?transcode=1&t=<resumePos>` when transcoding. Audio decode error now auto-enables transcoding (falls back to ffmpeg AAC). Added "Compatibility" toggle in the settings menu (speed menu) for local files. "COMPAT" badge shown next to title when transcoding. Updated audio hint banner to say "Switched to compatibility mode" (transcoding is now automatic, no manual ffmpeg needed).

Stage Summary:
- Browser-verified: hero text aligns with row titles (32px); slide arrows + indicators work; no errors. Probe endpoint returns codec info. Transcode fallback wired (auto on probe-incompatible or audio decode error). Lint clean. Docker image now includes ffmpeg for native codec support.

---
Task ID: 10
Agent: orchestrator (main)
Task: Code review — scroll-snap misalignment + ffmpeg process leak + range parsing + minor fixes.

Work Log:
- **[CRITICAL] ContentRow scroll-snap misalignment**: `scrollSnapType: "x proximity"` + `scrollSnapAlign: "start"` on children inside a padded scroll container caused the browser to snap to a non-zero scrollLeft on load/layout changes. Removed scroll-snap entirely. Also debounced the scroll handler with requestAnimationFrame (was running setState on every scroll tick). Fixed `canR` initial state to `false` (was `true`, causing a brief arrow flash on short rows). Verified: all 12 rows now start at scrollLeft=0, first card at exactly 32px.
- **[CRITICAL] ffmpeg process leak**: When the client disconnects (seek, close player, switch episode), the ffmpeg process spawned for transcoding was never killed — it kept running until it finished the entire file. Added `registerTranscodeCleanup(proc, signal)` to transcoder.ts that listens to `req.signal` abort and sends SIGTERM (with SIGKILL fallback after 2s). Wired into both stream routes.
- **[CRITICAL] Range request parsing**: streamer.ts didn't handle suffix-range syntax (`bytes=-100` = last 100 bytes), didn't clamp start/end to valid bounds, and didn't return 416 for malformed ranges. Rewrote `parseRange()` to handle all three syntaxes (explicit, open-ended, suffix) with proper clamping + 416 response.
- **[MEDIUM] Path leakage**: streamer.ts 404 error responses included `path: filePath`. Removed from all error responses.
- **[MEDIUM] Unused imports**: Removed `fs`/`path` from transcoder.ts (neither was used).
- Verified: lint clean, no runtime errors, all rows aligned at 32px.

Stage Summary:
- 4 bugs fixed (1 user-reported + 3 found in review). ContentRow alignment verified in browser. ffmpeg cleanup prevents CPU waste. Range parsing is now spec-compliant.

---
Task ID: 11
Agent: orchestrator (main)
Task: Card hover redesign + filesystem auto-watch (Plex-style) + Categories nav dropdown + new logo.

Work Log:
- **Card hover redesign**: Rewrote MediaCard using Framer Motion. On hover: scale 1.12 (spring physics, stiffness 350/damping 28), translate-y -8px, golden ring + glow shadow (`box-shadow: 0 20px 50px... + 0 0 0 2px primary + 0 0 30px primary glow`), info panel slides up with play/add/info buttons, genres shown. Verified: matrix(1.12,0,0,1.12,0,-8) + shadow applied.
- **Filesystem auto-watch (Plex-style)**: Installed `chokidar`. Created `src/lib/watcher.ts` — `startMediaWatcher()` watches every LibrarySection's mediaDir with `awaitWriteFinish` (3s stability), ignores non-video files, debounces rescans (5s — handles batch copies), calls `scanSection()` on new files. Created `src/instrumentation.ts` (Next.js instrumentation — runs once on server boot, starts watcher after 3s delay). Verified: all 4 sections watched on server restart ("[Lumina Watcher] Watching Movies → /media/movies" etc.).
- **Categories dropdown**: Added "category" route to store (`setGenreFilter` now sets route to "category"). Updated BrowseView to sync genre from store + show genre name as title. Added Categories dropdown to TopNav using DropdownMenu component — lists "All Movies", "All TV Shows", + all genres. Mobile nav gets a genre chip cloud. Verified: clicking "Action" navigates to browse view filtered by Action (7 titles, title="Action").
- **New logo**: Redesigned SVG LogoMark — 8 play-button-triangle rays radiating outward (alternating long/short), golden sun core with radial gradient, dark play triangle at center. Wordmark uses gold gradient text fill (`#FFFBEB → #FCD34D → #F59E0B`). Also generated an AI image logo mark (`public/brand/logo-mark.png`) as alternate asset. Verified: 8 rays + gradient wordmark rendering.

Stage Summary:
- All 4 features browser-verified. Card hover: spring scale 1.12 + glow. Categories dropdown: genre filtering works. Filesystem watcher: auto-detects new media on all 4 sections. Logo: bright sun + play-button rays + gradient wordmark. Lint clean, no runtime errors.

---
Task ID: 12
Agent: orchestrator (main)
Task: Logo mockups (icon integrated into wordmark) + fix card glow to wrap fully + reduce Prisma log verbosity.

Work Log:
- **Card glow fix**: Root cause was twofold: (1) scroll container `overflow-x-auto` implicitly sets `overflow-y: auto` (CSS spec) which clipped the glow vertically; (2) the shadow had negative spread (`-5px`) making it weak/partial. Fixed by: adding `overflow-y-visible` + `py-4 pt-4 pb-6` to scroll container (room for glow); stronger shadow with POSITIVE spread so it wraps fully: `0 25px 60px -5px depth, 0 0 0 3px primary ring, 0 0 50px 12px amber glow, 0 0 80px 20px amber halo`. Added `z-index: 30` to hovered card so it sits above siblings. Verified: full glow wraps the scaled card.
- **Logo mockups**: Created 6 SVG mockups where the sun/play icon is integrated INTO the wordmark (like famous brand logos): 1) Sunrise L (L = sun over horizon), 2) Eclipse (sun behind wordmark, play triangle cut into L), 3) Play-i (the i is a sun with play-triangle stem), 4) Aperture (sun/aperture replaces the L), 5) Sunset (sun glows behind full wordmark, i-dot is play triangle), 6) Beam (light beams + sun disc integrated with L). Built a LogoReview modal (floating "Review Logos" button) showing all 6 on dark + light backgrounds. User can review and pick.
- **Prisma log fix**: Changed `log: ['query']` to `log: ['warn', 'error']` in dev — the query logging was flooding the process and causing server hangs under load.

Stage Summary:
- Card glow now wraps fully around the card (positive-spread shadow + visible overflow + z-index boost). 6 logo mockups available for review via floating "Review Logos" button. Lint clean, server responsive (197ms API).

---
Task ID: 13
Agent: orchestrator (main)
Task: Fix glow on Continue Watching cards + dial back spring + new AI logo mockups from famous-brand reference.

Work Log:
- **Continue Watching glow fix**: ContinueWatchingCard was using old CSS hover (no spring, no glow, clipped by overflow). Rewrote with Framer Motion matching MediaCard: spring scale 1.08, y -6, full glow shadow (ring + amber glow + halo), z-index 30 on hover. Also fixed its container in home-view: added `overflow-y-visible` + `py-4 pt-4 pb-6` so glow isn't clipped.
- **Spring dialed back**: Both MediaCard and ContinueWatchingCard now use stiffness 250 (was 350), damping 30 (was 28), scale 1.08 (was 1.12), y -6 (was -8). Gentler, less bouncy.
- **AI logo mockups**: User provided famous-brand-logos grid as reference (Apple, Netflix, McDonald's, etc. — minimalist, iconic). Generated 4 AI logo variations using image-generation skill: v1) Sun behind wordmark (play-button rays glowing through text), v2) Sun as the letter O (icon IS a letter), v3) Sunrise behind L (Paramount/Netflix feel), v4) Standalone icon mark (golden sun + 8 play-triangle rays + play center). Updated LogoReview to show PNG images instead of SVG mockups. All 4 visible in review modal.
- **Prisma log fix** (from prior task): confirmed server responsive at ~200ms.

Stage Summary:
- Both card types (MediaCard + ContinueWatchingCard) now have identical dialed-back spring (1.08/-6) + full glow wrapping. 4 AI logo mockups available for review via "Review Logos" button. Lint clean, no errors.
