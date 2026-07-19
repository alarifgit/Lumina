# Lumina

Lumina is a self-hosted, single-user media library and playback server built
with Next.js, React, Prisma/SQLite, and FFmpeg. Local media files are the source
of truth; TMDB and Plex integrations enrich or synchronize that library without
replacing it.

The project is under active development. Before changing code, read the
authoritative handoff in `worklog.md`; the older task log records history and is
not a current product or design specification.

## Documentation Map

- [AGENTS.md](AGENTS.md) — durable architecture, media, interface, interaction,
  and safety invariants.
- [worklog.md](worklog.md) — current repository state, validation evidence,
  known defects, prioritized roadmap, and the next continuation point.
- [DEPLOYMENT.md](DEPLOYMENT.md) — build-on-another-host, image
  transfer/import, backup, verification, and rollback runbook for the current
  NAS deployment.
- [Brand asset README](public/brand/lumina/codex-logo-pack/lumina_codex_logo_pack/README.md)
  — asset inventory and the distinction between application chrome and
  optional brand exports.

Source-of-truth order when documents disagree:

1. [AGENTS.md](AGENTS.md) durable invariants.
2. `Current Handoff`, `Detailed Current Handoff`, and `Prioritized Roadmap` in
   [worklog.md](worklog.md).
3. Current code and schema.
4. Historical worklog entries and old mockups.

## Architecture At A Glance

- `/` is the only user-facing route; Zustand controls client-side views and
  overlays.
- API routes live under `src/app/api`.
- Shared queries and serialization live in `src/lib/media-queries.ts`.
- Scanning, subtitle analysis, and transcoding live in `src/lib/scanner.ts`,
  `src/lib/subtitles.ts`, and `src/lib/transcoder.ts`.
- Prisma uses SQLite. The production database is `/data/lumina.db` inside the
  container and must be backed by a persistent host mount.
- Playback prefers direct play and falls back to FFmpeg compatibility
  transcoding, with optional automatic VAAPI use.

## Development

The Docker build installs from `bun.lock` with Bun. On a fresh development
checkout, use the same locked dependency graph and do not regenerate the
lockfile unless a dependency change is intentional:

```sh
bun install --frozen-lockfile
```

Then run:

```sh
npm run dev
```

The local server listens on port `3000` by default.

Before treating a substantial change as locally complete, run:

```sh
npm run lint
npx tsc --noEmit
npx prisma validate
npx prisma generate
npm test
npm run build:docker
git diff --check
```

These commands prove static and production-build validity. They do not prove
Docker startup, NAS scanning, FFmpeg behavior, hardware acceleration, or
real-media subtitle playback; those require the deployment checks in
[DEPLOYMENT.md](DEPLOYMENT.md).

## Deployment Contract

The current NAS cannot reliably build this Dockerfile. Build the image on a
capable host, package it with `docker save`, transfer it, and import it on the
NAS. The image listens on container port `3000`, persists state under `/data`,
and does not need a user-supplied `DATABASE_URL`.

Do not deploy the repository `docker-compose.yml` unchanged: it contains
example media paths, an example host port, a relative data bind, and an
unconditional device mapping. Preserve the live container's real configuration
and follow [DEPLOYMENT.md](DEPLOYMENT.md).

## Current Product Direction

Lumina uses an artwork-led smoked-glass interface: a desaturated steel-blue
canvas, cool translucent surfaces, porcelain text, near-black control capsules,
and restrained warm gold for state and focus. Application chrome uses the
typographic `Lumina.` lockup. Media artwork remains the primary visual material.

Do not begin another broad redesign until the current uncommitted responsive
pass has been deployed and verified against the real library. The immediate
priority is scanner safety, count reconciliation, and real-media player
verification; see [worklog.md](worklog.md).
