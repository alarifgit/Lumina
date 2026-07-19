# Lumina — Personal Media Streaming Frontend · Worklog

## Current Handoff

Updated: 2026-07-19. This section,
[Detailed Current Handoff](#detailed-current-handoff), and
[Prioritized Roadmap](#prioritized-roadmap) are authoritative. Every task log
or old design/API specification is historical context only.

### Continue Here

1. Read `AGENTS.md`, this section, and
   [Detailed Current Handoff](#detailed-current-handoff); then inspect
   `git status`, `git diff --stat`, and the complete diff. Never reset or
   discard the current working tree.
2. Do not begin another broad visual redesign. The user likes the current
   direction; continue the targeted Lumina-signature polish and verify it
   against real artwork rather than replacing the smoked-glass system.
3. Before any production rescan, use the implemented P0 scanner safety and
   diagnostic gate in [Prioritized Roadmap](#prioritized-roadmap), retain every
   manifest, and require complete traversal before reconciliation.
4. Build on the capable host, transfer/import the image, preserve the exact NAS
   `/data` and media mounts, and follow `DEPLOYMENT.md` for verification and
   rollback.

### Current State

- P0-A, **Make Production Scans Safe And Explainable**, is implemented in the
  working tree on top of clean baseline `144c976`. It is compile-validated and
  fixture-test-validated. The user rebuilt the live service with the scanner,
  parser, inventory, credential-redaction, progress, grouped-search, and shelf-
  browse work, but the scanner has still not been verified by a controlled
  production section scan with a retained manifest. The later parent-show Plex
  identity, apply-safe preview, collision-safe TMDB auto-match, and scan-request/
  watcher reliability fixes described below remain local.
- Section scans now serialize through one per-section queue shared by manual
  API calls and watcher scans. Reconciliation uses normalized exact paths
  first; title/year reuse is limited to rows with no path or a path proven
  absent, and live path/TMDB collisions remain distinct and are reported.
- Every scan returns a path manifest containing discoveries, parser results,
  ignored/unsupported paths and reasons, traversal errors, identity
  collisions, and rows proposed as unavailable. Any relevant traversal error
  marks the scan incomplete and suppresses all media/episode unavailable
  reconciliation for that section.
- Missing episodes are retained with a null `filePath`; metadata refresh no
  longer deletes unavailable episode rows, preserving metadata, subtitles, and
  watch progress. Settings exposes manifest counts and expandable path detail
  for all-section and individual-section scans without changing its design.
- TV folders are now prevalidated against stat-able, supported `SxxExx` video
  files before a show row or TMDB match can be created. Empty folders, empty
  season folders, and sidecar-only folders are explained as ignored; a legacy
  row pointing at one becomes unavailable while its metadata and progress are
  retained. Episode identity now trusts the filename for Specials and
  conflicting folder labels and accepts three/four-digit episode numbers such
  as `E100`.
- `npm test` now runs 63 Node test cases against temporary media trees and a
  fresh isolated SQLite database. Coverage includes numeric titles, dotted
  folder names, common release tags, AppleDouble sidecars, recursive
  collections, extras filtering, empty/sidecar-only folders, Specials and
  three-digit episodes, same-title live paths, rename recovery,
  partial traversal, episode/history preservation, idempotent rescans,
  deep-recursion gating, normalized rename recovery, subtitle-discovery
  failure preservation, per-section serialization, grouped playable search,
  shelf ordering and pagination, disjoint movie/full-series watch states,
  exact playable resume targets, Plex section scoping and parent-show identity,
  collision-safe TMDB auto-match decisions, and direct/transcoded progress
  timelines.
- A production-diagnostic parser follow-up now treats a suffix as an extension
  only when it is a supported video extension, ignores filesystem metadata
  such as `._*`, `.DS_Store`, `@eaDir`, and `#recycle`, and trims release tags
  without losing the real title/year. Regression fixtures keep `1917` and
  `Casino Royale` available across idempotent rescans. These fixtures explain
  credible failure modes from the reported library, but do not replace an
  itemized NAS manifest.
- Library Management now searches titles server-side, filters by availability
  and TMDB match state, labels both states in the table, and appends genuine
  100-row pages instead of refetching page one with a larger limit. Plex preview
  retains proposed changes before unmatched detail, omits already-synced and
  no-change detail from the bounded response, and exposes Needs attention,
  Changes, and Unmatched filters.
- Transcoded playback progress now uses one absolute timeline: the FFmpeg
  segment offset is added to the browser clock and total duration prefers the
  probed source duration, then metadata runtime, then a finite browser duration.
  Stop preserves the current position rather than resetting the element first,
  and progress writes use `keepalive`. This is automated-test-validated but
  still needs named real-media playback/resume verification after deployment.
- Public library/config/section responses now expose only whether a TMDB key is
  configured, never the credential itself. The Settings replacement-key flow
  preserves the stored key when the field is untouched. A fixture-only first
  load also exposed a concurrent “My List” creation race; creation is now an
  atomic upsert.
- A 2026-07-14 read-only live audit proved that aggregate counts are not enough:
  an earlier deployed Movies section reported 478 playable rows while `1917`
  and `Casino Royale` were absent even with inventory availability set to
  `all`. Both titles are present again in the latest rebuilt service. No
  retained itemized Movies manifest exists for the intervening scan, so the
  original disappearance is operationally recovered but not path-level
  explained.
- The same audit explained the Anime movie drop from 21 to 19. The previously
  supplied manifest contains 19 real feature files and two `._` AppleDouble
  sidecars; the corrected scanner now excludes those sidecars, so 19 is the
  evidence-backed playable total rather than a regression.
- A Plex scope follow-up is now local: selecting a Movies section filters Plex
  preview input to movies, and selecting TV filters it to episodes. Before this
  fix, a Movies-only preview scanned all 6,553 Plex items and produced 6,086
  mostly false unmatched rows from TV episodes. The latest per-section scan
  result is also retained for the current server session and can be reopened
  from Settings after navigating away. Library Management title search now
  also searches local source paths and displays the path beneath each title.
- A focused responsive refinement is also present in the same uncommitted
  tree: shelf arrows use a stable higher stacking layer and fixed control
  geometry; Home shows up to three stronger featured tiles; Home and browse
  poster sizing is reduced at desktop/ultrawide widths; and browse spotlight
  artwork is restrained with the established steel-blue grade.
- A subsequent targeted Lumina-signature pass strengthens the same design
  without restructuring it: Home feature tiles now carry restrained editorial
  numbering, artwork receives warmer image-led grading and machined edge
  highlights, shelves have descriptive micro-hierarchy and title counts, and
  cards/heroes use slower custom motion curves. Browse spotlights gained an
  explicit failed-artwork fallback and a quiet library-curation marker. The
  8px geometry, Lucide controls, card density, navigation, Settings structure,
  and player layout remain intact.
- Settings now aligns its Configuration and Library Paths panels at the same
  top edge, and playback/transcoding status is condensed into the Settings
  header. Local browser geometry at 1694px and 3440px measured a 0px panel-top
  delta and no document-level horizontal overflow.
- The windowed player can grow to 2400px wide / 1240px tall, text subtitle cues
  are lifted farther above visible transport controls, and progress writes use
  `keepalive`. Show-level TV playback now saves against the resolved local
  episode instead of a null episode ID. These player changes remain real-media
  and deployment verification items.
- Search is now truthful and grouped. `/api/search` independently counts and
  caps playable Movies, TV Shows, and Episodes; episode rows include the exact
  local episode ID, artwork, and latest progress. The Search view exposes real
  count-bearing scopes, compact artwork-led results, exact episode play/resume,
  explicit loading/refresh/error/empty states, arrow-key result navigation, and
  `/` plus Ctrl/Cmd+K entry. Clearing the query remains in Search; Escape from
  an empty Search returns to the originating client-side view.
- Six Home shelves now have truthful `View all` destinations backed by the
  same typed predicates and stable ordering used for their previews: Recently
  Added Movies, Trending, Popular Movies, Popular Series, Top Rated, and New
  Releases. Continue Watching and Recently Added Episodes intentionally remain
  without `View all` until dedicated paginated contracts can reproduce their
  next-episode/deduplication semantics.
- Movies, TV, and shelf browse destinations now expose server-side All,
  Unwatched, In progress, and Watched states. TV is only watched when every
  locally playable episode is complete; partial series remain in progress and
  zero-position dismissal sentinels remain unwatched. Genre, sort, watch state,
  loaded React Query pages, and logical-view scroll positions persist per
  browse scope; changing a filter resets that scope to the top.
- Browse/search/Home previews now share playable-media filtering and stable
  pagination tie-breakers. Continue Watching requires a positive position and
  the exact movie or episode target to be playable. Shared media summaries only
  expose resume context for the newest incomplete playable target, so completed
  or unavailable episode history is preserved without creating a broken card
  CTA.
- Read-only deployment acceptance on 2026-07-14 confirms the latest grouped
  search and shelf-browse contracts are live. The service reports 706 playable
  titles: Movies 478, Movies (Anime) 19, TV Shows 179, and TV Shows (Anime) 30;
  6,033 locally playable episodes; 24 genres; and approximately 4,419 runtime
  hours. Search finds `1917` (2019) and `Casino Royale` (2006), watch-state
  totals partition exactly as 394 unwatched, 23 in progress, and 289 watched,
  and public configuration responses remain credential-redacted.
- A new preview-only Plex reproduction inspected 6,554 items and reported
  5,551 matches plus 1,003 unmatched rows. `Animal Kingdom (2016)` accounted
  for a repeated false-negative family: Plex includes the bracketed premiere
  year in `grandparentTitle`, while Lumina stores title `Animal Kingdom` and
  year `2016` separately. The local matcher now treats only a bracketed trailing
  year as an identity hint, excludes episode GUIDs from show identity, refuses
  ambiguous title fallbacks, preserves numeric titles, and distinguishes a
  missing show from a matched show with a missing exact episode. Settings shows
  that reason beneath unmatched preview rows. The preview used `apply: false`;
  no watched state changed.
- A later 2026-07-15 preview-only reproduction against the rebuilt service
  inspected 6,554 Plex items: 6,142 matched, 412 remained unmatched, 3,012 were
  already synced, and 61 Lumina changes were proposed. The attached 200-row
  attention window proved repeated false misses for locally present shows such
  as `Hell's Kitchen (US)`, both `Next Level Chef` regions, `Star Trek`,
  `PLUR1BUS`, and `Kitchen Nightmares (US)`. Plex episode `year` is the air
  year, not the series premiere year; title-only matching also selected the UK
  `Next Level Chef` row for US season 2. The local matcher now bulk-fetches each
  Plex TV section's parent shows, joins real parent identities, and uses
  collision-aware exact local source aliases. No Plex apply was run.
- The same evidence exposed two sticky historical metadata errors: the local
  `/media/tv/Mr. & Mrs. Smith (2024)` row is labelled `Mr. & Mrs. North`
  (1952), and `/media/movies/Run (2020)` is labelled `Chicken Run` (2000).
  Automatic TMDB matching is now conservative: one exact normalized title is
  required, source year must match when known, and auto scans never retry
  without the year. Existing TMDB IDs are not silently replaced; source-alias
  Plex reasons expose the resolved Lumina title so these rows can be corrected
  through explicit Fix Match.
- Manual scan reliability is now fixed locally. Scan POSTs return an immediate
  background job and the browser polls compact status responses; full manifests
  load lazily in 200-entry increments. Duplicate clicks attach to the same
  active scope. Watchers preserve dotted media directories, default to bounded
  polling for remote mounts, handle additions/changes/removals and subtitle
  events, refresh section registrations, and use the serialized scanner path.
  Unchanged videos still enumerate external subtitle sidecars but skip embedded
  `ffprobe`; watcher scans skip broad existing-metadata refresh. Home revalidates
  in the foreground so server-discovered media appears without a reload.
- Subtitle reconciliation now has independent sidecar and embedded completeness.
  A non-absence sidecar-directory read failure is a traversal manifest error
  and suppresses missing-path reconciliation; an embedded `ffprobe` failure is
  reported without pretending path traversal failed. Either uncertain source
  preserves its existing subtitle rows while a successfully discovered source
  can reconcile transactionally.

- Read-only live verification on 2026-07-13 confirmed the deployed responsive
  build at `http://10.41.6.100:3422`: Home rendered three featured titles; the
  Continue Watching rail exposed the correct reverse control after advancing
  and returned to its initial position; Settings rendered the compact
  playback/transcoding status in its header; and Configuration and Library
  Paths had a measured 0px top-edge delta at 1280x720 with no document-level
  horizontal overflow. No scan, playback, cleanup, or data mutation was run.
- That 2026-07-13 snapshot (704 titles; regular Movies 475; regular TV 178) is
  superseded by the 2026-07-14 706-title snapshot above. It remains historical
  evidence only. CPU/libx264 fallback was available; VAAPI initialization on
  `/dev/dri/renderD128` was not.

- Branch: `main`; last commit: `144c976`, also present at `origin/main`.
- The working tree contains the intentional P0-A scanner, responsive UI,
  player, test, and documentation changes described here. Do not discard or
  reset them.
- The currently deployed service is `http://10.41.6.100:3422`; read-only API
  markers on 2026-07-14 confirm that it contains the parser, inventory,
  credential-redaction, absolute-timeline progress code, grouped-search, and
  shelf-browse work. A 2026-07-19 read-only check also confirmed the background
  scan-job GET contract is deployed, correcting the older deployment marker.
  The service still lacks the later parent-show Plex/report contract; watcher
  runtime details and named real-media transcoded resume are not yet verified.
- The current live sections report 478 regular movies and 179 regular TV shows
  against the later-verification NAS references of 478 movie files and 180 TV
  directories. Matching aggregate movie totals are not an itemized proof, and
  the TV counting-definition difference remains unresolved.
- Lint, TypeScript, Prisma validation/generation, and `build:docker` passed on
  2026-07-13 against the current code tree. Local fixture-browser checks passed
  at 390px, 1024px, 1694px, and 3440px.
- After the signature-polish pass, lint, TypeScript, Prisma validation and
  generation, all eight scanner tests, `build:docker`, and `git diff --check`
  passed again. A temporary 81-title fixture sourced read-only from the live
  Home response was inspected locally at 1280x800 on Home and Movies. A 390px
  viewport measured 390px inner width with 375px document width; the refreshed
  mobile screenshot could not be retained, so mobile visual acceptance of the
  new decorative details remains a deployment check.
- After the scanner/parser, inventory, Plex-preview, and transcoded-progress
  follow-up, `npm run lint`, `npx tsc --noEmit`, `npx prisma validate`,
  `npx prisma generate`, all 14 tests, `npm run build:docker`, and
  `git diff --check` passed. A disposable 205-movie SQLite fixture was checked
  locally in the browser: page two appended from 100 to 200 rows without a
  top-of-page reset, title search isolated `1917`, availability isolated 12
  unavailable rows, and metadata filtering isolated 18 unmatched rows. The
  fixture database and helper were removed afterward.
- The 2026-07-14 diagnostic follow-up passes lint, TypeScript, Prisma
  validation/generation, 17/17 tests, `build:docker`, and `git diff --check`.
  No production scan, deployment, commit, push, or watched-state mutation was
  performed. The Plex request used preview mode (`apply: false`).
- The grouped discovery plus Plex identity and scan/watcher reliability tree
  now has 60/60 fixture tests. Scan jobs, dotted watcher paths, remote polling
  policy, add/change/remove events, year-suffixed Plex shows, ambiguous title
  fallbacks, numeric titles, deep traversal, normalized rename recovery,
  subtitle discovery failures, unchanged-video/external-sidecar analysis,
  parent-show Plex identities, preview/apply mutation boundaries, and
  conservative TMDB auto-match decisions are covered. Final validation
  evidence for this exact combined tree is recorded in Detailed Current
  Handoff below.
- Docker and FFmpeg are unavailable on this development host. Container
  startup, production scanning, hardware acceleration, embedded subtitle
  extraction, and bitmap subtitle burn-in remain unverified here.
- A 2026-07-19 cold audit found additional no-go items before a controlled
  production scan: startup/manual TMDB merge paths can still collapse distinct
  playable sources, missing-path reconciliation is not atomic, watcher scans
  need an empty-mount/mass-removal gate, duplicate episode identities need a
  collision policy, and progress writes need ownership, uniqueness, and
  ordering guarantees. The empty-folder/parser slice above is fixed locally;
  the remaining items stay prioritized below.

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

Updated: 2026-07-19

This section is authoritative for the next Codex task. Historical entries below
describe how Lumina evolved and can be stale or contradictory.

### Repository State

- Current continuation baseline is `144c976` on `main`, matching
  `origin/main`; all P0-A and follow-up changes remain intentionally
  uncommitted in the working tree. The NAS has the parser/inventory/player
  corrective build plus grouped search and shelf browsing. The newer
  parent-show Plex identity, collision-safe TMDB auto-match, apply-safe preview,
  and background scan/watcher reliability slice remain local. Older states
  below are retained as historical context only.

- Primary branch: `main`.
- The working tree contains intentional, uncommitted visual-system and player
  changes alongside documentation updates. Do not discard or reset them;
  inspect `git status` and the complete diff before editing.
- Last committed revision at this handoff: `144c976` (“Refine media browsing
  and playback state handling”).
- Commit `144c976` is present on both local `main` and `origin/main`.

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
- Reworked the Home feature carousel into an asymmetric artwork deck with up
  to three featured titles and aligned all shelves to the same page boundary.
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
- Refined the Home feature deck into a more authored editorial composition
  with quiet 01–03 indexing on desktop, warmer artwork illumination, nested
  edge highlights, and weighted CTA motion. Mobile hides desktop-only feature
  counters rather than implying inaccessible slides.
- Added descriptive shelf kickers and item counts so Home no longer reads as a
  stack of equal anonymous rows. Poster and Continue Watching cards now use
  slower custom easing, restrained image movement, exposure changes, and
  porcelain edge highlights instead of stronger glow or larger geometry.
- Refined browse spotlights with the same image-led grade, an unobtrusive
  curation mark, custom CTA motion, and a procedural-art fallback when remote
  artwork fails.

- Removed obsolete generator scripts, examples, local database, upload scratch
  files, unused Caddy configuration, and the unused logo-review component.
- Tightened `.dockerignore`/`.gitignore` and reduced Docker runtime dependency
  duplication.
- Added safe startup repair for duplicate TMDB identities.
- Introduced path-aware rescans, same-path row merging, media-row availability,
  recursive movie collection scanning, and common-extras filtering. The
  current P0-A implementation completes normalized fallback, traversal, and
  episode-history safety around that foundation.
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
- Hardened production filename handling for numeric titles, dotted directory
  names, release-tag suffixes, and filesystem metadata sidecars. Added
  inventory availability/TMDB filters and true incremental paging, prioritised
  Plex preview detail, redacted TMDB credentials from public API payloads, and
  restored absolute progress accounting for segmented transcodes.
- Scoped Plex previews to the selected Lumina section's media type, retained
  the latest scan manifest in process so Settings can reopen it, and made
  Library Management search and display local source paths for mismatched-title
  diagnosis.
- Replaced the misleading flat title-only search contract with grouped,
  playable Movie, TV Show, and Episode results. Search scopes are functional,
  individual episodes carry exact playback IDs and progress, the top-nav field
  is now a stable search launcher, and keyboard/error/loading/empty behaviour
  is explicit rather than inferred from a poster mega-grid.
- Added an internal preset-aware browse destination for six reproducible Home
  shelves, server-side movie/full-series watch-state filters, stable page
  ordering, per-scope filter persistence, and logical-view scroll restoration.
  Continue Watching and Recently Added Episodes deliberately have no fake
  full-list destination.
- Tightened shared discovery resume context so completed progress replays from
  the normal start/next-episode path and history for a missing episode cannot
  become a playable card action. Continue Watching likewise requires its exact
  saved target to remain locally playable.
- Corrected Plex show/episode fallback identity for titles formatted as
  `Title (Year)`: only a bracketed trailing year is separated, numeric titles
  remain literal, episode GUIDs are not mistaken for parent-show identity, and
  ambiguous normalized title/year keys refuse fallback instead of selecting an
  arbitrary Lumina row. Preview reasons now distinguish a missing show from a
  matched show with no exact local season/episode and are visible in Settings.
- Extended Plex TV matching to bulk-load real type-2 parent shows beside each
  type-4 episode inventory, join them by rating key/GUID/metadata key, and use
  the parent's TMDB/IMDb identity, title, and premiere year. Episode air years
  and episode GUIDs are never treated as show identity. Exact source-folder and
  source-title aliases recover regional/stylized names without fuzzy character
  replacement; ambiguous or contradictory identities refuse safely. A unique
  parent external ID may disambiguate a shared alias. Movie source-title aliases
  likewise explain metadata-retitled rows such as local `Run`/`Chicken Run`.
- Reworked Plex report detail into a bounded 2,000-row attention window with
  proposed changes retained before unmatched rows. Already-synced and skipped
  rows remain in aggregate counts but are omitted from response detail. Settings
  shows match reasons and truncation, resets filters per report, and binds Apply
  to the exact URL/token/direction/scope payload used for that preview; changing
  an input invalidates the preview.
- Added conservative automatic TMDB selection. Auto scans disable the yearless
  retry and apply metadata only for one exact normalized localized/original
  title candidate whose year also matches when the source year is known.
  Wrong, ambiguous, or year-mismatched candidates remain unchanged and add an
  explanatory identity-collision manifest entry. Manual Fix Match retains the
  broader search; existing TMDB IDs are never silently remapped.
- Detached manual scans from the initiating HTTP response. Scan POSTs now
  enqueue an in-process job, return `202`, and expose compact polling state;
  full path manifests load only when expanded and render in 200-entry chunks.
  Repeated clicks for the same scope attach to its active job, while the
  scanner's existing section queue remains the reconciliation authority.
- Made the watcher suitable for remote mounts: dotted directories are not
  rejected as files, additions/changes/removals and subtitle events schedule
  scans, registrations reconcile with section edits, and polling defaults to a
  bounded 10-second interval. Home revalidates while visible so watcher-added
  media appears without a page reload.
- Reduced unchanged-rescan analysis cost without hiding sidecar changes:
  unchanged video files skip embedded-subtitle probing but still enumerate and
  diff external subtitle files. A changed/new file probes embedded streams.
  Sidecar traversal and embedded-probe completeness are tracked separately so
  transient discovery failures cannot erase cached subtitle metadata.
- Prevalidated TV directory contents before creating or refreshing a show.
  Empty, empty-season, and sidecar-only folders now remain out of the playable
  library and receive path-level ignored reasons. Previously created empty-show
  rows are marked unavailable without deleting metadata or progress. Filename
  `SxxExxx` identity now handles Specials and `E100` and overrides a conflicting
  containing-directory label with an explicit collision explanation.

### Uncommitted Change Map

- Visual/chrome/discovery surfaces: `src/app/globals.css`, `app-shell.tsx`,
  `top-nav.tsx`, `home-view.tsx`, `hero-carousel.tsx`, `content-row.tsx`,
  `horizontal-rail.tsx`, `continue-watching-card.tsx`, `media-card.tsx`,
  `browse-view.tsx`, `search-view.tsx`, and the new
  `search-result-card.tsx`.
- Settings, inventory, scan, and Plex report UI: `library-view.tsx`.
- Playback UI and request accounting: `video-player.tsx`, both media/episode
  probe routes, `src/lib/transcoder.ts`, and the new
  `src/lib/playback-progress.ts`.
- Discovery/query state: `src/lib/media-queries.ts`, `src/lib/queries.ts`, the
  browse route, `src/lib/types.ts`, and `src/store/media-store.ts`.
- Scanner/subtitle/watcher runtime: `src/lib/scanner.ts`,
  `src/lib/subtitles.ts`, `src/lib/watcher.ts`, both scan routes, and the new
  `src/lib/scan-jobs.ts` and `src/lib/watcher-policy.ts`.
- Plex and metadata correctness: `src/lib/plex-sync.ts`,
  `src/lib/plex-scope.ts`, and `src/lib/tmdb.ts`.
- Test foundation: `package.json` plus the isolated suites and alias loader in
  `tests/`.
- Handoff and operating guidance: `AGENTS.md`, `README.md`, `DEPLOYMENT.md`,
  and this file.

The current tree addresses the scanner, progress, discovery, Plex-preview, and
watcher slices explicitly recorded here. Production media behaviour remains a
deployment check; do not infer it solely from the visual diff or local tests.

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
- Read-only deployment verification on 2026-07-13 confirmed the current Home,
  rail, Settings-header, and panel-alignment changes at 1280x720. It also
  confirmed live API availability and CPU/libx264 transcoding fallback. No
  production scan or playback was started, so scanner reconciliation,
  progress persistence, subtitle clearance, direct play, and subtitle
  conversion/burn-in remain unverified against real media.
- The later Lumina-signature pass was locally browser-inspected with a
  temporary 81-title fixture at 1280x800. Home and Movies retained their
  established page boundary and density, the feature hierarchy and new shelf
  rhythm rendered correctly, and 390px geometry had no horizontal overflow.
  The browser could not complete the refreshed 390px screenshot, so final
  mobile visual inspection remains required after deployment. No production
  state was mutated for this fixture check.
- The 2026-07-13 production-diagnostic follow-up passed the complete validation
  set again. `npm test` reported 14/14 passing. A temporary 205-row SQLite
  fixture validated inventory search, availability/TMDB filters, and 100-row
  append pagination in the local browser. No NAS scan, production playback,
  deployment, commit, or push was performed.
- The 2026-07-14 read-only deployment audit reported 706 playable titles:
  Movies 478, Movies (Anime) 19, TV Shows 179, and TV Shows (Anime) 30.
  In the earlier image, `1917` and `Casino Royale` returned zero rows even from
  availability=`all`, proving that a matching aggregate was not an itemized
  reconciliation. A preview-only Plex request also exposed cross-type section
  scoping. The local corrective follow-up passed the complete validation set
  with 17/17 tests.
- The 2026-07-14 grouped-search and shelf-browse slice passed `npm run lint`,
  `npx tsc --noEmit`, Prisma validation/generation, 25/25 Node tests,
  `build:docker`, and `git diff --check`. An isolated 42-title/56-episode SQLite
  fixture exercised the local APIs: `Night` returned movie, show, and exact
  episode groups; `1917` remained a movie with no false episode match; preset
  order returned the expected first page; and watched/in-progress/unwatched
  sets were disjoint. The disposable database was removed. The in-app browser
  runtime failed to initialise in this desktop session, so responsive layout,
  focus movement, and scroll restoration are compile/API-validated but still
  require fixture-browser or deployment acceptance. No production scan,
  deployment, playback, commit, or push was performed.
- Read-only acceptance against the subsequently rebuilt service on 2026-07-14
  confirmed 706 playable titles, 6,033 playable episodes, 24 genres, and about
  4,419 hours. `1917` (2019) and `Casino Royale` (2006) now resolve normally;
  movie/show watch-state totals partition exactly as 394 unwatched, 23 in
  progress, and 289 watched. All four current-session retained-report GETs
  returned 404, so the recovered titles still lack path-level scan evidence.
- A Plex preview with `apply: false` inspected 6,554 items: 5,551 matched,
  2,770 already-synced rows, one pending Lumina change, and 1,003 unmatched.
  Repeated `Animal Kingdom (2016)` episode false negatives reproduced the
  bracketed-year parent-title defect despite the Lumina show row being matched
  to TMDB. No Plex apply or watched-state mutation was performed.
- Final validation of the exact combined local tree on 2026-07-14 passed
  `npm run lint`, `npx tsc --noEmit`, `npx prisma validate`,
  `npx prisma generate` (Prisma Client 6.19.3), `npm test` (40/40 across eight
  suites), `npm run build:docker` (Next.js 16.2.9), and `git diff --check`.
  This is compile/fixture validation only: no production scan, Plex apply,
  playback mutation, deployment, commit, or push was performed.
- A 2026-07-15 read-only Plex preview against the rebuilt service inspected
  6,554 items: 6,142 matched, 412 unmatched, 3,012 already synced, and 61
  Lumina changes proposed. The response remained preview-only (`apply: false`).
  Its supplied 200-row attention detail is the evidence for the parent-year,
  regional-alias, duplicate-title, and sticky-metadata findings recorded below.
- Final validation of the exact 2026-07-15 local tree passed `npm run lint`,
  `npx tsc --noEmit`, `npx prisma validate`, `npx prisma generate` (Prisma
  Client 6.19.3), `npm test` (60/60 across nine suites),
  `npm run build:docker` (Next.js 16.2.9), and `git diff --check`. This remains
  compile/fixture validation: no production scan, Plex apply, deployment,
  playback mutation, commit, or push was performed.
- The 2026-07-19 empty-folder and episode-parser hardening passed `npm run
  lint`, `npx tsc --noEmit`, `npx prisma validate`, `npx prisma generate`
  (Prisma Client 6.19.3), `npm test` (63/63 across nine suites), and `npm run
  build:docker` (Next.js 16.2.9). `git diff --check` is recorded after the
  handoff update. No production scan, Plex apply, deployment, playback
  mutation, commit, or push was performed.

### Confirmed Audit Findings

P0-A status update (2026-07-14): exact-path reconciliation, traversal gating,
non-destructive episode availability, section serialization, manifests, and
the temporary-tree/isolated-SQLite test foundation are implemented locally.
The parser suite also covers numeric titles, dotted names, common release tags,
and AppleDouble/system metadata. Background scan jobs and the remote-safe
watcher close the later request-lifetime and NAS-event reliability gaps.

The original `1917` and `Casino Royale` disappearances are operationally
recovered in the current live service, but not considered path-level explained
until a complete retained Movies manifest names both files. No production scan
was run in this task.

The 2026-07-15 Plex preview proves that a Lumina metadata match and a Plex
episode match are different identity layers. `Hell's Kitchen` was searchable
and playable locally while all 32 attached Plex episode rows said no Lumina
show. The cause was using the episode air year as the show year plus losing
regional/source aliases after TMDB retitled the local row. Parent-show identity
and exact collision-aware source aliases are now fixture-tested locally. The
remaining season-zero rows in the supplied preview are not assumed to be false:
they represent Plex specials for which Lumina may genuinely have no local file.

`Mr. & Mrs. Smith (2024)` → `Mr. & Mrs. North (1952)` and `Run (2020)` →
`Chicken Run (2000)` are confirmed local metadata errors. The new automatic
match gate prevents these title/year mismatches for future unmatched rows, but
the existing sticky IDs require explicit Fix Match review after deployment.

Remaining confirmed or deliberately deferred gaps:

- Startup duplicate repair and the shared manual TMDB apply path can still
  delete/merge a row without proving a second playable path is unavailable.
  The authoritative merge policy must refuse distinct live file/stream paths,
  including cross-section races, before the unique identity is repaired.
- Missing-path reconciliation applies individual updates outside one
  transaction. A failure can leave a partially unavailable section without a
  retained completed manifest. Batch the reconciliation phase atomically and
  add failure-injection rollback coverage.
- Watcher-originated scans currently treat an empty-but-readable remote mount
  as a complete traversal. Require a manual confirmation/safety gate for a
  zero-result or mass-removal watcher scan.
- Duplicate files resolving to one `(show, season, episode)` still need a
  path-preserving collision policy rather than last-path-wins updates.
- Progress writes lack a single atomic logical target and request ordering;
  cleanup/auto-next/transcode races can overwrite newer progress. Validate
  episode ownership, repair duplicates, and order writes before deployment.
- Lumina has no first-class multiple-edition/version model. The scanner keeps
  distinct live paths and reports identity collisions; product representation
  of several files sharing one TMDB identity remains future work.
- Scan jobs and manifests are process-local by design. They survive browser
  navigation and a closed request, but not a container restart; deployment
  operators must retain reports before restarting.
- The current analysis shortcut covers unchanged embedded-subtitle probing;
  codec/container analysis is not yet a general path/size/mtime cache.
- Player geometry and absolute transcoded-progress logic are locally validated,
  but direct play, compatibility fallback, restart/resume, and subtitle
  clearance still require named real-media deployment checks.
- There is no CI workflow. `/api` still returns `Hello, world!`, and the image
  has no structured readiness endpoint or Docker health check.

### Prioritized Roadmap

#### P0-A — Make Production Scans Safe And Explainable (Hardening Required Before Production Scan)

Completed on top of `144c976`: normalized path-first reconciliation,
unavailable-only title/year recovery, live-path and TMDB collision reporting,
traversal completeness gating, non-destructive episode availability,
per-section scan serialization, API/UI manifests, and temporary-tree/isolated
SQLite regression tests. The later reliability slice adds request-independent
scan jobs, compact polling, lazy full-manifest retrieval, remote-mount watcher
polling/event coverage, dynamic section subscriptions, foreground Home
revalidation, and unchanged-video embedded-subtitle probe avoidance.
The core scanner safety code is present in the current live image but has not
had a controlled production scan. The deployed image exposes the background
scan-job contract, while the parent Plex identity/report fix remains local.
Do not run the controlled scan until the remaining merge, atomic
reconciliation, watcher empty-mount, duplicate-episode, and progress-integrity
gates in Confirmed Audit Findings are resolved and fixture-tested.

Original P0-A validation completed on 2026-07-13:

- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npx prisma validate` passed.
- `npx prisma generate` passed (Prisma Client 6.19.3).
- `npm test` passed: 17 tests, 17 passed.
- `npm run build:docker` passed with Next.js 16.2.9.
- `git diff --check` passed (line-ending conversion notices only).

The exact combined P0-A, Plex-identity, grouped-discovery, progress, background-
scan, watcher, and subtitle-completeness tree was revalidated on 2026-07-14:

- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npx prisma validate` passed.
- `npx prisma generate` passed (Prisma Client 6.19.3).
- `npm test` passed: 40 tests across eight suites.
- `npm run build:docker` passed with Next.js 16.2.9.
- `git diff --check` passed.

The 2026-07-15 parent-show Plex, apply-boundary, preview-contract, and safe
TMDB-auto-match follow-up was revalidated against the complete tree:

- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npx prisma validate` passed.
- `npx prisma generate` passed (Prisma Client 6.19.3).
- `npm test` passed: 60 tests across nine suites.
- `npm run build:docker` passed with Next.js 16.2.9.
- `git diff --check` passed.

The 2026-07-19 empty-folder and episode-parser follow-up was revalidated
against the complete tree:

- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npx prisma validate` passed.
- `npx prisma generate` passed (Prisma Client 6.19.3).
- `npm test` passed: 63 tests across nine suites.
- `npm run build:docker` passed with Next.js 16.2.9.
- `git diff --check` passed.

The subsequent responsive/player and production-diagnostic refinements also
passed lint, TypeScript, Prisma validation/generation, the 17-test suite,
`build:docker`, and `git diff --check` on 2026-07-13. The latest browser check
used a disposable 205-row inventory fixture; artwork, subtitle clearance,
transcoded progress persistence, and scanner reconciliation still need the
preserved production `/data` bind and named real media.

Remaining deployment checks: do not infer correctness from the matching Movies
aggregate. First finish the outstanding P0 hardening gates above. Then deploy
the latest corrective tree through the normal backup/rollback procedure and
run one Movies section scan, immediately reopen
and retain its report, require it to be complete, and locate the exact `1917`
and `Casino Royale` paths among discovered, ignored, unsupported, traversal, or
identity-collision entries. Confirm the evidence-backed Anime total stays 19
and reconcile TV 179 against the 180-directory NAS definition. Preview Plex
with “Needs attention” selected and confirm a Movies scope excludes TV
episodes. Separately preview All/TV scope and confirm `Animal Kingdom (2016)`,
`Hell's Kitchen (US)`, both `Next Level Chef` libraries, `Star Trek`,
`PLUR1BUS`, `Kitchen Nightmares (US)`, and `Monster (2022)` resolve through
their exact parent/source identities. Confirm the US `Next Level Chef` S2 rows
do not attach to the UK series. Review genuine missing-special rows separately.
Use the reason text to locate `Mr. & Mrs. Smith`/`Run`, correct those two sticky
TMDB identities explicitly through Fix Match, then run another preview. Do not
apply watched changes until the attention set is reviewed.
Add/change/remove one controlled non-production fixture under a watched section
and confirm the serialized watcher scan completes and Home refreshes. Resume
and stop a named transcoded title across a container restart and compare the
stored absolute position with the player timeline.

Implemented guarantees:

1. Match an exact normalized path first. Reuse a title/year row only when its
   previous path is absent/unavailable; never overwrite a second path that was
   discovered in the same scan.
2. Until a versions model exists, surface every identity collapse in the scan
   manifest instead of silently losing a live path.
3. Any relevant traversal uncertainty returns an incomplete scan and suppresses
   all missing-path reconciliation for the section, including non-absence
   subtitle-directory read failures.
4. Missing episodes retain their rows, metadata, subtitles, and watch history;
   the equivalent TMDB cleanup is non-destructive. Failed sidecar or embedded
   subtitle discovery likewise preserves the existing affected track group.
5. Manual and watcher work serialize per section, and HTTP scan requests queue
   process-local jobs rather than holding one fragile response open.
6. The manifest covers discoveries, ignored/unsupported reasons, traversal
   failures, parser output, identity collisions, and proposed unavailable rows.
7. Temporary-directory/SQLite tests cover the destructive, duplicate, parser,
   Plex-identity, watcher-policy, and idempotency cases recorded above.

Definition of done: an incomplete scan cannot remove availability/history; the
manifest explains every discovered or excluded path; destructive test fixtures
pass; lint, TypeScript, Prisma validation/generation, `npm test`,
`build:docker`, and `git diff --check` pass.

#### P0-B — Deploy, Reconcile Counts, And Verify Real Media

1. Follow `DEPLOYMENT.md`: inventory the live container, use an immutable image
   tag, import a `docker save` archive, stop and back up the complete `/data`
   bind, retain the old container/image, and recreate with the exact existing
   port/mount/environment/device contract.
2. Confirm duplicate repair and guarded schema push complete before
   `Starting server on port 3000`, then compare stats/sections with the captured
   pre-deployment JSON before scanning.
3. Scan one section at a time and retain each manifest. Even though the current
   regular Movies aggregate is 478, confirm all 478 expected paths item-by-item,
   including `1917`, `Casino Royale`, and *Harry Potter and the Deathly Hallows:
   Part 2*. Reconcile 179 Lumina TV shows against the 180-directory NAS
   definition and keep the evidence-backed Anime totals unchanged.
4. Exercise Home, Movies, TV, Search, My List, Settings, detail, rails, and the
   player at mobile, desktop, and ultrawide/high-DPI widths.
5. Test direct play, compatibility fallback, resume, menus, external SRT/ASS,
   embedded text, and PGS/DVD burn-in against named real files. Subtitles must
   remain clear of controls.

Definition of done: startup and rollback evidence is retained; every count
difference has an itemized explanation; no unresolved scan error exists; real
subtitle/player checks pass; the deployed image is explicitly recorded as
deployment-verified.

#### P1-A — Trustworthy Discovery And Navigation (First Slice Implemented Locally)

Implemented locally: grouped playable Movie/TV/Episode search with exact
episode actions and keyboard states; six typed shelf `View all` presets with
Home/full-list parity; stable pagination; correct movie/full-series watch-state
filters; per-scope browse preferences; and logical-view scroll restoration.

Next discovery steps, in order:

1. Give Continue Watching and Recently Added Episodes dedicated paginated
   contracts before adding `View all`; retain next-episode selection and
   per-show episode deduplication exactly.
2. Add indexed `sortTitle` A–Z and `#` navigation without loading all earlier
   pages. Numeric fixtures must keep `1917` and `2046` under `#`.
3. Add user collections and a small set of explainable smart shelves. Each
   recommendation should state its reason (genre, creator, cast, collection,
   recently watched) instead of presenting an opaque ranking.
4. Add a command-palette/search overlay and living-room focus model only after
   the current mouse/keyboard flows have fixture-browser coverage.

Definition of done for this slice: every displayed scope is backed by a
matching server query; no unavailable target becomes a Play/Resume action;
filters and paging remain stable across navigation; keyboard and responsive
browser regression checks pass; deployment acceptance confirms the same
behaviour with real artwork and the preserved production database.

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
- Deployment-verify the locally implemented dynamic watcher subscriptions,
  add/change/unlink/directory events, bounded remote polling, serialized scan
  path, and foreground Home refresh.
- Extend the current unchanged-video embedded-subtitle shortcut into a general
  codec/container analysis cache keyed by normalized path, size, and mtime.
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

- Add manifest export/download; the full report is already viewable lazily in
  Settings rather than reduced to a note count.
- Replace hard-coded section “Active” status with path, watcher, and last-scan
  health; add clear offline treatment if My List retains unavailable items.
- Add empty-library onboarding after correctness work is stable.
- Untrack the legacy `.env` and replace it with a non-secret example; align the
  isolated Prisma CLI with the lockfile version; pin or intentionally update
  base images; evaluate a non-root runtime without breaking NAS permissions.

### Deployment Verification Needed

The exact build/save/transfer/import, backup, startup, functional verification,
and rollback procedure now lives in `DEPLOYMENT.md`. The key order is:

1. Validate and deploy the exact local P0-A plus Plex/background-scan/watcher
   tree before any production rescan.
2. Import and start the new image with the preserved live configuration.
3. Verify state before scanning, then run section scans only with manifests and
   a restore-ready backup.
4. Complete real-library player and responsive checks.
5. Review the complete diff. Commit or push only after deployment acceptance
   and only when the user explicitly requests those Git actions.

### Known Risks And Scope Guardrails

- Bitmap subtitle burn-in is compile-validated but not exercised on this host.
- The live image includes the responsive pass, but current count discrepancies
  remain investigation targets, not guaranteed fixes.
- No further broad redesign is queued. Make targeted corrections from deployed
  evidence and preserve the current visual system.
- Authentication, multi-user support, new page routes, and a media-versions
  data model are separate product decisions; do not introduce them as incidental
  fixes.
- Watch Together, Live TV/DVR, global reviews, offline downloads, broad theme
  customisation, and multi-user profiles are explicitly deferred. Multi-user is
  the only desired item in that group, and it remains a much-later deliberate
  migration after the single-user trust, discovery, and premium experience are
  mature.
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
