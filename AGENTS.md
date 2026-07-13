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
- Avoid glow-heavy cards, gradient blobs, oversized marketing layouts, and
  SaaS-dashboard styling.
- Media artwork should remain the dominant visual material.
- Poster cards use a central play button and a consistent three-dot action menu.
- Put genre browsing inside Movies and TV Shows rather than duplicating it on
  the Home screen.
- Settings must only advertise implemented functionality.
- Use Lucide icons for interface controls.
- Keep cards at 8px corner radius or less.

## Interaction Rules

- Starting playback closes detail overlays.
- Menus and dialogs must close on outside click and Escape.
- Nested buttons must not trigger the parent card action.
- TV actions must identify a specific local episode before offering
  episode-level watched controls.
- Mutations must invalidate Home, detail, search, and relevant grid queries so
  changes appear without reloading.

## Database And Docker

- The production database is persisted under `/data`.
- Do not require an external `DATABASE_URL` from users.
- Container startup is responsible for applying compatible schema updates.
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
- Use `worklog.md` for historical notes only.
- Update this file when an architectural invariant or established workflow
  changes.
