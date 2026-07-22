import fs from "fs/promises";
import type { Dirent, Stats } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { searchTmdb, applyTmdbMetadata } from "@/lib/tmdb";
import { decideTmdbAutoMatch } from "@/lib/tmdb-match";
import { deriveEpisodeSourceTitle } from "@/lib/episode-title";
import { findSubtitlesForVideo, type SubtitleDiscoveryResult } from "@/lib/subtitles";
import { splitTrailingReleaseYear } from "@/lib/title-parser";
import type { MediaType, ScanManifest, ScanManifestEntry, ScanResult } from "@/lib/types";

const VIDEO_EXTS = new Set([".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".ts"]);
const SEASON_RE = /season\s*(\d{1,2})/i;
const EPISODE_RE = /[sS](\d{1,2})\s*[eE](\d{1,4})(?!\d)/;
const EXTRA_DIR_RE = /^(extras?|featurettes?|trailers?|samples?|behind[ ._-]*the[ ._-]*scenes)$/i;
const EXTRA_FILE_RE = /(?:^|[ ._-])(sample|trailer|featurette|behind[ ._-]*the[ ._-]*scenes)(?:[ ._-]|$)/i;
const SYSTEM_FILE_RE = /^(?:\._.*|\.DS_Store|Thumbs\.db|desktop\.ini)$/i;
const SYSTEM_DIR_RE = /^(?:@eaDir|\.AppleDouble|#recycle)$/i;

type FsOps = {
  readdir: typeof fs.readdir;
  stat: typeof fs.stat;
};

export interface ScanOptions {
  sectionId: string;
  mediaDir?: string;
  tmdbKey?: string;
  autoMatch?: boolean;
  /** Test seam for deterministic traversal failures. */
  fileSystem?: FsOps;
  /** Watcher paths that caused this scan, used to limit expensive refresh work. */
  changedPaths?: string[];
  /** Watcher scans set this false; explicit scans may refresh incomplete metadata. */
  refreshExistingMetadata?: boolean;
  /** Test seam for proving unchanged files skip embedded ffprobe analysis. */
  subtitleDiscovery?: typeof findSubtitlesForVideo;
}

const scannerGlobal = globalThis as typeof globalThis & {
  __luminaSectionScanQueues?: Map<string, Promise<void>>;
  __luminaLastSectionScanResults?: Map<string, ScanResult>;
};
const sectionQueues = scannerGlobal.__luminaSectionScanQueues ?? new Map<string, Promise<void>>();
scannerGlobal.__luminaSectionScanQueues = sectionQueues;
const lastSectionScanResults =
  scannerGlobal.__luminaLastSectionScanResults ?? new Map<string, ScanResult>();
scannerGlobal.__luminaLastSectionScanResults = lastSectionScanResults;

export function getLastSectionScanResult(sectionId: string) {
  return lastSectionScanResults.get(sectionId) ?? null;
}

export function normalizeMediaPath(value: string) {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isVideo(name: string) {
  return VIDEO_EXTS.has(path.extname(name).toLowerCase());
}

function isSystemEntry(name: string, directory = false) {
  return (directory ? SYSTEM_DIR_RE : SYSTEM_FILE_RE).test(name);
}

export function parseMediaTitle(raw: string): { title: string; year: number | null } {
  const extension = path.extname(raw).toLowerCase();
  // Folder names are often used as the authoritative title. Only remove a
  // suffix when it is a media extension; otherwise dotted titles such as
  // "Your Name. (2016)" and "Heaven's Feel I. Presage Flower" are truncated.
  let title = path.basename(raw, VIDEO_EXTS.has(extension) ? extension : undefined);
  title = title.replace(/[._]/g, " ");
  title = title.replace(/\b(1080p|720p|480p|2160p|4k|x264|x265|h264|h265|hevc|bluray|web[ ._-]?dl|webrip|hdtv|web|brrip|bdrip|dvdrip|remux|hdr|atmos|aac|ac3|5\.1|2\.0|10bit|dual[ ._-]?audio)\b/gi, " ");
  title = title
    .replace(/[()\[\]]/g, " ")
    .replace(/\s*[-–—+]+\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parsed = splitTrailingReleaseYear(title);
  return { title: parsed.title || raw, year: parsed.year ?? null };
}

function isPlaceholderEpisodeTitle(value: string | null | undefined) {
  return /^s\d+e\d+$/i.test(String(value ?? "").trim());
}

function sourceDates(stat: Stats) {
  return {
    sourceCreatedAt: stat.birthtime?.getTime() > 0 ? stat.birthtime : stat.mtime,
    sourceModifiedAt: stat.mtime,
  };
}

type SourceCandidate = {
  filePath: string | null;
  sourceCreatedAt: Date | null;
  sourceModifiedAt: Date | null;
};

function sameDate(left: Date | null | undefined, right: Date) {
  return !!left && left.getTime() === right.getTime();
}

function unavailableError(error: unknown) {
  return ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "");
}

function normalizedTitleIdentity(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Scans for one section are queued here, shared by API and watcher callers. */
export async function scanSection(options: ScanOptions): Promise<ScanResult> {
  const previous = sectionQueues.get(options.sectionId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => current);
  sectionQueues.set(options.sectionId, tail);
  await previous.catch(() => {});
  try {
    return await scanSectionUnlocked(options);
  } finally {
    release();
    if (sectionQueues.get(options.sectionId) === tail) sectionQueues.delete(options.sectionId);
  }
}

async function scanSectionUnlocked(options: ScanOptions): Promise<ScanResult> {
  const start = Date.now();
  const io = options.fileSystem ?? fs;
  const entries: ScanManifestEntry[] = [];
  const manifest: ScanManifest = { complete: true, reconciliationApplied: false, entries };
  const errors: string[] = [];
  let scanned = 0, added = 0, updated = 0, skipped = 0;
  const section = await db.librarySection.findUnique({ where: { id: options.sectionId } });
  const finish = (sectionName?: string): ScanResult => {
    const result = {
      scanned, added, updated, skipped, errors, durationMs: Date.now() - start,
      sectionId: options.sectionId, sectionName, complete: manifest.complete, manifest,
    };
    if (sectionName) lastSectionScanResults.set(options.sectionId, result);
    return result;
  };
  if (!section) {
    errors.push(`Section not found: ${options.sectionId}`);
    manifest.complete = false;
    return finish();
  }

  const mediaDir = options.mediaDir ?? section.mediaDir;
  const tmdbKey = options.tmdbKey ?? section.tmdbKey ??
    (await db.libraryConfig.findUnique({ where: { id: "default" } }))?.tmdbKey ?? null;
  const autoMatch = options.autoMatch ?? section.autoMatch;
  const refreshExistingMetadata = options.refreshExistingMetadata ?? true;
  const discoverSubtitles = options.subtitleDiscovery ?? findSubtitlesForVideo;
  const changedPaths = new Set((options.changedPaths ?? []).map(normalizeMediaPath));
  const discoveredMedia = new Set<string>();
  const discoveredEpisodes = new Map<string, Set<string>>();

  const sourceNeedsAnalysis = (existing: SourceCandidate | null, file: string, stat: Stats) => {
    if (!existing?.filePath) return true;
    if (normalizeMediaPath(existing.filePath) !== normalizeMediaPath(file)) return true;
    if (!sameDate(existing.sourceModifiedAt, stat.mtime)) return true;
    return changedPaths.has(normalizeMediaPath(file));
  };
  const sourceNeedsUpdate = (existing: SourceCandidate, file: string, stat: Stats) => {
    const dates = sourceDates(stat);
    return normalizeMediaPath(existing.filePath ?? file) !== normalizeMediaPath(file) ||
      !sameDate(existing.sourceModifiedAt, dates.sourceModifiedAt) ||
      !sameDate(existing.sourceCreatedAt, dates.sourceCreatedAt);
  };
  const changedInside = (directory: string) => {
    const normalized = normalizeMediaPath(directory);
    return [...changedPaths].some((changed) => changed === normalized || changed.startsWith(`${normalized}${path.sep}`));
  };

  const traversalFailure = (target: string, error: unknown) => {
    const reason = (error as Error).message;
    manifest.complete = false;
    errors.push(`Cannot traverse "${target}": ${reason}`);
    entries.push({ kind: "traversal-error", path: target, reason });
  };
  const recordSubtitleDiscovery = (result: SubtitleDiscoveryResult) => {
    for (const issue of result.issues) {
      if (issue.traversal) {
        traversalFailure(issue.path, new Error(issue.message));
      } else {
        const reason = `Embedded subtitle analysis failed: ${issue.message}`;
        errors.push(`${issue.path}: ${reason}`);
        entries.push({ kind: "unsupported", path: issue.path, reason });
      }
    }
  };
  const directoryEntryNames = new Map<string, string[]>();
  const readDir = async (target: string) => {
    try {
      const result = await io.readdir(target, { withFileTypes: true }) as Dirent[];
      directoryEntryNames.set(normalizeMediaPath(target), result.map((entry) => entry.name));
      return result;
    }
    catch (error) { traversalFailure(target, error); return null; }
  };
  const readSubtitleDir = async (target: string) => {
    const normalized = normalizeMediaPath(target);
    const cached = directoryEntryNames.get(normalized);
    if (cached) return cached;
    const result = await io.readdir(target) as unknown as Array<string | Dirent>;
    const names = result.map((entry) => typeof entry === "string" ? entry : entry.name);
    directoryEntryNames.set(normalized, names);
    return names;
  };
  const getStat = async (target: string) => {
    try { return await io.stat(target); }
    catch (error) { traversalFailure(target, error); return null; }
  };

  const findCandidate = async (type: MediaType, file: string, title: string, year: number | null) => {
    const normalized = normalizeMediaPath(file);
    const rows = await db.media.findMany({ where: { type, sectionId: section.id } });
    const exact = rows.find((row) => row.filePath && normalizeMediaPath(row.filePath) === normalized);
    if (exact) return exact;
    const titleIdentity = normalizedTitleIdentity(title);
    const titleRows = rows.filter((row) =>
      !!titleIdentity &&
      [row.title, row.sortTitle].some((candidate) => normalizedTitleIdentity(candidate) === titleIdentity) &&
      (!year || !row.year || row.year === year)
    );
    for (const row of titleRows) {
      let previousUnavailable = !row.filePath;
      if (row.filePath && !discoveredMedia.has(normalizeMediaPath(row.filePath))) {
        try { await io.stat(row.filePath); }
        catch (error) {
          if (unavailableError(error)) previousUnavailable = true;
          else traversalFailure(row.filePath, error);
        }
      }
      if (previousUnavailable) {
        entries.push({ kind: "identity-collision", path: file, rowId: row.id, reason: "Reused title/year row because its previous path is unavailable", mediaType: type, title, year });
        return row;
      }
      entries.push({ kind: "identity-collision", path: file, rowId: row.id, reason: `Kept distinct because existing path is available: ${row.filePath}`, mediaType: type, title, year });
    }
    return null;
  };

  const syncMovie = async (rawTitle: string, file: string) => {
    const stat = await getStat(file);
    if (!stat) return;
    const normalized = normalizeMediaPath(file);
    if (discoveredMedia.has(normalized)) {
      entries.push({ kind: "identity-collision", path: file, reason: "Duplicate normalized path discovered" });
      return;
    }
    discoveredMedia.add(normalized);
    scanned++;
    const parsed = parseMediaTitle(rawTitle);
    entries.push({ kind: "discovered", path: file, mediaType: "MOVIE" });
    entries.push({ kind: "parser-result", path: file, mediaType: "MOVIE", ...parsed });
    let media = await findCandidate("MOVIE", file, parsed.title, parsed.year);
    const isNew = !media;
    let countedAsUpdated = false;
    const analyzeEmbeddedSubtitles = sourceNeedsAnalysis(media, file, stat);
    if (media) {
      if (sourceNeedsUpdate(media, file, stat) || (media.year == null && parsed.year != null)) {
        media = await db.media.update({ where: { id: media.id }, data: { filePath: file, year: media.year ?? parsed.year, ...sourceDates(stat) } });
        updated++;
        countedAsUpdated = true;
      }
    } else {
      media = await db.media.create({ data: { type: "MOVIE", title: parsed.title, filePath: file, year: parsed.year, sortTitle: parsed.title.toLowerCase(), sectionId: section.id, category: section.category, ...sourceDates(stat) } });
      added++;
    }
    recordSubtitleDiscovery(
      await syncSubtitles(media.id, null, file, readSubtitleDir, analyzeEmbeddedSubtitles, discoverSubtitles)
    );
    if (autoMatch && tmdbKey && (refreshExistingMetadata || isNew || analyzeEmbeddedSubtitles)) {
      if (await syncTmdbMetadataIfNeeded(
        media,
        parsed.title,
        "MOVIE",
        parsed.year ?? undefined,
        tmdbKey,
        errors,
        entries,
        file
      ) && !isNew && !countedAsUpdated) updated++;
    }
  };

  type EpisodeCandidate = {
    file: string;
    season: number;
    episode: number;
    sourceTitle: string | null;
    stat: Stats;
  };

  const collectEpisodeCandidates = async (folder: string, children: Dirent[]) => {
    const candidates: EpisodeCandidate[] = [];
    const inspectFile = async (
      name: string,
      file: string,
      directorySeason?: number
    ) => {
      if (isSystemEntry(name)) {
        entries.push({ kind: "ignored", path: file, reason: "Filesystem metadata sidecar" });
        return;
      }
      if (!isVideo(name)) {
        entries.push({ kind: "unsupported", path: file, reason: "Unsupported non-video entry" });
        return;
      }
      const match = name.match(EPISODE_RE);
      if (!match) {
        entries.push({ kind: "ignored", path: file, reason: "Video filename has no SxxExx episode marker" });
        return;
      }
      const season = Number(match[1]);
      const episode = Number(match[2]);
      if (directorySeason != null && directorySeason !== season) {
        entries.push({
          kind: "identity-collision",
          path: file,
          mediaType: "TV",
          season,
          episode,
          reason: `Used filename season S${String(season).padStart(2, "0")} instead of conflicting directory season ${directorySeason}`,
        });
      }
      const stat = await getStat(file);
      if (!stat) return;
      candidates.push({ file, season, episode, sourceTitle: deriveEpisodeSourceTitle(name), stat });
    };

    for (const child of children) {
      const childPath = path.join(folder, child.name);
      if (child.isDirectory()) {
        if (isSystemEntry(child.name, true)) {
          entries.push({ kind: "ignored", path: childPath, reason: "Filesystem metadata directory" });
          continue;
        }
        const seasonEntries = await readDir(childPath);
        if (!seasonEntries) continue;
        const seasonMatch = child.name.match(SEASON_RE);
        const directorySeason = seasonMatch ? Number(seasonMatch[1]) : undefined;
        const before = candidates.length;
        for (const item of seasonEntries) {
          const itemPath = path.join(childPath, item.name);
          if (item.isFile()) await inspectFile(item.name, itemPath, directorySeason);
          else entries.push({ kind: "ignored", path: itemPath, reason: "Nested TV directory is not an episode file" });
        }
        if (candidates.length === before) {
          entries.push({ kind: "ignored", path: childPath, reason: "Directory contains no supported episode video" });
        }
      } else if (child.isFile()) {
        await inspectFile(child.name, childPath);
      } else {
        entries.push({ kind: "unsupported", path: childPath, reason: "Unsupported filesystem entry" });
      }
    }
    return candidates;
  };

  const scanShow = async (folder: string, folderStat: Stats, candidates: EpisodeCandidate[]) => {
    const parsed = parseMediaTitle(path.basename(folder));
    const normalized = normalizeMediaPath(folder);
    discoveredMedia.add(normalized);
    scanned++;
    entries.push({ kind: "discovered", path: folder, mediaType: "TV" });
    entries.push({ kind: "parser-result", path: folder, mediaType: "TV", ...parsed });
    let show = await findCandidate("TV", folder, parsed.title, parsed.year);
    const isNew = !show;
    let countedAsUpdated = false;
    const showHasSourceChanges = sourceNeedsAnalysis(show, folder, folderStat) || changedInside(folder);
    if (show) {
      if (sourceNeedsUpdate(show, folder, folderStat) || (show.year == null && parsed.year != null)) {
        show = await db.media.update({ where: { id: show.id }, data: { filePath: folder, year: show.year ?? parsed.year, ...sourceDates(folderStat) } });
        updated++;
        countedAsUpdated = true;
      }
    } else {
      show = await db.media.create({ data: { type: "TV", title: parsed.title, filePath: folder, year: parsed.year, sortTitle: parsed.title.toLowerCase(), sectionId: section.id, category: section.category, ...sourceDates(folderStat) } });
      added++;
    }
    const episodePaths = new Set<string>();
    discoveredEpisodes.set(show.id, episodePaths);
    const episodeKey = (season: number, episode: number) => `${season}x${episode}`;
    const candidatePaths = new Set(candidates.map((candidate) => normalizeMediaPath(candidate.file)));
    const existingEpisodes = await db.episode.findMany({ where: { mediaId: show.id } });
    const episodesByPath = new Map(
      existingEpisodes
        .filter((episode) => episode.filePath)
        .map((episode) => [normalizeMediaPath(episode.filePath!), episode])
    );
    const episodesByIdentity = new Map(
      existingEpisodes.map((episode) => [
        episodeKey(episode.seasonNumber, episode.episodeNumber),
        episode,
      ])
    );
    const blockedEpisodePaths = new Set<string>();
    let episodeIdentityChanged = false;
    let episodeContentChanged = false;

    // Older scanners treated every non-`Season N` directory as season 1, so
    // Plex-style `Specials/...S00E03...` paths can already belong to an S1 row.
    // Re-key exact paths before resolving any S/E fallback so traversal order
    // cannot let a real S1 file overwrite the legacy Specials path and its
    // metadata, subtitle, or progress relations.
    for (const candidate of candidates) {
      const normalized = normalizeMediaPath(candidate.file);
      const exact = episodesByPath.get(normalized);
      if (
        !exact ||
        (exact.seasonNumber === candidate.season && exact.episodeNumber === candidate.episode)
      ) {
        continue;
      }
      const oldKey = episodeKey(exact.seasonNumber, exact.episodeNumber);
      const newKey = episodeKey(candidate.season, candidate.episode);
      const identityOwner = episodesByIdentity.get(newKey);
      if (identityOwner && identityOwner.id !== exact.id) {
        blockedEpisodePaths.add(normalized);
        entries.push({
          kind: "identity-collision",
          path: candidate.file,
          rowId: identityOwner.id,
          mediaType: "TV",
          season: candidate.season,
          episode: candidate.episode,
          reason: `Could not re-key exact-path row ${exact.id} from S${exact.seasonNumber}E${exact.episodeNumber}: S${candidate.season}E${candidate.episode} is already owned by row ${identityOwner.id}`,
        });
        continue;
      }
      const rekeyed = await db.episode.update({
        where: { id: exact.id },
        data: {
          seasonNumber: candidate.season,
          episodeNumber: candidate.episode,
        },
      });
      if (episodesByIdentity.get(oldKey)?.id === exact.id) episodesByIdentity.delete(oldKey);
      episodesByIdentity.set(newKey, rekeyed);
      episodesByPath.set(normalized, rekeyed);
      episodeIdentityChanged = true;
      episodeContentChanged = true;
      entries.push({
        kind: "identity-collision",
        path: candidate.file,
        rowId: exact.id,
        mediaType: "TV",
        season: candidate.season,
        episode: candidate.episode,
        reason: `Re-keyed existing episode row by exact normalized path from S${exact.seasonNumber}E${exact.episodeNumber} to S${candidate.season}E${candidate.episode}`,
      });
    }

    for (const candidate of candidates) {
      const { season, episode, stat } = candidate;
      const normalized = normalizeMediaPath(candidate.file);
      const identityKey = episodeKey(season, episode);
      episodePaths.add(normalized);
      entries.push({
        kind: "discovered",
        path: candidate.file,
        mediaType: "TV",
        season,
        episode,
        title: candidate.sourceTitle ?? undefined,
      });
      if (blockedEpisodePaths.has(normalized)) continue;
      let existing = episodesByPath.get(normalized) ?? episodesByIdentity.get(identityKey) ?? null;
      if (existing?.filePath && normalizeMediaPath(existing.filePath) !== normalized) {
        const previousPath = normalizeMediaPath(existing.filePath);
        let previousUnavailable = false;
        if (!candidatePaths.has(previousPath)) {
          try {
            await io.stat(existing.filePath);
          } catch (error) {
            if (unavailableError(error)) previousUnavailable = true;
            else traversalFailure(existing.filePath, error);
          }
        }
        if (!previousUnavailable) {
          entries.push({
            kind: "identity-collision",
            path: candidate.file,
            rowId: existing.id,
            mediaType: "TV",
            season,
            episode,
            reason: `Kept distinct episode path because S${season}E${episode} already has an available path: ${existing.filePath}`,
          });
          continue;
        }
        entries.push({
          kind: "identity-collision",
          path: candidate.file,
          rowId: existing.id,
          mediaType: "TV",
          season,
          episode,
          reason: `Reused S${season}E${episode} row because its previous path is unavailable`,
        });
      }
      const analyzeEmbeddedSubtitles = sourceNeedsAnalysis(existing, candidate.file, stat);
      if (!existing) {
        episodeIdentityChanged = true;
        episodeContentChanged = true;
      }
      const useSourceTitle = Boolean(
        candidate.sourceTitle && (!existing?.title || isPlaceholderEpisodeTitle(existing.title))
      );
      const needsSourceUpdate = existing ? sourceNeedsUpdate(existing, candidate.file, stat) : false;
      if (needsSourceUpdate || useSourceTitle) episodeContentChanged = true;
      const row = existing
        ? needsSourceUpdate || useSourceTitle
          ? await db.episode.update({
              where: { id: existing.id },
              data: {
                ...(needsSourceUpdate ? { filePath: candidate.file, ...sourceDates(stat) } : {}),
                ...(useSourceTitle ? { title: candidate.sourceTitle! } : {}),
              },
            })
          : existing
        : await db.episode.create({
            data: {
              mediaId: show.id,
              seasonNumber: season,
              episodeNumber: episode,
              title: candidate.sourceTitle ?? `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`,
              filePath: candidate.file,
              ...sourceDates(stat),
            },
          });
      if (existing?.filePath && normalizeMediaPath(existing.filePath) !== normalized) {
        const previousPath = normalizeMediaPath(existing.filePath);
        if (episodesByPath.get(previousPath)?.id === existing.id) episodesByPath.delete(previousPath);
      }
      episodesByPath.set(normalized, row);
      episodesByIdentity.set(identityKey, row);
      recordSubtitleDiscovery(
        await syncSubtitles(show.id, row.id, candidate.file, readSubtitleDir, analyzeEmbeddedSubtitles, discoverSubtitles)
      );
    }
    let metadataUpdated = false;
    if (autoMatch && tmdbKey && (refreshExistingMetadata || isNew || showHasSourceChanges || episodeIdentityChanged)) {
      metadataUpdated = await syncTmdbMetadataIfNeeded(
        show,
        parsed.title,
        "TV",
        parsed.year ?? undefined,
        tmdbKey,
        errors,
        entries,
        folder,
        episodeIdentityChanged
      );
    }
    if (!isNew && !countedAsUpdated && (episodeContentChanged || metadataUpdated)) updated++;
  };

  const walkMovies = async (root: string, depth = 0): Promise<string[]> => {
    if (depth > 4) {
      const reason = "Movie recursion depth exceeds 4; subtree was not traversed";
      manifest.complete = false;
      errors.push(`Cannot completely traverse "${root}": ${reason}`);
      entries.push({ kind: "traversal-error", path: root, reason });
      return [];
    }
    const children = await readDir(root);
    if (!children) return [];
    const found: string[] = [];
    for (const child of children) {
      const childPath = path.join(root, child.name);
      if (child.isDirectory()) {
        if (isSystemEntry(child.name, true)) entries.push({ kind: "ignored", path: childPath, reason: "Filesystem metadata directory" });
        else if (EXTRA_DIR_RE.test(child.name)) entries.push({ kind: "ignored", path: childPath, reason: "Extras/trailer directory" });
        else found.push(...await walkMovies(childPath, depth + 1));
      } else if (isSystemEntry(child.name)) entries.push({ kind: "ignored", path: childPath, reason: "Filesystem metadata sidecar" });
      else if (!isVideo(child.name)) entries.push({ kind: "unsupported", path: childPath, reason: "Unsupported non-video entry" });
      else if (EXTRA_FILE_RE.test(child.name)) entries.push({ kind: "ignored", path: childPath, reason: "Extras/trailer video" });
      else found.push(childPath);
    }
    return found;
  };

  const roots = await readDir(mediaDir);
  if (roots) {
    for (const root of roots) {
      const rootPath = path.join(mediaDir, root.name);
      if (root.isFile()) {
        if (isSystemEntry(root.name)) entries.push({ kind: "ignored", path: rootPath, reason: "Filesystem metadata sidecar" });
        else if (isVideo(root.name) && !EXTRA_FILE_RE.test(root.name)) await syncMovie(root.name, rootPath);
        else entries.push({ kind: isVideo(root.name) ? "ignored" : "unsupported", path: rootPath, reason: isVideo(root.name) ? "Extras/trailer video" : "Unsupported non-video entry" });
        continue;
      }
      if (!root.isDirectory()) { entries.push({ kind: "unsupported", path: rootPath, reason: "Unsupported filesystem entry" }); continue; }
      if (isSystemEntry(root.name, true)) { entries.push({ kind: "ignored", path: rootPath, reason: "Filesystem metadata directory" }); continue; }
      if (EXTRA_DIR_RE.test(root.name)) { entries.push({ kind: "ignored", path: rootPath, reason: "Extras/trailer directory" }); continue; }
      const children = await readDir(rootPath);
      if (!children) continue;
      if (section.type === "TV") {
        const episodeCandidates = await collectEpisodeCandidates(rootPath, children);
        if (episodeCandidates.length) {
          const stat = await getStat(rootPath);
          if (stat) await scanShow(rootPath, stat, episodeCandidates);
        } else {
          skipped++;
          entries.push({ kind: "ignored", path: rootPath, reason: "Directory contains no supported episode video" });
        }
      } else if (section.type === "MOVIE") {
        const videos = await walkMovies(rootPath);
        const parentCounts = new Map<string, number>();
        videos.forEach((file) => parentCounts.set(path.dirname(file), (parentCounts.get(path.dirname(file)) ?? 0) + 1));
        for (const file of videos) {
          const parent = path.dirname(file);
          const raw = videos.length === 1 ? root.name : parent !== rootPath && parentCounts.get(parent) === 1 ? path.basename(parent) : path.basename(file);
          await syncMovie(raw, file);
        }
        if (!videos.length) { skipped++; entries.push({ kind: "ignored", path: rootPath, reason: "Directory contains no supported feature video" }); }
      }
    }
  }

  const mediaRows = await db.media.findMany({ where: { sectionId: section.id, filePath: { not: null } }, select: { id: true, type: true, filePath: true } });
  for (const row of mediaRows) {
    if (!row.filePath || discoveredMedia.has(normalizeMediaPath(row.filePath))) continue;
    entries.push({ kind: "proposed-unavailable", path: row.filePath, rowId: row.id, mediaType: row.type as MediaType, reason: manifest.complete ? "Not discovered in complete scan" : "Not discovered, but reconciliation suppressed because traversal was incomplete" });
  }
  const episodeRows = await db.episode.findMany({ where: { media: { sectionId: section.id }, filePath: { not: null } }, select: { id: true, mediaId: true, filePath: true, seasonNumber: true, episodeNumber: true } });
  for (const row of episodeRows) {
    if (!row.filePath || discoveredEpisodes.get(row.mediaId)?.has(normalizeMediaPath(row.filePath))) continue;
    entries.push({ kind: "proposed-unavailable", path: row.filePath, rowId: row.id, mediaType: "TV", season: row.seasonNumber, episode: row.episodeNumber, reason: manifest.complete ? "Episode not discovered in complete scan" : "Episode not discovered, but reconciliation suppressed because traversal was incomplete" });
  }
  if (manifest.complete) {
    for (const entry of entries.filter((item) => item.kind === "proposed-unavailable")) {
      if (!entry.rowId) continue;
      if (entry.season != null) await db.episode.update({ where: { id: entry.rowId }, data: { filePath: null } });
      else {
        await db.media.update({ where: { id: entry.rowId }, data: { filePath: null } });
        if (entry.mediaType === "TV") await db.episode.updateMany({ where: { mediaId: entry.rowId, filePath: { not: null } }, data: { filePath: null } });
      }
    }
    manifest.reconciliationApplied = true;
  }

  await db.librarySection.update({ where: { id: section.id }, data: { lastScan: new Date(), scanCount: { increment: 1 }, mediaDir, tmdbKey: tmdbKey ?? section.tmdbKey } });
  await db.libraryConfig.update({ where: { id: "default" }, data: { lastScan: new Date(), scanCount: { increment: 1 } } }).catch(() => {});
  return finish(section.name);
}

async function syncSubtitles(
  mediaId: string,
  episodeId: string | null,
  videoPath: string,
  readdir: (target: string) => Promise<string[]>,
  includeEmbedded: boolean,
  discover: typeof findSubtitlesForVideo
): Promise<SubtitleDiscoveryResult> {
  const discovery = await discover(
    videoPath,
    readdir,
    { includeEmbedded }
  );
  const found = discovery.subtitles;
  const existing = await db.subtitle.findMany({ where: episodeId ? { mediaId, episodeId } : { mediaId, episodeId: null } });
  const existingSidecars = existing.filter((subtitle) => subtitle.streamIndex == null);
  const existingEmbedded = existing.filter((subtitle) => subtitle.streamIndex != null);
  const foundSidecars = found.filter((subtitle) => subtitle.streamIndex == null);
  const foundEmbedded = found.filter((subtitle) => subtitle.streamIndex != null);
  const preservedTracks = [
    ...(!discovery.sidecarComplete ? existingSidecars : []),
    ...(!discovery.embeddedComplete ? existingEmbedded : []),
  ];
  const reconcilableTracks = [
    ...(discovery.sidecarComplete ? foundSidecars : []),
    ...(discovery.embeddedComplete ? foundEmbedded : []),
  ];
  const hasExplicitDefault = [...preservedTracks, ...reconcilableTracks]
    .some((subtitle) => subtitle.isDefault);
  let assignedDefault = hasExplicitDefault;
  const normalizedFound = found.map((subtitle) => {
    const reconcilable = subtitle.streamIndex == null
      ? discovery.sidecarComplete
      : discovery.embeddedComplete;
    const assignDefault = reconcilable && !assignedDefault;
    if (assignDefault) assignedDefault = true;
    return { ...subtitle, isDefault: subtitle.isDefault || assignDefault };
  });
  const signature = (subtitle: {
    language: string;
    label: string;
    filePath: string | null;
    format: string;
    streamIndex: number | null;
    codec: string | null;
    isDefault: boolean;
  }) => JSON.stringify([
    subtitle.language,
    subtitle.label,
    subtitle.filePath,
    subtitle.format,
    subtitle.streamIndex,
    subtitle.codec,
    subtitle.isDefault,
  ]);
  const reconcileGroup = async (
    current: typeof existing,
    next: typeof normalizedFound,
    embedded: boolean
  ) => {
    const currentSignature = current.map(signature).sort();
    const nextSignature = next.map(signature).sort();
    if (currentSignature.length === nextSignature.length && currentSignature.every((value, index) => value === nextSignature[index])) return;
    const where = episodeId ? { mediaId, episodeId } : { mediaId, episodeId: null };
    await db.$transaction(async (tx) => {
      await tx.subtitle.deleteMany({
        where: { ...where, streamIndex: embedded ? { not: null } : null },
      });
      for (const subtitle of next) {
        await tx.subtitle.create({ data: { mediaId, episodeId, language: subtitle.language, label: subtitle.label, filePath: subtitle.filePath, format: subtitle.format, streamIndex: subtitle.streamIndex, codec: subtitle.codec, isDefault: subtitle.isDefault } });
      }
    });
  };

  if (discovery.sidecarComplete) {
    await reconcileGroup(existingSidecars, normalizedFound.filter((subtitle) => subtitle.streamIndex == null), false);
  }
  if (discovery.embeddedComplete) {
    await reconcileGroup(existingEmbedded, normalizedFound.filter((subtitle) => subtitle.streamIndex != null), true);
  }
  return discovery;
}

type MetadataCandidate = { id: string; tmdbId: number | null; posterUrl: string | null; backdropUrl: string | null; overview: string | null; rating: number | null };
async function syncTmdbMetadataIfNeeded(media: MetadataCandidate, title: string, type: MediaType, year: number | undefined, key: string, errors: string[], manifestEntries: ScanManifestEntry[], mediaPath: string, forceRefresh = false) {
  const applyMetadata = async (tmdbId: number) => {
    const result = await applyTmdbMetadata(media.id, tmdbId, type, key);
    for (const skipped of result.episodeMetadataSkips) {
      manifestEntries.push({
        kind: "identity-collision",
        path: skipped.filePath ?? mediaPath,
        rowId: skipped.episodeId,
        mediaType: type,
        title: skipped.sourceTitle,
        season: skipped.seasonNumber,
        episode: skipped.episodeNumber,
        reason: `Kept source episode title “${skipped.sourceTitle}” because TMDB S${skipped.seasonNumber}E${skipped.episodeNumber} is “${skipped.providerTitle}”; provider episode ordering may differ`,
      });
    }
  };
  try {
    if (media.tmdbId) {
      if (forceRefresh || !media.posterUrl || !media.backdropUrl || !media.overview || media.rating == null) {
        await applyMetadata(media.tmdbId);
        return true;
      }
      return false;
    }
    const matches = await searchTmdb(title, type, year, key, {
      allowYearlessFallback: false,
    });
    const decision = decideTmdbAutoMatch(title, year, matches);
    const match = decision.match;
    if (!match) {
      const candidates = matches
        .slice(0, 3)
        .map((candidate) => `TMDB ${candidate.tmdbId} “${candidate.title}” (${candidate.year ?? "unknown"})`)
        .join(", ");
      const reason = {
        "no-candidates": year == null
          ? "the search returned no candidates"
          : "the year-constrained search returned no candidates",
        "no-exact-title": "no candidate exactly matched the normalized source title",
        "year-mismatch": `exact-title candidates did not match source year ${year}`,
        ambiguous: "multiple exact title/year candidates require manual review",
        matched: "",
      }[decision.reason];
      manifestEntries.push({
        kind: "identity-collision",
        path: mediaPath,
        rowId: media.id,
        mediaType: type,
        title,
        year: year ?? null,
        reason: `TMDB auto-match skipped: ${reason}${candidates ? `. Candidates: ${candidates}` : ""}`,
      });
      return false;
    }
    const identityOwner = await db.media.findFirst({ where: { id: { not: media.id }, type, tmdbId: match.tmdbId } });
    if (identityOwner?.filePath && normalizeMediaPath(identityOwner.filePath) !== normalizeMediaPath(mediaPath)) {
      manifestEntries.push({ kind: "identity-collision", path: mediaPath, rowId: identityOwner.id, mediaType: type, title, year: year ?? null, reason: `TMDB ${match.tmdbId} is already attached to distinct path: ${identityOwner.filePath}` });
      return false;
    }
    await applyMetadata(match.tmdbId);
    return true;
  } catch (error) {
    const reason = `Metadata match failed for "${title}": ${(error as Error).message}`;
    errors.push(reason);
    manifestEntries.push({
      kind: "unsupported",
      path: mediaPath,
      rowId: media.id,
      mediaType: type,
      title,
      year: year ?? null,
      reason,
    });
    return false;
  }
}
