# Lumina NAS Deployment Runbook

This runbook covers Lumina's current deployment constraint: build the image on
a Docker-capable host, save it to a portable image archive, transfer it, and
import it on the Synology-compatible NAS. The current live service is
`http://10.41.6.100:3422`.

## Runtime Contract

| Item | Required value or behavior |
| --- | --- |
| Container port | `3000` |
| Current host port | `3422` (`3422:3000`) |
| Database | `file:/data/lumina.db`, set by the image |
| Persistent state | Existing writable host directory mounted at `/data` |
| Media | Preserve every existing host-to-container mount; read-only is sufficient |
| Startup | Duplicate repair, guarded Prisma schema push, then `node server.js` |
| Hardware acceleration | Optional `/dev/dri`; CPU fallback is supported |
| Image build | External capable host; the NAS is import/run only |

The repository `docker-compose.yml` is a development/deployment example. It is
not the live NAS definition: its port, media paths, relative data path, and
device mapping may all be wrong for the running container.

## Safety Rules

- Never use `docker export`/container export. It loses image configuration and
  metadata. Use `docker save`, then `docker load` or the NAS image importer.
- Never replace or remap `/data` during an update.
- Stop Lumina before copying `/data`; copy the whole mounted directory so
  SQLite `-wal` and `-shm` files are included if present.
- Never run the old and new containers against the same `/data` directory at
  the same time.
- Keep the old container/image and the stopped database backup until the new
  image, scans, and playback checks are accepted.
- Do not use `docker system prune` as part of this process.
- The current scanner has production-safety defects documented in
  [worklog.md](worklog.md). Do not run a production rescan until the P0 scanner
  gate there is complete, unless an explicit disposable/restore-ready test is
  intended.

## 1. Inventory The Live Container

Run these on the NAS before building or replacing anything. First identify the
real container name:

```sh
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'
```

Use that name in place of `<CURRENT_CONTAINER>`:

```sh
docker port <CURRENT_CONTAINER>

docker inspect <CURRENT_CONTAINER> \
  --format '{{range .Mounts}}{{.Source}} -> {{.Destination}} ({{.Mode}}){{println}}{{end}}'

docker inspect <CURRENT_CONTAINER> \
  --format '{{json .HostConfig.RestartPolicy}}'

docker inspect <CURRENT_CONTAINER> \
  --format '{{.Image}}'

uname -m
docker version
df -h
```

Save the full inspect output somewhere private:

```sh
docker inspect <CURRENT_CONTAINER> \
  > /secure/backup/path/lumina-container-before.json

chmod 600 /secure/backup/path/lumina-container-before.json
```

The inspect file can contain TMDB/Plex credentials. Record, without changing:

- the exact host directory bound to `/data`;
- every media source and container destination, including custom sections;
- `3422:3000`, restart policy, environment, and optional `/dev/dri` mapping;
- the current image ID/tag and the deployment mechanism (Container Manager,
  Portainer, Compose, or direct `docker run`).

Capture pre-deployment application state:

```sh
curl -fsS http://127.0.0.1:3422/api/library/stats \
  > /secure/backup/path/lumina-stats-before.json

curl -fsS http://127.0.0.1:3422/api/sections \
  > /secure/backup/path/lumina-sections-before.json
```

The sections response can include a per-section TMDB key. Protect both saved
JSON files and do not paste them into a public log or issue.

`/api` currently returns a placeholder greeting, not a health verdict. Use
`/api/library/stats` and `/api/sections` for operational checks.

## 2. Build And Package On The Capable Host

Use a unique immutable tag such as `lumina:20260713-responsive1`. Do not rely on
`latest` for rollback or proof of which image is running.

Before building, inspect the existing dirty tree and rerun validation if any
code changed since the handoff:

```sh
git status --short
git diff --check
npm run lint
npx tsc --noEmit
npx prisma validate
npx prisma generate
npm run build:docker
```

Map NAS architecture to the image platform:

- NAS `x86_64` -> `linux/amd64`
- NAS `aarch64` -> `linux/arm64`

Build for the NAS architecture. Typical RedPill/x86_64 example:

```sh
docker buildx build \
  --platform linux/amd64 \
  --load \
  -t lumina:20260713-responsive1 .

docker image inspect lumina:20260713-responsive1 \
  --format '{{.Os}}/{{.Architecture}} {{.Id}}'
```

If ordinary `docker build` already builds the correct target architecture, it
is also valid:

```sh
docker build --pull -t lumina:20260713-responsive1 .
```

Package the image in the most old-Docker-compatible form:

```sh
docker save -o lumina-20260713-responsive1.tar \
  lumina:20260713-responsive1

sha256sum lumina-20260713-responsive1.tar \
  > lumina-20260713-responsive1.tar.sha256
```

PowerShell checksum equivalent:

```powershell
Get-FileHash .\lumina-20260713-responsive1.tar -Algorithm SHA256
```

An uncompressed Docker image tar is safest for an older NAS importer. If the
archive is compressed for transfer, decompress it back to `.tar` before using
an older GUI importer.

### Optional Clean-Image Smoke Test

On the build host, a disposable empty `/data` volume can verify the entrypoint
and schema path before transfer:

```sh
docker volume create lumina-smoke-data

docker run -d \
  --name lumina-smoke \
  -p 3423:3000 \
  -v lumina-smoke-data:/data \
  lumina:20260713-responsive1

docker logs --tail 200 lumina-smoke
curl -fsS http://127.0.0.1:3423/api/library/stats

docker rm -f lumina-smoke
docker volume rm lumina-smoke-data
```

Only remove the explicitly disposable `lumina-smoke` resources.

## 3. Transfer And Import

Transfer the `.tar` and checksum with the existing SMB/SCP/DSM workflow. Verify
the checksum on the NAS, then import:

```sh
cd /absolute/transfer/path
sha256sum -c lumina-20260713-responsive1.tar.sha256

docker load -i /absolute/transfer/path/lumina-20260713-responsive1.tar

docker image inspect lumina:20260713-responsive1 \
  --format '{{.Os}}/{{.Architecture}} {{.Id}}'
```

If the older NAS CLI does not support the `docker image` command group, use
`docker inspect lumina:20260713-responsive1` for the same verification.

In a Synology GUI, choose image import/add-from-file, not container import.
Labels vary between DSM and Docker/Container Manager versions.

## 4. Stop And Back Up Persistent State

Do this only after the new image has imported successfully. Stop the live
container, then copy the exact host directory previously found for `/data`:

```sh
docker stop <CURRENT_CONTAINER>

cp -a '<ACTUAL_DATA_HOST_DIR>' \
  '<ACTUAL_DATA_HOST_DIR>.pre-20260713-responsive1'

sync
```

Verify the copy exists and contains a non-empty `lumina.db`. Do not guess the
data path and do not substitute a new `./data` directory.

Keep the stopped old container for immediate rollback:

```sh
docker rename <CURRENT_CONTAINER> lumina-previous-20260713-responsive1
```

## 5. Recreate With The Imported Image

If an existing NAS stack/project is authoritative, back it up, change only its
image tag, validate the rendered configuration, and redeploy. Do not replace it
with the repository example Compose file.

A direct CLI shape is shown below only as a configuration checklist. Replace
every placeholder with values captured from the old container, add every custom
mount/environment value, and omit absent optional devices:

```sh
docker run -d \
  --name lumina \
  --restart unless-stopped \
  -p 3422:3000 \
  -e NEXT_TELEMETRY_DISABLED=1 \
  -v '<ACTUAL_DATA_HOST_DIR>:/data' \
  -v '<ACTUAL_MOVIES_HOST_DIR>:/media/movies:ro' \
  -v '<ACTUAL_ANIME_MOVIES_HOST_DIR>:/media/movies-anime:ro' \
  -v '<ACTUAL_TV_HOST_DIR>:/media/tv:ro' \
  -v '<ACTUAL_ANIME_TV_HOST_DIR>:/media/tv-anime:ro' \
  lumina:20260713-responsive1
```

Add `--device /dev/dri:/dev/dri` only when that path exists and should be used.
Preserve existing TMDB/Plex/transcoding environment values if present,
preferably through a root-readable environment file instead of shell history.
Do not supply `DATABASE_URL`; the image sets the production path.

## 6. Verify Startup Before Scanning

Check for restart loops and inspect the startup sequence:

```sh
docker ps -a --filter name=lumina

docker inspect lumina \
  --format 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}'

docker port lumina 3000/tcp
docker logs --tail 250 lumina
```

Expected logs include:

```text
[Lumina] Ensuring database schema at file:/data/lumina.db ...
[Lumina] Starting server on port 3000 ...
```

Duplicate-merge messages may appear between them. A repair or Prisma error is a
failed deployment; investigate it rather than repeatedly restarting.

Verify HTTP, database access, and preserved sections:

```sh
curl -fsS http://127.0.0.1:3422/
curl -fsS http://127.0.0.1:3422/api/library/stats
curl -fsS http://127.0.0.1:3422/api/sections
```

Compare the two API responses with the saved pre-deployment JSON before any
scan. Existing state and section paths should be unchanged.

## 7. Application And Player Verification

At `http://10.41.6.100:3422`, verify without starting a scan:

- Home, Movies, TV, Search, My List, Settings, detail, and player load against
  the real database.
- Desktop, narrow/mobile, and ultrawide/high-DPI layouts have no document-level
  horizontal overflow.
- Header and content gutters remain symmetric after scrolling.
- Poster and Continue Watching rails expose arrows whenever content is hidden.
- Detail/dialog content scrolls independently and menus close on outside click
  and Escape.
- Direct play, resume, pause, seek, volume, speed, and fullscreen behave.
- Player transport remains centered; captions/settings menus do not resize it.
- External SRT/ASS, embedded text, and PGS/DVD burn-in subtitles work against
  real media and remain clear of visible controls.
- VAAPI failure, when applicable, falls back to CPU rather than breaking
  playback.

Record exact media filenames/codecs for any failure. “Build passed” is not a
substitute for these checks.

## 8. Production Scan Safety Gate And Count Reconciliation

Do not run the production scan until the P0 items in
[worklog.md](worklog.md) are complete:

1. Exact normalized path is matched before title/year, without collapsing two
   live files.
2. Any partial traversal error disables missing-path reconciliation.
3. Missing episode files retain episode rows, metadata, subtitles, and watch
   progress.
4. Manual and watcher scans are serialized per section.
5. The scan produces a path-level manifest of discovered, ignored,
   unsupported, errored, duplicate/collapsed, and stale database entries.
6. Scanner fixture tests cover the destructive and duplicate cases.

After that gate passes and a fresh stopped `/data` backup exists, scan one
section at a time and retain each manifest. Compare equivalent definitions
(playable movie files and playable TV titles, not merely arbitrary folder
counts). Known investigation baseline:

- NAS movies: `478`; previous Lumina movies: `475`.
- NAS TV directories: `180`; previous Lumina TV shows: `181`.
- Anime section counts previously matched and must remain unchanged.
- Confirm collection-folder films such as *Harry Potter and the Deathly
  Hallows: Part 2* are present.

Success means every discrepancy is explained path-by-path, no scan has an
unresolved traversal error, and no watch history is lost—not merely that two
headline totals happen to match.

## 9. Rollback

Never start both containers against the same data bind.

For an image/container-only rollback:

```sh
docker rm -f lumina
docker rename lumina-previous-20260713-responsive1 lumina
docker start lumina
```

Startup can merge duplicate identities and add schema columns. For an exact
database rollback, also restore the stopped backup:

```sh
docker stop lumina

mv '<ACTUAL_DATA_HOST_DIR>' \
  '<ACTUAL_DATA_HOST_DIR>.failed-20260713-responsive1'

cp -a '<ACTUAL_DATA_HOST_DIR>.pre-20260713-responsive1' \
  '<ACTUAL_DATA_HOST_DIR>'

docker start lumina
```

Restoring the backup discards watch progress recorded after cutover. Retain the
failed data directory until the cause is understood.

## Current Operational Gaps

- The image has no Docker `HEALTHCHECK`; use logs plus
  `/api/library/stats`/`/api/sections`.
- Lumina is currently single-user and has no application authentication. Keep
  it on a trusted network or behind access control; do not publish port `3422`
  directly to the internet.
- The container currently runs as root. `/data` must be writable; media mounts
  can and should be read-only.
- Base image tags float, so builds are not byte-for-byte reproducible.
- The isolated Prisma CLI version and the lockfile-resolved application Prisma
  version should be kept aligned.
- `.env` is tracked from older history even though environment files are now
  ignored. It is excluded from the Docker context and is not deployment
  configuration; future cleanup should replace it with a safe example file.
