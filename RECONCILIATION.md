# Lumina reconciliation — local workspace vs `alarifgit/Lumina`

Compared: local workspace (Go rewrite) against upstream `https://github.com/alarifgit/Lumina` at `803a0d3e92243e1d921e9032cd0c6b7276ccc8da`, cloned read-only to `_reference/lumina-github`.

## What upstream actually is

Upstream `main` is the Codex/Next.js attempt:

- `package.json`, `bun.lock`, `next.config.ts`, `components.json`, `eslint.config.mjs`
- `src/app/**` Next.js routes/pages, `src/components/media/**`
- `prisma/schema.prisma`
- `public/brand/**`

It is **not** the current Go server in this workspace. The local root is a different architecture:

- `go.mod`, `cmd/lumina`, `internal/{api,arr,config,library,media,metadata,plex,scanner,transcode}`
- embedded vanilla-JS web client in `internal/api/web`
- `Dockerfile`, `deployments/*`

So this is not a normal "pull latest" situation. Merging upstream into this workspace would re-introduce the rejected Node/Next.js foundation.

## Brand reconciliation

The correct upstream brand pack is:

```text
_reference/lumina-github/public/brand/lumina/codex-logo-pack/lumina_codex_logo_pack/
```

The restored local pack at `lumina_badattempt/public/brand/` matches that pack's usable contents (`favicons/`, `transparent/`, `app-icons/`, `brand-reference/`, `web/`).

Current web app brand state is consistent with upstream guidance:

- favicon/apple-touch copied from the restored favicon pack into `internal/api/web/brand/`
- header uses typographic `Lumina.` wordmark
- upstream `src/components/media/logo.tsx` confirms the navbar should be the text lockup `Lumina.` with a primary-coloured dot; emblem PNGs are for app icons, empty states, footer, or brand-led moments — not the compact navbar
- legacy `public/brand/logo-mark.png`, `logo-v1..v4.png`, and hero images are not app-chrome assets and should stay unused

Recommended brand token alignment for the next UI pass (not applied yet): port `web/lumina-brand-tokens.css` values — midnight `#0A0F1A`, deep navy `#121A2A`, brushed gold `#C89D3C`, champagne `#E8D7A6`, porcelain `#F6F3EC` — and match upstream navbar wordmark styling (`font-weight: 600`, `letter-spacing: -0.045em`, md size ~`1.5rem`).

## Recommended git model

1. Initialize git in the current workspace and add upstream as a read-only reference remote:

   ```sh
   git init
   git remote add upstream https://github.com/alarifgit/Lumina
   git fetch upstream main
   ```

2. Do **not** commit upstream secrets. Upstream lists a `.env`; I did not read it. Add `.env`, `_reference/`, `data/`, and local `lumina.json` to `.gitignore`. Rotate the previously pasted Plex token and treat any upstream `.env` as compromised.

3. Make the current Go rewrite the new `main` going forward. Keep upstream `main` only as `upstream/main` reference, or archive it as `legacy/nextjs-attempt` if you want history preserved in one repo.

4. First commit should include the Go rewrite plus a real `go.sum`. Generate `go.sum` on the Docker host or with:

   ```sh
   docker run --rm -v "$PWD:/src" -w /src golang:1.25-bookworm go mod tidy
   ```

## What to port from upstream — and what not to port

Port as design/reference only:

- home layout: `home-view`, `hero-carousel`, `content-row`, `continue-watching-card`
- media cards/detail overlay/search/my-list interaction patterns
- brand tokens and logo lockup rules
- library/stats/scan UX ideas from `library-view` and `/api/library/config`

Do **not** port the architecture:

- Next.js API routes doing scanner/transcode/metadata work in Node
- Prisma as the primary store
- Node process model for FFmpeg/session management

Keep the Go backend as the system of record; use upstream React purely as a UX reference for the embedded vanilla client.

## Concrete next changes after this plan is accepted

1. `git init` + upstream remote + `.gitignore` hygiene.
2. Generate/commit `go.sum`; rebuild image to prove clean compile.
3. Align header wordmark CSS exactly with upstream `logo.tsx`.
4. Port brand tokens into `internal/api/web/style.css`.
5. Build the first home rail above the current grid: Continue Watching from existing playheads, then Recently Added from `GET /api/v1/items`.
6. Extend ⚙ panel beyond libraries: path mappings, *arr instances, TMDB/Plex settings — still writing only explicit config keys.

## Verification checklist for the host

```sh
docker build -t lumina:latest Lumina/
docker logs lumina --tail 80
curl localhost:3422/api/v1/system/capabilities
```

Expected: no `metadata.ParseFilename` panic, `vaapi=true`, brand favicon loads, ⚙ Libraries saves and scans without restart.
