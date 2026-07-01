# Lumina — Personal Media Streaming Frontend · Worklog

Project: A YouTube/Apple TV/Plex/Netflix-like frontend for a personal movie + TV library.
Brand name: **Lumina** (luminous cinema light). Warm amber/gold accent on near-black.
Single user-visible route: `/` (everything else is client-side view state via Zustand + overlays).

---
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

## API CONTRACT (both backend & frontend MUST follow exactly)

All responses are JSON. Media image fields are full URLs (TMDB CDN: `https://image.tmdb.org/t/p/<size><path>`). Procedural poster fallback used client-side when `posterUrl` is null.

### GET `/api/library/home` → `HomeData`
```
{ featured: MediaSummary[], continueWatching: MediaSummary[], rows: ContentRow[] }
```
- `featured`: up to 6 items that have a backdrop (featured flag or top popularity).
- `continueWatching`: up to 12 items with progress, sorted by `updatedAt` desc.
- `rows`: ContentRow[] — keys like `trending`, `popular-movies`, `popular-tv`, `top-rated`, and one row per top genre (e.g. `genre-Action`). Each row up to 20 items.

### GET `/api/library/stats` → `LibraryStats`

### GET `/api/library/genres` → `string[]`

### GET `/api/library/browse?type=MOVIE|TV&genre=&q=&sort=popular|rating|year|title&page=1&pageSize=24`
→ `{ items: MediaSummary[], total, page, pageSize, genres: string[] }`

### GET `/api/media/:id?season=N` → `MediaDetail`
- `MediaDetail` extends `MediaSummary` with `seasons: Season[]`, `episodes: Episode[]` (for the requested/first season), `nextEpisode: Episode | null`, `streamUrl`, `filePath`, `tmdbId`, `imdbId`, `voteCount`, `status`, `releaseDate`.
- If `season` omitted, returns episodes for first season that has episodes (or season 1).

### GET `/api/media/:id/stream` → video byte stream (HTTP Range supported, `Content-Type: video/mp4`). Only used when client determines the source is local (no remote `streamUrl`). Returns 404 + JSON `{ error }` if no file.

### GET `/api/episodes/:id/stream` → same streaming behaviour for an episode.

### GET `/api/search?q=foo` → `{ items: MediaSummary[], query }`

### GET `/api/progress` → `{ items: MediaSummary[] }` (continue-watching list, up to 24)

### POST `/api/progress` body `SaveProgressPayload { mediaId, episodeId?, position, duration, completed? }` → `{ ok: true }`

### GET `/api/collections` → `{ items: MediaSummary[] }` (My List)

### POST `/api/collections/toggle` body `{ mediaId }` → `{ ok: true, inMyList: boolean }`

### POST `/api/library/scan` body `{ mediaDir?, tmdbKey? }` → `ScanResult`
- Scans the filesystem under the configured `MEDIA_DIR` (env) or `mediaDir`. Detects movies (`.mp4/.mkv/.webm` files) and TV shows (folder structure `Show Name/Season 01/S01E01.*`). Auto-matches TMDB metadata when a key is present, otherwise creates stubs. Idempotent.

### POST `/api/metadata/search` body `{ title, type, year? }` → `{ results: { tmdbId, title, year, overview, posterUrl, type }[] }`

### POST `/api/metadata/apply` body `{ mediaId, tmdbId, type }` → `{ ok: true, media: MediaDetail }` (fetches + saves full TMDB metadata incl. episodes for TV)

## MediaSummary JSON shape (see src/lib/types.ts)
```
{ id, type:"MOVIE"|"TV", title, posterUrl, backdropUrl, year, rating, runtime, genres:string[],
  certification, overview, tagline, featured, trending, popularity, inMyList,
  progressPercent?, progressPosition?, progressDuration?, progressEpisodeId?,
  progressSeason?, progressEpisode?, progressUpdatedAt? }
```

## DESIGN SPEC (frontend)

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

## COMPONENTS (src/components/media/)
AppShell, TopNav, Logo, Footer, HeroCarousel, ContentRow, MediaCard, ContinueWatchingCard, ProceduralPoster, DetailOverlay, SeasonEpisodeList, VideoPlayer, BrowseView, SearchView, MyListView, LibraryView, RatingBadge, MetaRow, Skeletons, GenreSelect, SortSelect.

## RULES
- Use existing shadcn/ui components (`@/components/ui/*`) — do NOT recreate.
- TanStack Query (`@tanstack/react-query`) for all server state. Query keys: `["home"]`, `["browse", {type,genre,sort,page,q}]`, `["media", id, season]`, `["search", q]`, `["collections"]`, `["progress"]`, `["stats"]`, `["genres"]`.
- Only `/` route (src/app/page.tsx). All "pages" are view-state in the Zustand store; detail & watch are overlays.
- `z-ai-web-dev-sdk` backend only.
- z.ai web dev SDK not needed in frontend.

---
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
