import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import type { PrismaClient } from "@prisma/client";
import type { scanSection as ScanSection } from "@/lib/scanner";

let tempRoot: string;
let db: PrismaClient;
let scanSection: typeof ScanSection;

async function video(target: string) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, "fixture");
  return target;
}

async function section(type: "MOVIE" | "TV", mediaDir: string) {
  return db.librarySection.create({
    data: { name: `${type}-${Math.random()}`, type, category: "default", mediaDir, autoMatch: false },
  });
}

before(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-scanner-"));
  const databasePath = path.join(tempRoot, "test.db");
  process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, "/")}`;
  const sqlite = new DatabaseSync(databasePath);
  sqlite.exec(`
    CREATE TABLE LibrarySection (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'default', mediaDir TEXT NOT NULL, tmdbKey TEXT, autoMatch INTEGER NOT NULL DEFAULT 1, lastScan DATETIME, scanCount INTEGER NOT NULL DEFAULT 0, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE LibraryConfig (id TEXT PRIMARY KEY, mediaDir TEXT NOT NULL DEFAULT '/media', tmdbKey TEXT, plexUrl TEXT, plexToken TEXT, plexSyncDirection TEXT NOT NULL DEFAULT 'pull', lastScan DATETIME, scanCount INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE Media (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, sortTitle TEXT, filePath TEXT, sourceCreatedAt DATETIME, sourceModifiedAt DATETIME, streamUrl TEXT, tmdbId INTEGER, imdbId TEXT, overview TEXT, tagline TEXT, posterUrl TEXT, backdropUrl TEXT, releaseDate DATETIME, year INTEGER, runtime INTEGER, rating REAL, voteCount INTEGER, status TEXT, certification TEXT, featured INTEGER NOT NULL DEFAULT 0, trending INTEGER NOT NULL DEFAULT 0, popularity REAL NOT NULL DEFAULT 0, sectionId TEXT, category TEXT NOT NULL DEFAULT 'default', createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE UNIQUE INDEX Media_type_tmdbId_key ON Media(type, tmdbId);
    CREATE TABLE Episode (id TEXT PRIMARY KEY, mediaId TEXT NOT NULL, seasonNumber INTEGER NOT NULL, episodeNumber INTEGER NOT NULL, title TEXT NOT NULL, filePath TEXT, sourceCreatedAt DATETIME, sourceModifiedAt DATETIME, streamUrl TEXT, overview TEXT, stillUrl TEXT, airDate DATETIME, runtime INTEGER, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(mediaId, seasonNumber, episodeNumber));
    CREATE TABLE WatchProgress (id TEXT PRIMARY KEY, mediaId TEXT NOT NULL, episodeId TEXT, position REAL NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, hiddenFromContinueWatching INTEGER NOT NULL DEFAULT 0, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE Subtitle (id TEXT PRIMARY KEY, mediaId TEXT NOT NULL, episodeId TEXT, language TEXT NOT NULL DEFAULT 'en', label TEXT NOT NULL, filePath TEXT, streamUrl TEXT, format TEXT NOT NULL DEFAULT 'srt', streamIndex INTEGER, codec TEXT, isDefault INTEGER NOT NULL DEFAULT 0, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  sqlite.close();
  ({ db } = await import("@/lib/db"));
  ({ scanSection } = await import("@/lib/scanner"));
});

beforeEach(async () => {
  await db.subtitle.deleteMany();
  await db.watchProgress.deleteMany();
  await db.episode.deleteMany();
  await db.media.deleteMany();
  await db.librarySection.deleteMany();
  await db.libraryConfig.deleteMany();
  await db.libraryConfig.create({ data: { id: "default", mediaDir: "" } });
});

after(async () => {
  await db?.$disconnect();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("safe scanner reconciliation", () => {
  test("numeric titles are not parsed as release years", async () => {
    const { parseMediaTitle } = await import("@/lib/scanner");
    assert.deepEqual(parseMediaTitle("1917.mkv"), { title: "1917", year: null });
    assert.deepEqual(parseMediaTitle("2046.mp4"), { title: "2046", year: null });
    assert.deepEqual(parseMediaTitle("1917 (2019) Bluray-1080p.mkv"), { title: "1917", year: 2019 });
  });

  test("preserves dotted titles and removes trailing release tags", async () => {
    const { parseMediaTitle } = await import("@/lib/scanner");
    assert.deepEqual(parseMediaTitle("Your Name. (2016)"), { title: "Your Name", year: 2016 });
    assert.deepEqual(
      parseMediaTitle("Fate+stay night Heaven's Feel I. Presage Flower (2017)"),
      { title: "Fate+stay night Heaven's Feel I Presage Flower", year: 2017 }
    );
    assert.deepEqual(
      parseMediaTitle("Casino.Royale.2006.1080p.BluRay.x265.mkv"),
      { title: "Casino Royale", year: 2006 }
    );
    assert.deepEqual(
      parseMediaTitle("My Hero Academia Heroes Rising (2019) HDTV-1080p.mp4"),
      { title: "My Hero Academia Heroes Rising", year: 2019 }
    );
  });

  test("ignores AppleDouble video sidecars", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "appledouble-"));
    const folder = path.join(root, "My Hero Academia - Heroes Rising (2019)");
    await video(path.join(folder, "._My Hero Academia Heroes Rising (2019) HDTV-1080p.mp4"));
    await video(path.join(folder, "My Hero Academia Heroes Rising (2019) HDTV-1080p.mp4"));
    const s = await section("MOVIE", root);
    const result = await scanSection({ sectionId: s.id });
    const media = await db.media.findMany();
    assert.equal(media.length, 1);
    assert.equal(media[0].title, "My Hero Academia - Heroes Rising");
    assert.equal(media[0].year, 2019);
    assert.equal(result.manifest.entries.some((entry) => entry.kind === "ignored" && entry.path.includes("._My Hero Academia")), true);
  });

  test("keeps numeric and same-name franchise movies available across rescans", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "production-titles-"));
    await video(path.join(root, "1917 (2019)", "1917 (2019) Bluray-1080p.mkv"));
    await video(path.join(root, "Casino Royale (2006)", "Casino.Royale.2006.1080p.BluRay.x265.mkv"));
    const s = await section("MOVIE", root);
    await scanSection({ sectionId: s.id });
    await scanSection({ sectionId: s.id });
    const media = await db.media.findMany({ orderBy: { title: "asc" } });
    assert.deepEqual(
      media.map((item) => ({ title: item.title, year: item.year, available: !!item.filePath })),
      [
        { title: "1917", year: 2019, available: true },
        { title: "Casino Royale", year: 2006, available: true },
      ]
    );
  });

  test("recurses through movie collections and explains extras", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "movies-"));
    await video(path.join(root, "Collection", "Film One (2001)", "Film One (2001).mkv"));
    await video(path.join(root, "Collection", "Film Two (2002)", "Film Two (2002).mp4"));
    await video(path.join(root, "Collection", "Trailers", "Film Two Trailer.mkv"));
    const s = await section("MOVIE", root);
    const result = await scanSection({ sectionId: s.id });
    assert.equal(await db.media.count(), 2);
    assert.equal(result.manifest.entries.some((entry) => entry.kind === "ignored" && entry.path.includes("Trailers")), true);
  });

  test("does not create media rows for empty or unsupported-only directories", async () => {
    const movieRoot = await fs.mkdtemp(path.join(tempRoot, "empty-movies-"));
    const emptyMovie = path.join(movieRoot, "Empty Movie (2024)");
    const unsupportedMovie = path.join(movieRoot, "Unsupported Movie (2024)");
    await fs.mkdir(emptyMovie, { recursive: true });
    await fs.mkdir(unsupportedMovie, { recursive: true });
    await fs.writeFile(path.join(unsupportedMovie, "readme.txt"), "fixture");

    const tvRoot = await fs.mkdtemp(path.join(tempRoot, "empty-tv-"));
    const emptyShow = path.join(tvRoot, "Empty Show (2024)");
    const emptySeason = path.join(emptyShow, "Season 01");
    const unsupportedShow = path.join(tvRoot, "Unsupported Show (2024)");
    const unsupportedSeason = path.join(unsupportedShow, "Season 01");
    await fs.mkdir(emptySeason, { recursive: true });
    await fs.mkdir(unsupportedSeason, { recursive: true });
    await fs.writeFile(path.join(unsupportedSeason, "episode.nfo"), "fixture");

    const movieSection = await section("MOVIE", movieRoot);
    const tvSection = await section("TV", tvRoot);
    const movieResult = await scanSection({ sectionId: movieSection.id });
    const tvResult = await scanSection({ sectionId: tvSection.id });

    assert.equal(await db.media.count(), 0);
    assert.equal(
      movieResult.manifest.entries.some(
        (entry) => entry.kind === "ignored" && entry.path === emptyMovie && entry.reason?.includes("no supported feature video")
      ),
      true
    );
    assert.equal(
      tvResult.manifest.entries.some(
        (entry) => entry.kind === "ignored" && entry.path === emptyShow && entry.reason?.includes("no supported episode video")
      ),
      true
    );
    assert.equal(
      tvResult.manifest.entries.some(
        (entry) => entry.kind === "ignored" && entry.path === emptySeason && entry.reason?.includes("no supported episode video")
      ),
      true
    );
  });

  test("marks a legacy empty-show row unavailable without deleting metadata or progress", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "legacy-empty-tv-"));
    const showPath = path.join(root, "Legacy Empty Show (2024)");
    await fs.mkdir(path.join(showPath, "Season 01"), { recursive: true });
    const s = await section("TV", root);
    const legacy = await db.media.create({
      data: {
        type: "TV",
        title: "Legacy Empty Show",
        sortTitle: "legacy empty show",
        year: 2024,
        overview: "Retained metadata",
        filePath: showPath,
        sectionId: s.id,
      },
    });
    await db.watchProgress.create({
      data: { mediaId: legacy.id, position: 42, duration: 100 },
    });

    const result = await scanSection({ sectionId: s.id });
    const retained = await db.media.findUniqueOrThrow({ where: { id: legacy.id } });

    assert.equal(retained.filePath, null);
    assert.equal(retained.overview, "Retained metadata");
    assert.equal(await db.watchProgress.count({ where: { mediaId: legacy.id } }), 1);
    assert.equal(
      result.manifest.entries.some(
        (entry) => entry.kind === "proposed-unavailable" && entry.rowId === legacy.id
      ),
      true
    );
  });

  test("uses filename episode identity for specials and three-digit episode numbers", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "episode-numbering-"));
    await video(path.join(root, "Numbered Show", "Specials", "Numbered.Show.S0E01.mkv"));
    await video(path.join(root, "Numbered Show", "Specials", "Numbered.Show.S00E04.mkv"));
    const conflictingPath = await video(
      path.join(root, "Numbered Show", "Season 02", "Numbered.Show.S03E100.mkv")
    );
    const s = await section("TV", root);

    const result = await scanSection({ sectionId: s.id });
    const episodes = await db.episode.findMany({
      orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
    });

    assert.deepEqual(
      episodes.map((episode) => [episode.seasonNumber, episode.episodeNumber]),
      [[0, 1], [0, 4], [3, 100]]
    );
    assert.equal(
      result.manifest.entries.some(
        (entry) =>
          entry.kind === "identity-collision" &&
          entry.path === conflictingPath &&
          entry.reason?.includes("filename season S03")
      ),
      true
    );
  });

  test("uses source episode names when remote metadata is unavailable", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "episode-source-titles-"));
    await video(path.join(
      root,
      "Kitchen Nightmares (US)",
      "Season 09",
      "Kitchen Nightmares (US) - S09E01 - Freddy's Steak House WEBDL-1080p.mkv"
    ));
    await video(path.join(
      root,
      "Kitchen Nightmares (US)",
      "Season 09",
      "Kitchen Nightmares (US) - S09E02 - 4-Star Diner HDTV-1080p.mkv"
    ));
    const s = await section("TV", root);

    await scanSection({ sectionId: s.id });
    let episodes = await db.episode.findMany({ orderBy: { episodeNumber: "asc" } });
    assert.deepEqual(episodes.map((episode) => episode.title), ["Freddy's Steak House", "4-Star Diner"]);

    await db.episode.update({ where: { id: episodes[0].id }, data: { title: "S09E01" } });
    await scanSection({ sectionId: s.id });
    episodes = await db.episode.findMany({ orderBy: { episodeNumber: "asc" } });
    assert.deepEqual(episodes.map((episode) => episode.title), ["Freddy's Steak House", "4-Star Diner"]);
  });

  test("rekeys legacy Specials rows by exact path without losing metadata or history", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "legacy-specials-"));
    const showPath = path.join(root, "Daria");
    const specialPath = await video(
      path.join(showPath, "Specials", "Daria - S00E03 - Is It Fall Yet.mkv")
    );
    const regularPath = await video(
      path.join(showPath, "Season 01", "Daria - S01E03 - College Bored.mkv")
    );
    const subtitlePath = `${specialPath}.en.srt`;
    await fs.writeFile(subtitlePath, "fixture subtitles");
    const s = await section("TV", root);
    const show = await db.media.create({
      data: {
        type: "TV",
        title: "Daria",
        sortTitle: "daria",
        filePath: showPath,
        sectionId: s.id,
      },
    });
    const legacy = await db.episode.create({
      data: {
        mediaId: show.id,
        seasonNumber: 1,
        episodeNumber: 3,
        title: "Is It Fall Yet?",
        overview: "Retained special metadata",
        filePath: specialPath,
      },
    });
    const progress = await db.watchProgress.create({
      data: { mediaId: show.id, episodeId: legacy.id, position: 42, duration: 100 },
    });
    const subtitle = await db.subtitle.create({
      data: {
        mediaId: show.id,
        episodeId: legacy.id,
        language: "en",
        label: "English",
        format: "srt",
        filePath: subtitlePath,
        isDefault: true,
      },
    });
    const discover: NonNullable<Parameters<typeof scanSection>[0]["subtitleDiscovery"]> =
      async (target) => ({
        subtitles: target === specialPath
          ? [{
              filePath: subtitlePath,
              language: "en",
              label: "English",
              format: "srt",
              source: "sidecar",
              streamIndex: null,
              codec: null,
              isDefault: true,
            }]
          : [],
        complete: true,
        sidecarComplete: true,
        embeddedComplete: true,
        issues: [],
      });

    const first = await scanSection({ sectionId: s.id, subtitleDiscovery: discover });
    await scanSection({ sectionId: s.id, subtitleDiscovery: discover });
    const episodes = await db.episode.findMany({
      orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
    });
    const retainedSpecial = episodes.find(
      (episode) => episode.seasonNumber === 0 && episode.episodeNumber === 3
    );
    const regularEpisode = episodes.find(
      (episode) => episode.seasonNumber === 1 && episode.episodeNumber === 3
    );

    assert.equal(episodes.length, 2);
    assert.equal(retainedSpecial?.id, legacy.id);
    assert.equal(retainedSpecial?.filePath, specialPath);
    assert.equal(retainedSpecial?.overview, "Retained special metadata");
    assert.equal(regularEpisode?.filePath, regularPath);
    assert.equal((await db.watchProgress.findUniqueOrThrow({ where: { id: progress.id } })).episodeId, legacy.id);
    assert.equal((await db.subtitle.findUniqueOrThrow({ where: { id: subtitle.id } })).episodeId, legacy.id);
    assert.equal(
      first.manifest.entries.some(
        (entry) =>
          entry.kind === "identity-collision" &&
          entry.path === specialPath &&
          entry.reason?.includes("Re-keyed existing episode row")
      ),
      true
    );
  });

  test("never overwrites one live path with another for the same episode identity", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "duplicate-episode-paths-"));
    const firstPath = await video(
      path.join(root, "Duplicate Episode Show", "Season 01", "A.Show.S01E01.mkv")
    );
    const secondPath = await video(
      path.join(root, "Duplicate Episode Show", "Season 01", "B.Show.S01E01.mkv")
    );
    const s = await section("TV", root);

    const first = await scanSection({ sectionId: s.id });
    const retainedPath = (await db.episode.findFirstOrThrow()).filePath;
    const second = await scanSection({ sectionId: s.id });

    assert.equal(await db.episode.count(), 1);
    assert.equal((await db.episode.findFirstOrThrow()).filePath, retainedPath);
    assert.equal([firstPath, secondPath].includes(retainedPath ?? ""), true);
    assert.equal(
      [...first.manifest.entries, ...second.manifest.entries].some(
        (entry) =>
          entry.kind === "identity-collision" &&
          entry.reason?.includes("already has an available path")
      ),
      true
    );
  });

  test("keeps same-title files at distinct available paths", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "editions-"));
    await video(path.join(root, "Arrival (2016).mkv"));
    await video(path.join(root, "Arrival (2016).mp4"));
    const s = await section("MOVIE", root);
    const result = await scanSection({ sectionId: s.id });
    assert.equal(await db.media.count(), 2);
    assert.equal(result.manifest.entries.some((entry) => entry.kind === "identity-collision" && entry.reason?.startsWith("Kept distinct")), true);
  });

  test("recovers a renamed path by reusing only its unavailable row", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "rename-"));
    const oldPath = await video(path.join(root, "Arrival (2016).mkv"));
    const s = await section("MOVIE", root);
    await scanSection({ sectionId: s.id });
    const original = await db.media.findFirstOrThrow();
    const newPath = path.join(root, "Arrival.2016.mkv");
    await fs.rename(oldPath, newPath);
    await scanSection({ sectionId: s.id });
    assert.equal(await db.media.count(), 1);
    assert.equal((await db.media.findFirstOrThrow()).id, original.id);
    assert.equal((await db.media.findFirstOrThrow()).filePath, newPath);
  });

  test("recovers case and punctuation renames after TMDB retitles a row", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "normalized-rename-"));
    const oldPath = await video(path.join(root, "The Movie Name (2020).mkv"));
    const s = await section("MOVIE", root);
    await scanSection({ sectionId: s.id });
    const original = await db.media.findFirstOrThrow();
    await db.media.update({
      where: { id: original.id },
      data: { title: "Official TMDB Retitle", tmdbId: 12345 },
    });
    const newPath = path.join(root, "the-movie_name.2020.mkv");
    await fs.rename(oldPath, newPath);

    await scanSection({ sectionId: s.id });
    const recovered = await db.media.findMany();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].id, original.id);
    assert.equal(recovered[0].filePath, newPath);
    assert.equal(recovered[0].title, "Official TMDB Retitle");
  });

  test("normalized title fallback never conflates distinct live paths", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "normalized-editions-"));
    const firstPath = await video(path.join(root, "Live & Let Die (1973).mkv"));
    const secondPath = await video(path.join(root, "live-and-let-die.1973.mp4"));
    const s = await section("MOVIE", root);
    await scanSection({ sectionId: s.id });
    const before = await db.media.findMany();
    assert.equal(before.length, 2);
    const firstRow = before.find((row) => row.filePath === firstPath);
    const secondRow = before.find((row) => row.filePath === secondPath);
    assert.ok(firstRow);
    assert.ok(secondRow);

    const renamedPath = path.join(root, "LIVE-and-let-die (1973).webm");
    await fs.rename(firstPath, renamedPath);
    await scanSection({ sectionId: s.id });
    const after = await db.media.findMany();
    assert.equal(after.length, 2);
    assert.equal(after.find((row) => row.filePath === renamedPath)?.id, firstRow.id);
    assert.equal(after.find((row) => row.filePath === secondPath)?.id, secondRow.id);
  });

  test("incomplete traversal suppresses all unavailable reconciliation", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "partial-"));
    const folder = path.join(root, "Film (2020)");
    const file = await video(path.join(folder, "Film (2020).mkv"));
    const s = await section("MOVIE", root);
    await scanSection({ sectionId: s.id });
    await fs.rm(file);
    const result = await scanSection({
      sectionId: s.id,
      fileSystem: {
        stat: fs.stat,
        readdir: ((target: string, options?: unknown) => {
          if (path.resolve(target) === path.resolve(folder)) return Promise.reject(Object.assign(new Error("fixture access denied"), { code: "EACCES" }));
          return fs.readdir(target, options as never);
        }) as typeof fs.readdir,
      },
    });
    assert.equal(result.complete, false);
    assert.equal(result.manifest.reconciliationApplied, false);
    assert.equal((await db.media.findFirstOrThrow()).filePath, file);
  });

  test("untraversed movie depth suppresses unavailable reconciliation", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "deep-partial-"));
    const deepFile = await video(path.join(root, "A", "B", "C", "D", "E", "F", "Deep Film (2020).mkv"));
    const s = await section("MOVIE", root);
    const existing = await db.media.create({
      data: {
        type: "MOVIE",
        title: "Deep Film",
        sortTitle: "deep film",
        year: 2020,
        filePath: deepFile,
        sectionId: s.id,
      },
    });

    const result = await scanSection({ sectionId: s.id });
    assert.equal(result.complete, false);
    assert.equal(result.manifest.reconciliationApplied, false);
    assert.equal(result.manifest.entries.some((entry) => entry.kind === "traversal-error" && entry.path.includes(`${path.sep}F`)), true);
    assert.equal((await db.media.findUniqueOrThrow({ where: { id: existing.id } })).filePath, deepFile);
  });

  test("missing episodes retain metadata, subtitles, and watch history", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "tv-"));
    const episodePath = await video(path.join(root, "Example Show", "Season 01", "Example.Show.S01E01.mkv"));
    const s = await section("TV", root);
    await scanSection({ sectionId: s.id });
    const media = await db.media.findFirstOrThrow();
    const episode = await db.episode.findFirstOrThrow();
    await db.episode.update({ where: { id: episode.id }, data: { overview: "Retained metadata" } });
    await db.subtitle.create({ data: { mediaId: media.id, episodeId: episode.id, language: "en", label: "English", format: "srt", filePath: `${episodePath}.srt` } });
    await db.watchProgress.create({ data: { mediaId: media.id, episodeId: episode.id, position: 42, duration: 100 } });
    await fs.rm(episodePath);
    await scanSection({ sectionId: s.id });
    const retained = await db.episode.findUniqueOrThrow({ where: { id: episode.id } });
    assert.equal(retained.filePath, null);
    assert.equal(retained.overview, "Retained metadata");
    assert.equal(await db.subtitle.count({ where: { episodeId: episode.id } }), 1);
    assert.equal(await db.watchProgress.count({ where: { episodeId: episode.id } }), 1);
  });

  test("rescans are idempotent", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "idempotent-"));
    await video(path.join(root, "Moon (2009).mkv"));
    const s = await section("MOVIE", root);
    await scanSection({ sectionId: s.id });
    const first = await db.media.findFirstOrThrow();
    const second = await scanSection({ sectionId: s.id });
    assert.equal(await db.media.count(), 1);
    assert.equal((await db.media.findFirstOrThrow()).id, first.id);
    const { getLastSectionScanResult } = await import("@/lib/scanner");
    assert.deepEqual(getLastSectionScanResult(s.id), second);
  });

  test("unchanged rescans skip embedded probes but still discover new sidecars", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "analysis-cache-"));
    const moviePath = await video(path.join(root, "Moon (2009).mkv"));
    const sidecarPath = path.join(root, "Moon (2009).en.srt");
    const s = await section("MOVIE", root);
    const embeddedFlags: boolean[] = [];
    const discover: NonNullable<Parameters<typeof scanSection>[0]["subtitleDiscovery"]> = async (
      _target,
      _readdir,
      options
    ) => {
      embeddedFlags.push(options?.includeEmbedded !== false);
      const sidecarExists = await fs.stat(sidecarPath).then(() => true).catch(() => false);
      const subtitles = sidecarExists
        ? [{
            filePath: sidecarPath,
            language: "en",
            label: "English",
            format: "srt",
            source: "sidecar",
            streamIndex: null,
            codec: null,
            isDefault: false,
          }]
        : [];
      return {
        subtitles,
        complete: true,
        sidecarComplete: true,
        embeddedComplete: options?.includeEmbedded !== false,
        issues: [],
      };
    };

    await scanSection({ sectionId: s.id, subtitleDiscovery: discover });
    await scanSection({ sectionId: s.id, subtitleDiscovery: discover });
    assert.deepEqual(embeddedFlags, [true, false]);

    await fs.writeFile(sidecarPath, "fixture subtitles");
    await scanSection({ sectionId: s.id, subtitleDiscovery: discover });
    assert.deepEqual(embeddedFlags, [true, false, false]);
    assert.equal(await db.subtitle.count(), 1);
    const subtitleId = (await db.subtitle.findFirstOrThrow()).id;

    const changed = new Date(Date.now() + 2_000);
    await fs.utimes(moviePath, changed, changed);
    await scanSection({ sectionId: s.id, subtitleDiscovery: discover });
    assert.deepEqual(embeddedFlags, [true, false, false, true]);
    assert.equal((await db.subtitle.findFirstOrThrow()).id, subtitleId);
  });

  test("subtitle discovery exposes nested-directory traversal failures", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "subtitle-discovery-"));
    const moviePath = await video(path.join(root, "Moon (2009).mkv"));
    await fs.mkdir(path.join(root, "Subs"));
    const { findSubtitlesForVideo } = await import("@/lib/subtitles");
    const result = await findSubtitlesForVideo(
      moviePath,
      async (target) => {
        if (path.basename(target) === "Subs") {
          throw Object.assign(new Error("fixture access denied"), { code: "EACCES" });
        }
        return fs.readdir(target);
      },
      { includeEmbedded: false }
    );
    assert.equal(result.complete, false);
    assert.equal(result.sidecarComplete, false);
    assert.equal(result.issues.some((issue) => issue.traversal && issue.path.endsWith("Subs")), true);
  });

  test("subtitle discovery does not probe absent nested directories", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "subtitle-probes-"));
    const moviePath = await video(path.join(root, "Moon (2009).mkv"));
    const calls: string[] = [];
    const { findSubtitlesForVideo } = await import("@/lib/subtitles");

    const result = await findSubtitlesForVideo(
      moviePath,
      async (target) => {
        calls.push(target);
        return fs.readdir(target);
      },
      { includeEmbedded: false }
    );

    assert.equal(result.complete, true);
    assert.deepEqual(calls, [root]);
  });

  test("subtitle discovery failures preserve cached rows and explain incomplete traversal", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "subtitle-failure-"));
    const moviePath = await video(path.join(root, "Moon (2009).mkv"));
    const sidecarPath = path.join(root, "Moon (2009).en.srt");
    const s = await section("MOVIE", root);
    const initial: NonNullable<Parameters<typeof scanSection>[0]["subtitleDiscovery"]> = async () => ({
      subtitles: [
        { filePath: sidecarPath, language: "en", label: "English", format: "srt", source: "sidecar", streamIndex: null, codec: null, isDefault: true },
        { filePath: moviePath, language: "ja", label: "Japanese", format: "ass", source: "embedded", streamIndex: 2, codec: "ass", isDefault: false },
      ],
      complete: true,
      sidecarComplete: true,
      embeddedComplete: true,
      issues: [],
    });
    await scanSection({ sectionId: s.id, subtitleDiscovery: initial });
    const cachedIds = (await db.subtitle.findMany({ orderBy: { streamIndex: "asc" } })).map((subtitle) => subtitle.id).sort();

    const failed: NonNullable<Parameters<typeof scanSection>[0]["subtitleDiscovery"]> = async () => ({
      subtitles: [],
      complete: false,
      sidecarComplete: false,
      embeddedComplete: false,
      issues: [
        { source: "sidecar", path: root, message: "fixture access denied", traversal: true },
        { source: "embedded", path: moviePath, message: "fixture ffprobe failed", traversal: false },
      ],
    });
    const result = await scanSection({ sectionId: s.id, subtitleDiscovery: failed });
    assert.equal(result.complete, false);
    assert.equal(result.manifest.reconciliationApplied, false);
    assert.equal(result.manifest.entries.some((entry) => entry.kind === "traversal-error" && entry.path === root), true);
    assert.equal(result.manifest.entries.some((entry) => entry.kind === "unsupported" && entry.reason?.includes("ffprobe")), true);
    assert.deepEqual((await db.subtitle.findMany()).map((subtitle) => subtitle.id).sort(), cachedIds);
  });

  test("serializes overlapping scans for the same section", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "serialized-"));
    await video(path.join(root, "Heat (1995).mkv"));
    const s = await section("MOVIE", root);
    let activeReads = 0;
    let maxActiveReads = 0;
    const delayedReaddir = (async (target: string, options?: unknown) => {
      activeReads++;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try { return await fs.readdir(target, options as never); }
      finally { activeReads--; }
    }) as typeof fs.readdir;
    await Promise.all([
      scanSection({ sectionId: s.id, fileSystem: { stat: fs.stat, readdir: delayedReaddir } }),
      scanSection({ sectionId: s.id, fileSystem: { stat: fs.stat, readdir: delayedReaddir } }),
    ]);
    assert.equal(maxActiveReads, 1);
    assert.equal(await db.media.count(), 1);
  });

  test("leaves an unsafe TMDB candidate unmatched and explains the skipped auto-match", async () => {
    const root = await fs.mkdtemp(path.join(tempRoot, "unsafe-tmdb-"));
    await video(path.join(root, "Run (2020).mkv"));
    const s = await section("MOVIE", root);
    const discover: NonNullable<Parameters<typeof scanSection>[0]["subtitleDiscovery"]> =
      async () => ({
        subtitles: [],
        complete: true,
        sidecarComplete: true,
        embeddedComplete: true,
        issues: [],
      });
    const originalFetch = globalThis.fetch;
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount++;
      return new Response(
        JSON.stringify({
          results: [
            { id: 7443, title: "Chicken Run", release_date: "2000-06-23" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      const result = await scanSection({
        sectionId: s.id,
        tmdbKey: "fixture-key",
        autoMatch: true,
        subtitleDiscovery: discover,
      });
      const row = await db.media.findFirstOrThrow();
      assert.equal(row.title, "Run");
      assert.equal(row.year, 2020);
      assert.equal(row.tmdbId, null);
      assert.equal(requestCount, 1);
      assert.equal(
        result.manifest.entries.some(
          (entry) =>
            entry.kind === "identity-collision" &&
            entry.reason?.includes("TMDB auto-match skipped") &&
            entry.reason.includes("no candidate exactly matched")
        ),
        true
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
