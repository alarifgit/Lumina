import fs from "fs/promises";
import type { Stats } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { searchTmdb, applyTmdbMetadata, mergeMediaRows } from "@/lib/tmdb";
import { findSubtitlesForVideo } from "@/lib/subtitles";
import { splitTrailingReleaseYear } from "@/lib/title-parser";
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
  t = t.replace(/\b(1080p|720p|480p|2160p|4k|x264|x265|h264|h265|hevc|bluray|web-dl|webrip|web|brrip|bdrip|dvdrip|remux|hdr|atmos|aac|ac3|5\.1|2\.0|10bit|dual|audio)\b/gi, " ");
  t = t.replace(/\(|\)|\[|\]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  const parsed = splitTrailingReleaseYear(t);
  return { title: parsed.title || raw, year: parsed.year ?? null };
}

function sourceDates(stat: Stats) {
  const created = stat.birthtime && stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime;
  return {
    sourceCreatedAt: created,
    sourceModifiedAt: stat.mtime,
  };
}

function normalizedTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stripTrailingYear(value: string) {
  return value.replace(/\(?\b(19\d{2}|20\d{2})\b\)?\s*$/, "").replace(/\s+/g, " ").trim();
}

async function mergeSiblingYearStubs(targetId: string, title: string, year: number | null, type: string, sectionId: string | null) {
  if (!year) return;
  const siblings = await db.media.findMany({
    where: {
      id: { not: targetId },
      type,
      sectionId,
      tmdbId: null,
      title: { contains: String(year) },
    },
  });
  const cleanTarget = normalizedTitle(title);
  for (const sibling of siblings) {
    if (normalizedTitle(stripTrailingYear(sibling.title)) === cleanTarget) {
      await mergeMediaRows(sibling.id, targetId);
    }
  }
}

export interface ScanOptions {
  sectionId: string;
  mediaDir?: string;
  tmdbKey?: string;
  autoMatch?: boolean;
}

/** Scan a single library section's media directory. */
export async function scanSection(opts: ScanOptions): Promise<ScanResult> {
  const start = Date.now();
  const section = await db.librarySection.findUnique({ where: { id: opts.sectionId } });
  if (!section) {
    return {
      scanned: 0, added: 0, updated: 0, skipped: 0,
      errors: [`Section not found: ${opts.sectionId}`],
      durationMs: Date.now() - start,
      sectionId: opts.sectionId,
    };
  }

  const mediaDir = opts.mediaDir ?? section.mediaDir;
  const tmdbKey = opts.tmdbKey ?? section.tmdbKey ?? (await db.libraryConfig.findUnique({ where: { id: "default" } }))?.tmdbKey ?? null;
  const autoMatch = opts.autoMatch ?? section.autoMatch;
  const errors: string[] = [];
  let scanned = 0, added = 0, updated = 0, skipped = 0;

  let entries: string[];
  try {
    entries = await fs.readdir(mediaDir);
  } catch (e) {
    const msg = (e as NodeJS.ErrnoException).code === "ENOENT"
      ? `Directory does not exist: "${mediaDir}" — check that you mounted your media folder at this path (docker-compose volume mapping).`
      : `Cannot read media directory "${mediaDir}": ${(e as Error).message}`;
    errors.push(msg);
    await db.librarySection.update({
      where: { id: section.id },
      data: { lastScan: new Date(), scanCount: { increment: 1 }, mediaDir },
    });
    return { scanned, added, updated, skipped, errors, durationMs: Date.now() - start, sectionId: section.id, sectionName: section.name };
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
        const dates = sourceDates(stat);
        const existing = await db.media.findFirst({ where: { title, type: section.type, sectionId: section.id } });
        if (existing) {
          await db.media.update({ where: { id: existing.id }, data: { filePath: entryPath, year: existing.year ?? year, ...dates } });
          await syncSubtitles(existing.id, null, entryPath);
          updated++;
        } else {
          const m = await db.media.create({
            data: { type: section.type, title, filePath: entryPath, year, sortTitle: title.toLowerCase(), sectionId: section.id, category: section.category, ...dates },
          });
          await syncSubtitles(m.id, null, entryPath);
          added++;
        }
        const target = existing ?? (await db.media.findFirst({ where: { title, type: section.type, sectionId: section.id } }));
        if (target) {
          await mergeSiblingYearStubs(target.id, title, year, section.type, section.id);
        }
        if (autoMatch && tmdbKey && target) {
          await syncTmdbMetadataIfNeeded(
            target,
            title,
            section.type as "MOVIE" | "TV",
            year ?? undefined,
            tmdbKey,
            errors
          );
        }
        continue;
      }

      if (stat.isDirectory()) {
        let subEntries: string[] = [];
        try {
          subEntries = await fs.readdir(entryPath);
        } catch (e) {
          errors.push(`Cannot read dir "${entry}": ${(e as Error).message}`);
          continue;
        }

        const hasSeasonDir = subEntries.some((s) => SEASON_RE.test(s));
        const allFiles = subEntries.filter((s) => isVideo(s));
        const hasEpisodeFiles = allFiles.some((s) => EPISODE_RE.test(s));

        if (hasSeasonDir || hasEpisodeFiles) {
          // TV show
          scanned++;
          const { title, year } = cleanTitle(entry);
          const folderDates = sourceDates(stat);
          let show = await db.media.findFirst({ where: { title, type: "TV", sectionId: section.id } });
          if (!show) {
            show = await db.media.create({
              data: { type: "TV", title, filePath: entryPath, year, sortTitle: title.toLowerCase(), sectionId: section.id, category: section.category, ...folderDates },
            });
            added++;
          } else {
            await db.media.update({ where: { id: show.id }, data: { filePath: entryPath, year: show.year ?? year, ...folderDates } });
            updated++;
          }

          await mergeSiblingYearStubs(show.id, title, year, "TV", section.id);

          const epFiles: { season: number; episode: number; file: string; dates: ReturnType<typeof sourceDates> }[] = [];
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
                if (!em) continue;
                const file = path.join(subPath, f);
                const fileStat = await fs.stat(file).catch(() => null);
                if (fileStat) epFiles.push({ season: seasonNum, episode: parseInt(em[2]), file, dates: sourceDates(fileStat) });
              }
            } else if (isVideo(sub)) {
              const em = sub.match(EPISODE_RE);
              if (em) epFiles.push({ season: parseInt(em[1]), episode: parseInt(em[2]), file: subPath, dates: sourceDates(subStat) });
            }
          }

          const newestEpisode = epFiles.reduce<Date | null>((latest, ep) => {
            if (!latest || ep.dates.sourceModifiedAt > latest) return ep.dates.sourceModifiedAt;
            return latest;
          }, null);
          if (newestEpisode) {
            await db.media.update({
              where: { id: show.id },
              data: { sourceModifiedAt: newestEpisode },
            });
          }

          for (const ep of epFiles) {
            const epTitle = `S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")}`;
            const existingEp = await db.episode.findUnique({
              where: { mediaId_seasonNumber_episodeNumber: { mediaId: show.id, seasonNumber: ep.season, episodeNumber: ep.episode } },
            });
            if (existingEp) {
              await db.episode.update({ where: { id: existingEp.id }, data: { filePath: ep.file, ...ep.dates } });
              await syncSubtitles(show.id, existingEp.id, ep.file);
            } else {
              const newEp = await db.episode.create({
                data: { mediaId: show.id, seasonNumber: ep.season, episodeNumber: ep.episode, title: epTitle, filePath: ep.file, ...ep.dates },
              });
              await syncSubtitles(show.id, newEp.id, ep.file);
            }
          }

          await db.episode.deleteMany({
            where: {
              mediaId: show.id,
              filePath: null,
              streamUrl: null,
            },
          });

          if (autoMatch && tmdbKey) {
            await syncTmdbMetadataIfNeeded(show, title, "TV", undefined, tmdbKey, errors);
          }
          continue;
        }

        // Movie folder (single video inside)
        if (allFiles.length > 0) {
          scanned++;
          const { title, year } = cleanTitle(entry);
          const file = path.join(entryPath, allFiles[0]);
          const fileStat = await fs.stat(file).catch(() => stat);
          const dates = sourceDates(fileStat);
          const existing = await db.media.findFirst({ where: { title, type: section.type, sectionId: section.id } });
          if (existing) {
            await db.media.update({ where: { id: existing.id }, data: { filePath: file, year: existing.year ?? year, ...dates } });
            await syncSubtitles(existing.id, null, file);
            updated++;
          } else {
            const m = await db.media.create({
              data: { type: section.type, title, filePath: file, year, sortTitle: title.toLowerCase(), sectionId: section.id, category: section.category, ...dates },
            });
            await syncSubtitles(m.id, null, file);
            added++;
          }
          const target = existing ?? (await db.media.findFirst({ where: { title, type: section.type, sectionId: section.id } }));
          if (target) {
            await mergeSiblingYearStubs(target.id, title, year, section.type, section.id);
          }
          if (autoMatch && tmdbKey && target) {
            await syncTmdbMetadataIfNeeded(
              target,
              title,
              section.type as "MOVIE" | "TV",
              year ?? undefined,
              tmdbKey,
              errors
            );
          }
        } else {
          skipped++;
        }
      }
    } catch (e) {
      errors.push(`Error processing "${entry}": ${(e as Error).message}`);
    }
  }

  await db.librarySection.update({
    where: { id: section.id },
    data: { lastScan: new Date(), scanCount: { increment: 1 }, mediaDir, tmdbKey: tmdbKey ?? section.tmdbKey },
  });
  await db.libraryConfig.update({
    where: { id: "default" },
    data: { lastScan: new Date(), scanCount: { increment: 1 } },
  }).catch(() => {});

  return { scanned, added, updated, skipped, errors, durationMs: Date.now() - start, sectionId: section.id, sectionName: section.name };
}

/** Detect + persist subtitle tracks for a video file (movie or episode). */
async function syncSubtitles(mediaId: string, episodeId: string | null, videoPath: string) {
  const found = await findSubtitlesForVideo(videoPath, (p) => fs.readdir(p));
  // Remove existing subtitles for this target
  if (episodeId) {
    await db.subtitle.deleteMany({ where: { mediaId, episodeId } });
  } else {
    await db.subtitle.deleteMany({ where: { mediaId, episodeId: null } });
  }
  for (let i = 0; i < found.length; i++) {
    const s = found[i];
    await db.subtitle.create({
      data: {
        mediaId,
        episodeId,
        language: s.language,
        label: s.label,
        filePath: s.filePath,
        format: s.format,
        isDefault: i === 0,
      },
    });
  }
}

type MetadataCandidate = {
  id: string;
  tmdbId: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string | null;
  rating: number | null;
};

function needsMetadataRefresh(media: MetadataCandidate) {
  return (
    !!media.tmdbId &&
    (!media.posterUrl || !media.backdropUrl || !media.overview || media.rating == null)
  );
}

async function syncTmdbMetadataIfNeeded(
  media: MetadataCandidate,
  title: string,
  type: "MOVIE" | "TV",
  year: number | undefined,
  key: string,
  errors: string[]
) {
  try {
    if (media.tmdbId) {
      if (needsMetadataRefresh(media)) {
        await applyTmdbMetadata(media.id, media.tmdbId, type, key);
      }
      return;
    }
    const matches = await searchTmdb(title, type, year, key);
    if (matches.length === 0) return;
    await applyTmdbMetadata(media.id, matches[0].tmdbId, type, key);
  } catch (e) {
    errors.push(`Metadata match failed for "${title}": ${(e as Error).message}`);
  }
}
