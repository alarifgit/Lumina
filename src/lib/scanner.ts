import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { searchTmdb, applyTmdbMetadata } from "@/lib/tmdb";
import type { ScanResult } from "@/lib/types";

const VIDEO_EXTS = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".ts"];
const SEASON_RE = /season\s*(\d{1,2})/i;
const EPISODE_RE = /[sS](\d{1,2})\s*[eE](\d{1,2})/;

function isVideo(name: string): boolean {
  return VIDEO_EXTS.includes(path.extname(name).toLowerCase());
}

/** Clean a filename into a human title. */
function cleanTitle(raw: string): { title: string; year: number | null } {
  let t = path.basename(raw, path.extname(raw));
  t = t.replace(/[._]/g, " ");
  t = t.replace(/\b(1080p|720p|480p|2160p|4k|x264|x265|h264|h265|hevc|bluray|web-dl|webrip|web|brrip|bdrip|dvdrip|remux|hdr|atmos|aac|ac3|5\.1|2\.0|10bit)\b/gi, " ");
  const yearMatch = t.match(/\((\d{4})\)|\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? parseInt(yearMatch[1] || yearMatch[2]) : null;
  t = t.replace(/\(|\)|\[|\]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return { title: t || raw, year };
}

export async function scanLibrary(opts: {
  mediaDir?: string;
  tmdbKey?: string;
  autoMatch?: boolean;
}): Promise<ScanResult> {
  const start = Date.now();
  const cfg = await db.libraryConfig.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", mediaDir: opts.mediaDir ?? "/media" },
  });
  const mediaDir = opts.mediaDir ?? cfg.mediaDir ?? process.env.MEDIA_DIR ?? "/media";
  const tmdbKey = opts.tmdbKey ?? cfg.tmdbKey ?? process.env.TMDB_API_KEY ?? null;
  const autoMatch = opts.autoMatch ?? !!tmdbKey;

  const errors: string[] = [];
  let scanned = 0;
  let added = 0;
  let updated = 0;
  let skipped = 0;

  let entries: string[] = [];
  try {
    entries = await fs.readdir(mediaDir);
  } catch (e) {
    errors.push(`Cannot read media directory "${mediaDir}": ${(e as Error).message}`);
    await db.libraryConfig.update({
      where: { id: "default" },
      data: { lastScan: new Date(), scanCount: { increment: 1 }, mediaDir },
    });
    return { scanned, added, updated, skipped, errors, durationMs: Date.now() - start };
  }

  for (const entry of entries) {
    const entryPath = path.join(mediaDir, entry);
    let stat;
    try {
      stat = await fs.stat(entryPath);
    } catch (e) {
      errors.push(`Skip "${entry}": ${(e as Error).message}`);
      continue;
    }

    try {
      if (stat.isFile() && isVideo(entry)) {
        scanned++;
        const { title, year } = cleanTitle(entry);
        const existing = await db.media.findFirst({ where: { title, type: "MOVIE" } });
        if (existing) {
          await db.media.update({ where: { id: existing.id }, data: { filePath: entryPath, year: existing.year ?? year } });
          updated++;
        } else {
          await db.media.create({
            data: { type: "MOVIE", title, filePath: entryPath, year, sortTitle: title.toLowerCase() },
          });
          added++;
        }
        if (autoMatch && tmdbKey && !existing?.tmdbId) {
          await autoMatchTmdb((existing?.id) || (await db.media.findFirst({ where: { title, type: "MOVIE" } }))!.id, title, "MOVIE", year, tmdbKey, errors);
        }
        continue;
      }

      if (stat.isDirectory()) {
        // Detect TV show: has Season subdirs or episode-coded files
        let subEntries: string[] = [];
        try {
          subEntries = await fs.readdir(entryPath);
        } catch (e) {
          errors.push(`Cannot read dir "${entry}": ${(e as Error).message}`);
          continue;
        }

        const subdirs = subEntries.filter(async (s) => (await fs.stat(path.join(entryPath, s)).catch(() => ({ isDirectory: () => false }))).isDirectory());
        const hasSeasonDir = subEntries.some((s) => SEASON_RE.test(s));
        const allFiles = subEntries.filter((s) => isVideo(s));
        const hasEpisodeFiles = allFiles.some((s) => EPISODE_RE.test(s));

        if (hasSeasonDir || hasEpisodeFiles) {
          // TV show
          scanned++;
          const { title } = cleanTitle(entry);
          let show = await db.media.findFirst({ where: { title, type: "TV" } });
          if (!show) {
            show = await db.media.create({
              data: { type: "TV", title, filePath: entryPath, sortTitle: title.toLowerCase() },
            });
            added++;
          } else {
            await db.media.update({ where: { id: show.id }, data: { filePath: entryPath } });
            updated++;
          }

          // collect episode files recursively (one level into season dirs)
          const epFiles: { season: number; episode: number; file: string }[] = [];
          for (const sub of subEntries) {
            const subPath = path.join(entryPath, sub);
            const subStat = await fs.stat(subPath).catch(() => null);
            if (!subStat) continue;
            if (subStat.isDirectory()) {
              const seasonMatch = sub.match(SEASON_RE);
              const seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;
              const files = await fs.readdir(subPath).catch(() => []);
              for (const f of files) {
                if (!isVideo(f)) continue;
                const em = f.match(EPISODE_RE);
                if (em) epFiles.push({ season: seasonNum, episode: parseInt(em[2]), file: path.join(subPath, f) });
              }
            } else if (isVideo(sub)) {
              const em = sub.match(EPISODE_RE);
              if (em) epFiles.push({ season: parseInt(em[1]), episode: parseInt(em[2]), file: subPath });
            }
          }

          for (const ep of epFiles) {
            const epTitle = `S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")}`;
            const existingEp = await db.episode.findUnique({
              where: { mediaId_seasonNumber_episodeNumber: { mediaId: show.id, seasonNumber: ep.season, episodeNumber: ep.episode } },
            });
            if (existingEp) {
              await db.episode.update({ where: { id: existingEp.id }, data: { filePath: ep.file } });
            } else {
              await db.episode.create({
                data: { mediaId: show.id, seasonNumber: ep.season, episodeNumber: ep.episode, title: epTitle, filePath: ep.file },
              });
            }
          }

          if (autoMatch && tmdbKey && !show.tmdbId) {
            await autoMatchTmdb(show.id, title, "TV", undefined, tmdbKey, errors);
          }
          continue;
        }

        // Otherwise: treat as a movie folder (single video inside)
        const videos = allFiles;
        if (videos.length > 0) {
          scanned++;
          const { title, year } = cleanTitle(entry);
          const file = path.join(entryPath, videos[0]);
          const existing = await db.media.findFirst({ where: { title, type: "MOVIE" } });
          if (existing) {
            await db.media.update({ where: { id: existing.id }, data: { filePath: file, year: existing.year ?? year } });
            updated++;
          } else {
            await db.media.create({
              data: { type: "MOVIE", title, filePath: file, year, sortTitle: title.toLowerCase() },
            });
            added++;
          }
          if (autoMatch && tmdbKey && !existing?.tmdbId) {
            const created = await db.media.findFirst({ where: { title, type: "MOVIE" } });
            if (created) await autoMatchTmdb(created.id, title, "MOVIE", year, tmdbKey, errors);
          }
        } else {
          skipped++;
        }
      }
    } catch (e) {
      errors.push(`Error processing "${entry}": ${(e as Error).message}`);
    }
  }

  await db.libraryConfig.update({
    where: { id: "default" },
    data: { lastScan: new Date(), scanCount: { increment: 1 }, mediaDir, tmdbKey: tmdbKey ?? cfg.tmdbKey },
  });

  return { scanned, added, updated, skipped, errors, durationMs: Date.now() - start };
}

async function autoMatchTmdb(
  mediaId: string,
  title: string,
  type: "MOVIE" | "TV",
  year: number | undefined,
  key: string,
  errors: string[]
) {
  try {
    const matches = await searchTmdb(title, type, year, key);
    if (matches.length === 0) return;
    await applyTmdbMetadata(mediaId, matches[0].tmdbId, type, key);
  } catch (e) {
    errors.push(`Metadata match failed for "${title}": ${(e as Error).message}`);
  }
}
