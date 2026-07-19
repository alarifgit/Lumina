import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import type { PrismaClient } from "@prisma/client";
import type { BrowsePreset, WatchState } from "@/lib/types";

type MediaQueries = typeof import("@/lib/media-queries");

let tempRoot: string;
let db: PrismaClient;
let mediaQueries: MediaQueries;

before(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-browse-"));
  const databasePath = path.join(tempRoot, "test.db");
  process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, "/")}`;

  const sqlite = new DatabaseSync(databasePath);
  sqlite.exec(`
    CREATE TABLE Media (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, sortTitle TEXT, filePath TEXT, sourceCreatedAt DATETIME, sourceModifiedAt DATETIME, streamUrl TEXT, tmdbId INTEGER, imdbId TEXT, overview TEXT, tagline TEXT, posterUrl TEXT, backdropUrl TEXT, releaseDate DATETIME, year INTEGER, runtime INTEGER, rating REAL, voteCount INTEGER, status TEXT, certification TEXT, featured INTEGER NOT NULL DEFAULT 0, trending INTEGER NOT NULL DEFAULT 0, popularity REAL NOT NULL DEFAULT 0, sectionId TEXT, category TEXT NOT NULL DEFAULT 'default', createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE Episode (id TEXT PRIMARY KEY, mediaId TEXT NOT NULL, seasonNumber INTEGER NOT NULL, episodeNumber INTEGER NOT NULL, title TEXT NOT NULL, filePath TEXT, sourceCreatedAt DATETIME, sourceModifiedAt DATETIME, streamUrl TEXT, overview TEXT, stillUrl TEXT, airDate DATETIME, runtime INTEGER, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(mediaId, seasonNumber, episodeNumber));
    CREATE TABLE WatchProgress (id TEXT PRIMARY KEY, mediaId TEXT NOT NULL, episodeId TEXT, position REAL NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, hiddenFromContinueWatching INTEGER NOT NULL DEFAULT 0, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE Genre (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
    CREATE TABLE MediaGenre (mediaId TEXT NOT NULL, genreId INTEGER NOT NULL, PRIMARY KEY(mediaId, genreId));
    CREATE TABLE Collection (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE DEFAULT 'my-list', createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE CollectionItem (id TEXT PRIMARY KEY, collectionId TEXT NOT NULL, mediaId TEXT NOT NULL, addedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(collectionId, mediaId));
  `);
  sqlite.close();

  ({ db } = await import("@/lib/db"));
  mediaQueries = await import("@/lib/media-queries");
});

beforeEach(async () => {
  await db.collectionItem.deleteMany();
  await db.collection.deleteMany();
  await db.watchProgress.deleteMany();
  await db.episode.deleteMany();
  await db.mediaGenre.deleteMany();
  await db.genre.deleteMany();
  await db.media.deleteMany();
});

after(async () => {
  await db?.$disconnect();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

async function movie(input: {
  id: string;
  title?: string;
  filePath?: string | null;
  category?: string;
  popularity?: number;
  rating?: number | null;
  year?: number | null;
  trending?: boolean;
  sourceModifiedAt?: Date;
  createdAt?: Date;
}) {
  return db.media.create({
    data: {
      id: input.id,
      type: "MOVIE",
      title: input.title ?? input.id,
      sortTitle: (input.title ?? input.id).toLowerCase(),
      filePath: input.filePath === undefined ? `/media/${input.id}.mkv` : input.filePath,
      category: input.category ?? "default",
      popularity: input.popularity ?? 0,
      rating: input.rating,
      year: input.year,
      trending: input.trending ?? false,
      sourceModifiedAt: input.sourceModifiedAt,
      createdAt: input.createdAt,
    },
  });
}

async function show(input: {
  id: string;
  title?: string;
  popularity?: number;
  rating?: number | null;
  year?: number | null;
  trending?: boolean;
}) {
  return db.media.create({
    data: {
      id: input.id,
      type: "TV",
      title: input.title ?? input.id,
      sortTitle: (input.title ?? input.id).toLowerCase(),
      filePath: `/media/${input.id}`,
      popularity: input.popularity ?? 0,
      rating: input.rating,
      year: input.year,
      trending: input.trending ?? false,
    },
  });
}

async function episode(input: {
  id: string;
  mediaId: string;
  number: number;
  available?: boolean;
}) {
  return db.episode.create({
    data: {
      id: input.id,
      mediaId: input.mediaId,
      seasonNumber: 1,
      episodeNumber: input.number,
      title: `Episode ${input.number}`,
      filePath: input.available === false ? null : `/media/${input.mediaId}/${input.id}.mkv`,
    },
  });
}

async function progress(input: {
  id: string;
  mediaId: string;
  episodeId?: string;
  position?: number;
  completed?: boolean;
  hidden?: boolean;
}) {
  return db.watchProgress.create({
    data: {
      id: input.id,
      mediaId: input.mediaId,
      episodeId: input.episodeId,
      position: input.position ?? 0,
      duration: 1000,
      completed: input.completed ?? false,
      hiddenFromContinueWatching: input.hidden ?? false,
    },
  });
}

describe("browse presets", () => {
  test("matches Home shelf order and excludes unavailable rows", async () => {
    const newest = new Date("2026-06-01T00:00:00.000Z");
    const older = new Date("2025-06-01T00:00:00.000Z");
    await movie({ id: "movie-new", title: "New Arrival", popularity: 10, rating: 8, year: 2026, sourceModifiedAt: newest });
    await movie({ id: "movie-trending", title: "Trending Film", popularity: 5, rating: 9, year: 2024, trending: true, sourceModifiedAt: older });
    await movie({ id: "movie-popular", title: "Popular Film", popularity: 99, rating: 7, year: 2020, sourceModifiedAt: older });
    await movie({ id: "movie-unavailable", title: "Unavailable Film", filePath: null, popularity: 999, rating: 10, year: 2027, trending: true, sourceModifiedAt: new Date("2027-01-01T00:00:00.000Z") });
    await show({ id: "tv-popular", title: "Popular Series", popularity: 80, rating: 8.5, year: 2025, trending: true });
    await episode({ id: "tv-popular-e1", mediaId: "tv-popular", number: 1 });

    const cases: Array<[BrowsePreset, (limit: number) => Promise<Array<{ id: string }>>]> = [
      ["recently-added-movies", mediaQueries.getRecentlyAddedMovies],
      ["trending", mediaQueries.getTrending],
      ["popular-movies", mediaQueries.getPopularMovies],
      ["popular-tv", mediaQueries.getPopularTV],
      ["top-rated", mediaQueries.getTopRated],
      ["new-releases", mediaQueries.getNewReleases],
    ];

    for (const [preset, getPreview] of cases) {
      const preview = await getPreview(50);
      const browse = await mediaQueries.browseMedia({ preset, page: 1, pageSize: 50 });
      assert.deepEqual(
        browse.items.map((item) => item.id),
        preview.map((item) => item.id),
        `${preset} should use the same available-media definition and order`,
      );
      assert.equal(browse.items.some((item) => item.id === "movie-unavailable"), false);
    }
  });

  test("uses stable tie-breakers across pages and lets explicit sort override shelf order", async () => {
    for (const id of ["tie-c", "tie-a", "tie-e", "tie-b", "tie-d"]) {
      await movie({ id, title: "Same Title", popularity: 10, year: 2020 });
    }

    const first = await mediaQueries.browseMedia({ preset: "popular-movies", page: 1, pageSize: 2 });
    const second = await mediaQueries.browseMedia({ preset: "popular-movies", page: 2, pageSize: 2 });
    const third = await mediaQueries.browseMedia({ preset: "popular-movies", page: 3, pageSize: 2 });
    assert.deepEqual(
      [...first.items, ...second.items, ...third.items].map((item) => item.id),
      ["tie-a", "tie-b", "tie-c", "tie-d", "tie-e"],
    );

    await movie({ id: "older-popular", title: "Older Popular", popularity: 100, year: 1990 });
    await movie({ id: "newer-quiet", title: "Newer Quiet", popularity: 1, year: 2026 });
    const shelfOrder = await mediaQueries.browseMedia({ preset: "popular-movies", page: 1, pageSize: 20 });
    const explicitYear = await mediaQueries.browseMedia({ preset: "popular-movies", sort: "year", page: 1, pageSize: 20 });
    assert.equal(shelfOrder.items[0]?.id, "older-popular");
    assert.equal(explicitYear.items[0]?.id, "newer-quiet");
  });
});

describe("watch-state browsing", () => {
  test("keeps movie and full-series TV states disjoint", async () => {
    await movie({ id: "movie-unwatched" });
    await movie({ id: "movie-sentinel" });
    await progress({ id: "progress-sentinel", mediaId: "movie-sentinel", position: 0, hidden: true });
    await movie({ id: "movie-progress" });
    await progress({ id: "progress-movie", mediaId: "movie-progress", position: 120 });
    await movie({ id: "movie-watched" });
    await progress({ id: "watched-movie", mediaId: "movie-watched", completed: true });

    await show({ id: "tv-unwatched" });
    await episode({ id: "tv-unwatched-e1", mediaId: "tv-unwatched", number: 1 });
    await episode({ id: "tv-unwatched-e2", mediaId: "tv-unwatched", number: 2 });

    await show({ id: "tv-progress" });
    await episode({ id: "tv-progress-e1", mediaId: "tv-progress", number: 1 });
    await episode({ id: "tv-progress-e2", mediaId: "tv-progress", number: 2 });
    await progress({ id: "tv-progress-p1", mediaId: "tv-progress", episodeId: "tv-progress-e1", completed: true });

    await show({ id: "tv-position" });
    await episode({ id: "tv-position-e1", mediaId: "tv-position", number: 1 });
    await episode({ id: "tv-position-e2", mediaId: "tv-position", number: 2 });
    await progress({ id: "tv-position-p1", mediaId: "tv-position", episodeId: "tv-position-e1", position: 120 });

    await show({ id: "tv-watched" });
    await episode({ id: "tv-watched-e1", mediaId: "tv-watched", number: 1 });
    await episode({ id: "tv-watched-e2", mediaId: "tv-watched", number: 2 });
    await progress({ id: "tv-watched-p1", mediaId: "tv-watched", episodeId: "tv-watched-e1", completed: true });
    await progress({ id: "tv-watched-p2", mediaId: "tv-watched", episodeId: "tv-watched-e2", completed: true });

    await show({ id: "tv-local-watched" });
    await episode({ id: "tv-local-watched-e1", mediaId: "tv-local-watched", number: 1 });
    await episode({ id: "tv-local-watched-e2", mediaId: "tv-local-watched", number: 2, available: false });
    await progress({ id: "tv-local-watched-p1", mediaId: "tv-local-watched", episodeId: "tv-local-watched-e1", completed: true });

    await show({ id: "tv-unavailable-history" });
    await episode({ id: "tv-unavailable-history-e1", mediaId: "tv-unavailable-history", number: 1 });
    await episode({ id: "tv-unavailable-history-e2", mediaId: "tv-unavailable-history", number: 2, available: false });
    await progress({ id: "tv-unavailable-history-p2", mediaId: "tv-unavailable-history", episodeId: "tv-unavailable-history-e2", completed: true });

    const idsFor = async (watchState: WatchState) => {
      const result = await mediaQueries.browseMedia({ watchState, sort: "title", page: 1, pageSize: 100 });
      return result.items.map((item) => item.id).sort();
    };

    assert.deepEqual(await idsFor("unwatched"), ["movie-sentinel", "movie-unwatched", "tv-unwatched"]);
    assert.deepEqual(await idsFor("in-progress"), ["movie-progress", "tv-position", "tv-progress", "tv-unavailable-history"]);
    assert.deepEqual(await idsFor("watched"), ["movie-watched", "tv-local-watched", "tv-watched"]);
  });

  test("Continue Watching only returns the exact playable progress target", async () => {
    await movie({ id: "movie-playable" });
    await progress({ id: "movie-playable-p", mediaId: "movie-playable", position: 120 });

    await movie({ id: "movie-missing", filePath: null });
    await progress({ id: "movie-missing-p", mediaId: "movie-missing", position: 120 });

    await movie({ id: "movie-zero" });
    await progress({ id: "movie-zero-p", mediaId: "movie-zero", position: 0 });

    await movie({ id: "movie-complete" });
    await progress({ id: "movie-complete-p", mediaId: "movie-complete", completed: true });

    await show({ id: "tv-playable" });
    await episode({ id: "tv-playable-e1", mediaId: "tv-playable", number: 1 });
    await progress({
      id: "tv-playable-p",
      mediaId: "tv-playable",
      episodeId: "tv-playable-e1",
      position: 240,
    });

    await show({ id: "tv-missing-target" });
    await episode({
      id: "tv-missing-target-e1",
      mediaId: "tv-missing-target",
      number: 1,
      available: false,
    });
    await episode({ id: "tv-missing-target-e2", mediaId: "tv-missing-target", number: 2 });
    await progress({
      id: "tv-missing-target-p",
      mediaId: "tv-missing-target",
      episodeId: "tv-missing-target-e1",
      position: 240,
    });

    const items = await mediaQueries.getContinueWatching(20);
    assert.deepEqual(
      items.map((item) => item.id).sort(),
      ["movie-playable", "tv-playable"]
    );
    assert.equal(items.find((item) => item.id === "tv-playable")?.progressEpisodeId, "tv-playable-e1");

    const browse = await mediaQueries.browseMedia({ sort: "title", page: 1, pageSize: 20 });
    assert.equal(browse.items.find((item) => item.id === "movie-playable")?.progressPosition, 120);
    assert.equal(browse.items.find((item) => item.id === "movie-zero")?.progressPosition, undefined);
    assert.equal(browse.items.find((item) => item.id === "movie-complete")?.progressPosition, undefined);
    assert.equal(browse.items.find((item) => item.id === "tv-playable")?.progressEpisodeId, "tv-playable-e1");
    assert.equal(
      browse.items.find((item) => item.id === "tv-missing-target")?.progressEpisodeId,
      undefined
    );
  });
});

describe("browse category filtering", () => {
  test("keeps section categories isolated", async () => {
    await movie({ id: "default-movie", category: "default" });
    await movie({ id: "anime-movie", category: "anime" });

    const data = await mediaQueries.browseMedia({
      category: "anime",
      page: 1,
      pageSize: 20,
    });
    assert.deepEqual(data.items.map((item) => item.id), ["anime-movie"]);
  });
});
