# Lumina Agent Guide

## Project

Lumina is a self-hosted personal media library and playback server inspired by
Plex, Emby, Jellyfin, and modern streaming interfaces.

The application is single-user for now and runs as a Docker container with
persistent state stored under `/data`.

## Stack

- Next.js App Router
- React and TypeScript
- Tailwind CSS and shadcn/ui
- Zustand for client navigation and overlays
- TanStack Query for server state
- Prisma with SQLite
- FFmpeg for playback and transcoding

## Commands

- `npm run dev` - local development server
- `npm run lint` - ESLint
- `npx tsc --noEmit` - TypeScript validation
- `npm run build` - production build
- `npm run build:docker` - production build used by the container
- `npx prisma validate` - validate the database schema
- `npx prisma generate` - regenerate the Prisma client

Run lint, TypeScript, Prisma validation, and the production build before
considering substantial changes complete.

## Architecture

- `/` is the only user-facing page.
- Primary views are client-side states in `src/store/media-store.ts`.
- API routes live under `src/app/api`.
- Shared media queries and serialization live in `src/lib/media-queries.ts`.
- TMDB integration lives in `src/lib/tmdb.ts`.
- Library scanning lives in `src/lib/scanner.ts`.
- Subtitle discovery and conversion live in `src/lib/subtitles.ts`.
- Codec probing and compatibility transcoding live in `src/lib/transcoder.ts`.
- Filesystem watching lives in `src/lib/watcher.ts` and starts through
  `src/instrumentation.ts`.
- Plex synchronization lives in `src/lib/plex-sync.ts`.
- Player UI lives in `src/components/media/video-player.tsx`.
- Shared responsive shelf behavior lives in
  `src/components/media/horizontal-rail.tsx`.
- `src/components/media/library-view.tsx` implements both Library and Settings
  modes; do not assume they are separate routes.
- Playback and transcoding logic must preserve direct play when possible.

Do not create separate page routes unless the navigation architecture is
intentionally being changed.

## Media Invariants

- Local media files are the source of truth.
- Metadata refreshes must never create playable episodes that do not exist
  locally.
- Metadata refreshes must not delete local files or local episode records.
- Matching the same TMDB title should merge duplicate rows safely.
- TMDB identity is unique by media type and TMDB ID.
- Rescans identify local media by stable file/folder path before mutable title.
- A title/year fallback must never collapse two different paths that both exist
  locally. Reuse a title match only when its former path is unavailable.
- Counts and user-facing browse grids represent locally playable media, not
  stale metadata-only rows.
- A scan may mark missing paths unavailable, but it should preserve watch
  history and metadata so returning files can be reconciled.
- A partial or uncertain directory traversal must not run missing-path
  reconciliation. Missing episode files are marked unavailable; their episode
  rows, metadata, subtitles, and watch progress are not deleted.
- Serialize scans per library section so watcher and manual scans cannot
  reconcile the same section concurrently.
- Movie collection folders may contain several films and must be scanned
  recursively while common extras/trailer folders are ignored.
- Numeric titles such as `1917` and `2046` must not be mistaken for release
  years.
- Continue Watching dismissal must preserve resume history.
- Resuming playback should restore a dismissed item to Continue Watching.
- Plex synchronization is additive and must not mark content unwatched unless
  that behavior is explicitly introduced.

## Interface

- Use a modern sans-serif interface font. Avoid ornamental or old-fashioned
  typography for application controls and content titles.
- Preserve the deep navy, porcelain, and restrained brushed-gold identity.
- Gold is an accent, not the entire interface.
- The established visual system is artwork-led smoked glass: desaturated
  steel-blue canvas, cool translucent surfaces, porcelain text, and near-black
  navigation/control capsules. Use gold primarily for ratings, progress,
  selection, and focus.
- Use the simple typographic `Lumina.` wordmark in application chrome; do not
  reintroduce ornate or glow-heavy logo treatments there.
- Avoid glow-heavy cards, gradient blobs, oversized marketing layouts, and
  SaaS-dashboard styling.
- Media artwork should remain the dominant visual material.
- Poster cards use a central play button and a consistent three-dot action menu.
- Poster titles and core metadata remain readable without hover.
- Navigation, hero content, shelves, browse grids, and footer share one fluid
  page boundary and consistent responsive gutters, including ultrawide screens.
- Put genre browsing inside Movies and TV Shows rather than duplicating it on
  the Home screen.
- Settings must only advertise implemented functionality.
- Use Lucide icons for interface controls.
- Keep cards at 8px corner radius or less.

## Interaction Rules

- Starting playback closes detail overlays.
- Menus and dialogs must close on outside click and Escape.
- Player menus must be positioned independently of the transport layout and
  must never resize the controls bar.
- Player transport is centered; volume/status belongs on the left and
  captions/settings/fullscreen belong on the right.
- Desktop shelf arrows remain visible whenever more content exists in that
  direction; touch layouts use native horizontal scrolling.
- Nested buttons must not trigger the parent card action.
- TV actions must identify a specific local episode before offering
  episode-level watched controls.
- TV playback progress must reference the resolved local episode, including
  playback started from a show-level action.
- Mutations must invalidate Home, detail, search, and relevant grid queries so
  changes appear without reloading.

## Database And Docker

- The production database is persisted under `/data`.
- Do not require an external `DATABASE_URL` from users.
- Container startup is responsible for applying compatible schema updates.
- Startup repairs duplicate `(type, tmdbId)` rows before creating the unique
  media identity index; never replace this with a blanket
  `--accept-data-loss`.
- The runtime image uses Next.js standalone output plus an isolated Prisma CLI;
  do not copy the complete build-time `node_modules` into the runner.
- The current Synology-compatible target cannot build the image reliably.
  Build on a capable host, package with `docker save`, transfer, and import with
  `docker load` or the NAS image importer. Never use `docker export`.
- Preserve the live `/data` bind, media mounts, environment, restart policy,
  optional device mapping, and `3422:3000` port mapping when recreating the
  container. The repository `docker-compose.yml` is an example, not the live
  NAS configuration.
- Hardware transcoding should auto-detect `/dev/dri/renderD128` when available
  and fall back gracefully.
- Never require VAAPI-specific environment variables for the normal case.

## Git And Existing Work

- The primary branch is `main`.
- Do not revert unrelated user changes or intentional file deletions.
- Keep commits focused and run validation before pushing.
- Do not commit local databases, secrets, generated screenshots, build output,
  or media files.

## Documentation

- Keep this file limited to durable guidance.
- `README.md` is the stable project entry point; `DEPLOYMENT.md` is the NAS
  build/transfer/import runbook; `worklog.md` owns current state and priorities.
- At the start of a new task, read `Current Handoff` and
  `Detailed Current Handoff` in `worklog.md`, then inspect `git status` before
  making changes.
- Use `worklog.md` for the current handoff and append-only historical notes.
- The current handoff overrides contradictory historical implementation notes.
- Distinguish compile-validated, fixture-browser-validated, and
  deployment-verified work. Never call real-media or container behavior
  verified solely because lint, TypeScript, Prisma, or the Next.js build pass.
- Update this file when an architectural invariant or established workflow
  changes.
