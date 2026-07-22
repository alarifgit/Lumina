import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import type { PrismaClient } from "@prisma/client";
import type { BrowsePreset, WatchState } from "@/lib/types";
import { getRailEdgeState, getRailPageDistance } from "@/lib/rail-state";
import { normalizeFeatureIndex, resolveActiveFeatureIndex } from "@/lib/feature-state";

type MediaQueries = typeof import("@/lib/media-queries");
type PlaybackDiagnostics = typeof import("@/lib/playback-diagnostics");

let tempRoot: string;
let db: PrismaClient;
let mediaQueries: MediaQueries;
let playbackDiagnostics: PlaybackDiagnostics;

describe("horizontal rail geometry", () => {
  test("uses one tolerance for symmetric start and end boundaries", () => {
    assert.deepEqual(getRailEdgeState(0, 1600, 800), {
      canScrollLeft: false,
      canScrollRight: true,
      maxScroll: 800,
    });
    assert.deepEqual(getRailEdgeState(400, 1600, 800), {
      canScrollLeft: true,
      canScrollRight: true,
      maxScroll: 800,
    });
    assert.deepEqual(getRailEdgeState(800, 1600, 800), {
      canScrollLeft: true,
      canScrollRight: false,
      maxScroll: 800,
    });
  });

  test("normalizes overscroll and uses a proportional page distance", () => {
    assert.equal(getRailEdgeState(-20, 1200, 600).canScrollLeft, false);
    assert.equal(getRailEdgeState(700, 1200, 600).canScrollRight, false);
    assert.equal(getRailPageDistance(240), 280);
    assert.equal(getRailPageDistance(1000), 820);
  });
});

describe("Home feature identity", () => {
  test("keeps the active media selected when a refresh reorders the deck", () => {
    assert.equal(resolveActiveFeatureIndex(["a", "b", "c"], "b"), 1);
    assert.equal(resolveActiveFeatureIndex(["b", "c", "a"], "b"), 0);
  });

  test("falls back safely and wraps explicit navigation", () => {
    assert.equal(resolveActiveFeatureIndex(["a", "b"], "missing"), 0);
    assert.equal(resolveActiveFeatureIndex([], "missing"), -1);
    assert.equal(normalizeFeatureIndex(6, -1), 5);
    assert.equal(normalizeFeatureIndex(6, 6), 0);
  });
});

before(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-browse-"));
  const databasePath = path.join(tempRoot, "test.db");
  process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, "/")}`;

  const sqlite = new DatabaseSync(databasePath);
  sqlite.exec(`
    CREATE TABLE Media (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, sortTitle TEXT, filePath TEXT, sourceCreatedAt DATETIME, sourceModifiedAt DATETIME, streamUrl TEXT, tmdbId INTEGER, imdbId TEXT, overview TEXT, tagline TEXT, posterUrl TEXT, backdropUrl TEXT, releaseDate DATETIME, year INTEGER, runtime INTEGER, rating REAL, voteCount INTEGER, status TEXT, certification TEXT, featured INTEGER NOT NULL DEFAULT 0, trending INTEGER NOT NULL DEFAULT 0, popularity REAL NOT NULL DEFAULT 0, sectionId TEXT, category TEXT NOT NULL DEFAULT 'default', createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE Episode (id TEXT PRIMARY KEY, mediaId TEXT NOT NULL, seasonNumber INTEGER NOT NULL, episodeNumber INTEGER NOT NULL, title TEXT NOT NULL, filePath TEXT, sourceCreatedAt DATETIME, sourceModifiedAt DATETIME, streamUrl TEXT, overview TEXT, stillUrl TEXT, airDate DATETIME, runtime INTEGER, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(mediaId, seasonNumber, episodeNumber));
    CREATE TABLE WatchProgress (id TEXT PRIMARY KEY, mediaId TEXT NOT NULL, episodeId TEXT, position REAL NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, hiddenFromContinueWatching INTEGER NOT NULL DEFAULT 0, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE Subtitle (id TEXT PRIMARY KEY, mediaId TEXT NOT NULL, episodeId TEXT, language TEXT NOT NULL DEFAULT 'en', label TEXT NOT NULL, filePath TEXT, streamUrl TEXT, format TEXT NOT NULL DEFAULT 'srt', streamIndex INTEGER, codec TEXT, isDefault INTEGER NOT NULL DEFAULT 0, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE Genre (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
    CREATE TABLE MediaGenre (mediaId TEXT NOT NULL, genreId INTEGER NOT NULL, PRIMARY KEY(mediaId, genreId));
    CREATE TABLE Collection (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE DEFAULT 'my-list', createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE CollectionItem (id TEXT PRIMARY KEY, collectionId TEXT NOT NULL, mediaId TEXT NOT NULL, addedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(collectionId, mediaId));
  `);
  sqlite.close();

  ({ db } = await import("@/lib/db"));
  mediaQueries = await import("@/lib/media-queries");
  playbackDiagnostics = await import("@/lib/playback-diagnostics");
});

beforeEach(async () => {
  await db.collectionItem.deleteMany();
  await db.collection.deleteMany();
  await db.subtitle.deleteMany();
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
  featured?: boolean;
  backdropUrl?: string | null;
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
      featured: input.featured ?? false,
      backdropUrl: input.backdropUrl,
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
  featured?: boolean;
  backdropUrl?: string | null;
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
      featured: input.featured ?? false,
      backdropUrl: input.backdropUrl,
    },
  });
}

async function episode(input: {
  id: string;
  mediaId: string;
  number: number;
  season?: number;
  title?: string;
  available?: boolean;
  airDate?: Date;
  sourceModifiedAt?: Date;
}) {
  return db.episode.create({
    data: {
      id: input.id,
      mediaId: input.mediaId,
      seasonNumber: input.season ?? 1,
      episodeNumber: input.number,
      title: input.title ?? `Episode ${input.number}`,
      filePath: input.available === false ? null : `/media/${input.mediaId}/${input.id}.mkv`,
      airDate: input.airDate,
      sourceModifiedAt: input.sourceModifiedAt,
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
  updatedAt?: Date;
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
      updatedAt: input.updatedAt,
    },
  });
}

describe("browse presets", () => {
  test("keeps recently-added episode context separate from resume state", async () => {
    await show({ id: "recent-show", title: "Recent Show" });
    await episode({
      id: "recent-s1e1",
      mediaId: "recent-show",
      number: 1,
      sourceModifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await episode({
      id: "recent-s2e6",
      mediaId: "recent-show",
      season: 2,
      number: 6,
      title: "Newest file",
      sourceModifiedAt: new Date("2026-07-20T00:00:00.000Z"),
    });
    await progress({
      id: "accidental-s2e6-progress",
      mediaId: "recent-show",
      episodeId: "recent-s2e6",
      position: 29.8,
    });

    const [item] = await mediaQueries.getRecentlyAddedEpisodes(10);

    assert.equal(item.contextEpisodeId, "recent-s2e6");
    assert.equal(item.contextSeason, 2);
    assert.equal(item.contextEpisode, 6);
    assert.equal(item.progressEpisodeId, undefined);
    assert.equal(item.progressPosition, undefined);

    const audit = await playbackDiagnostics.getPlaybackDecisionAudit("recent-show");
    assert.equal(audit?.decision.target?.episodeId, "recent-s1e1");
    assert.equal(audit?.decision.reason, "first-unwatched-regular");
    assert.equal(
      audit?.decision.warnings.some(
        (warning) => warning.code === "noncanonical-progress-ignored"
      ),
      true
    );

    const detail = await mediaQueries.getMediaDetail("recent-show");
    assert.equal(detail?.nextEpisode?.id, "recent-s1e1");
    assert.equal(detail?.playbackDecision?.target?.episodeId, "recent-s1e1");
    assert.equal(detail?.progressEpisodeId, undefined);
    assert.deepEqual(detail?.playableEpisodes?.map((episode) => episode.id), [
      "recent-s1e1",
      "recent-s2e6",
    ]);
  });

  test("builds a stable mixed movie and TV feature deck", async () => {
    for (let index = 1; index <= 4; index++) {
      await movie({
        id: `feature-movie-${index}`,
        popularity: 100 - index,
        featured: index === 1,
        backdropUrl: `/movie-${index}.jpg`,
      });
      await show({
        id: `feature-show-${index}`,
        popularity: 90 - index,
        featured: index === 1,
        backdropUrl: `/show-${index}.jpg`,
      });
      await episode({
        id: `feature-show-${index}-e1`,
        mediaId: `feature-show-${index}`,
        number: 1,
      });
    }

    const first = await mediaQueries.getFeatured(6);
    const second = await mediaQueries.getFeatured(6);

    assert.deepEqual(first.map((item) => item.id), second.map((item) => item.id));
    assert.deepEqual(new Set(first.slice(0, 2).map((item) => item.id)), new Set([
      "feature-movie-1",
      "feature-show-1",
    ]));
    assert.equal(first.filter((item) => item.type === "MOVIE").length, 3);
    assert.equal(first.filter((item) => item.type === "TV").length, 3);
  });

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
    const expectedHomeRows = new Map<BrowsePreset, string[]>();

    for (const [preset, getPreview] of cases) {
      const preview = await getPreview(50);
      expectedHomeRows.set(preset, preview.slice(0, 20).map((item) => item.id));
      const browse = await mediaQueries.browseMedia({ preset, page: 1, pageSize: 50 });
      assert.deepEqual(
        browse.items.map((item) => item.id),
        preview.map((item) => item.id),
        `${preset} should use the same available-media definition and order`,
      );
      assert.equal(browse.items.some((item) => item.id === "movie-unavailable"), false);
    }

    const home = await mediaQueries.getHomeData();
    for (const [preset, expectedIds] of expectedHomeRows) {
      assert.deepEqual(
        home.rows.find((row) => row.key === preset)?.items.map((item) => item.id),
        expectedIds,
        `${preset} should retain its shelf order when Home hydrates all rows in one batch`,
      );
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

  test("Continue Watching rejects progress owned by a different show", async () => {
    await show({ id: "tv-owner" });
    await episode({ id: "tv-owner-e1", mediaId: "tv-owner", number: 1 });
    await show({ id: "tv-foreign" });
    await episode({ id: "tv-foreign-e1", mediaId: "tv-foreign", number: 1 });
    await progress({
      id: "cross-show-progress",
      mediaId: "tv-owner",
      episodeId: "tv-foreign-e1",
      position: 120,
    });
    await show({ id: "tv-completed-owner" });
    await episode({
      id: "tv-completed-owner-e1",
      mediaId: "tv-completed-owner",
      number: 1,
    });
    await show({ id: "tv-completed-foreign" });
    await episode({
      id: "tv-completed-foreign-e1",
      mediaId: "tv-completed-foreign",
      number: 1,
    });
    await progress({
      id: "cross-show-completed",
      mediaId: "tv-completed-owner",
      episodeId: "tv-completed-foreign-e1",
      completed: true,
    });

    const items = await mediaQueries.getContinueWatching(20);
    assert.ok(!items.some((item) => item.id === "tv-owner"));
    assert.ok(!items.some((item) => item.id === "tv-foreign"));
    assert.ok(!items.some((item) => item.id === "tv-completed-owner"));
    assert.ok(!items.some((item) => item.id === "tv-completed-foreign"));

    await assert.rejects(
      mediaQueries.saveProgress({
        mediaId: "tv-owner",
        episodeId: "tv-foreign-e1",
        position: 180,
        duration: 1_000,
      }),
      (error: unknown) =>
        error instanceof mediaQueries.InvalidProgressTargetError
    );
    assert.equal(
      await db.watchProgress.count({
        where: {
          id: { notIn: ["cross-show-progress", "cross-show-completed"] },
        },
      }),
      0
    );
  });

  test("Continue Watching fills an earlier unwatched gap instead of advancing from the latest history row", async () => {
    await show({ id: "tv-out-of-order" });
    await episode({ id: "tv-out-of-order-e1", mediaId: "tv-out-of-order", number: 1 });
    await episode({ id: "tv-out-of-order-e2", mediaId: "tv-out-of-order", number: 2 });
    await episode({ id: "tv-out-of-order-e3", mediaId: "tv-out-of-order", number: 3 });
    await progress({
      id: "tv-out-of-order-p3",
      mediaId: "tv-out-of-order",
      episodeId: "tv-out-of-order-e3",
      completed: true,
    });

    const items = await mediaQueries.getContinueWatching(20);
    const candidate = items.find((item) => item.id === "tv-out-of-order");
    assert.equal(candidate?.progressEpisodeId, "tv-out-of-order-e1");
    assert.equal(candidate?.progressPosition, 0);
  });

  test("keeps a locally present future-dated next episode eligible", async () => {
    await show({ id: "tv-future-local" });
    await episode({
      id: "tv-future-local-e1",
      mediaId: "tv-future-local",
      number: 1,
      airDate: new Date("2026-07-01T00:00:00.000Z"),
    });
    await episode({
      id: "tv-future-local-e2",
      mediaId: "tv-future-local",
      number: 2,
      airDate: new Date("2026-08-01T00:00:00.000Z"),
    });
    await progress({
      id: "tv-future-local-p1",
      mediaId: "tv-future-local",
      episodeId: "tv-future-local-e1",
      completed: true,
    });

    const items = await mediaQueries.getContinueWatching(20);
    const candidate = items.find((item) => item.id === "tv-future-local");
    assert.equal(candidate?.progressEpisodeId, "tv-future-local-e2");
  });

  test("newer completed duplicates cannot resurrect older resume rows", async () => {
    await movie({ id: "movie-duplicate" });
    await progress({
      id: "movie-duplicate-old",
      mediaId: "movie-duplicate",
      position: 240,
      updatedAt: new Date("2026-07-19T10:00:00.000Z"),
    });
    await progress({
      id: "movie-duplicate-new",
      mediaId: "movie-duplicate",
      completed: true,
      updatedAt: new Date("2026-07-20T10:00:00.000Z"),
    });

    await show({ id: "tv-duplicate" });
    await episode({ id: "tv-duplicate-e1", mediaId: "tv-duplicate", number: 1 });
    await progress({
      id: "tv-duplicate-old",
      mediaId: "tv-duplicate",
      episodeId: "tv-duplicate-e1",
      position: 180,
      updatedAt: new Date("2026-07-19T10:00:00.000Z"),
    });
    await progress({
      id: "tv-duplicate-new",
      mediaId: "tv-duplicate",
      episodeId: "tv-duplicate-e1",
      completed: true,
      updatedAt: new Date("2026-07-20T10:00:00.000Z"),
    });

    const items = await mediaQueries.getContinueWatching(20);
    assert.ok(!items.some((item) => item.id === "movie-duplicate"));
    assert.ok(!items.some((item) => item.id === "tv-duplicate"));

    const movieDetail = await mediaQueries.getMediaDetail("movie-duplicate");
    assert.equal(movieDetail?.progressPosition, undefined);
    const showDetail = await mediaQueries.getMediaDetail("tv-duplicate");
    assert.equal(showDetail?.progressPosition, undefined);
    assert.equal(showDetail?.playbackDecision?.reason, "restart-first-regular");
  });

  test("newer unwatched duplicates supersede older completion when choosing next up", async () => {
    await show({ id: "tv-reset-duplicate" });
    await episode({ id: "tv-reset-duplicate-e1", mediaId: "tv-reset-duplicate", number: 1 });
    await episode({ id: "tv-reset-duplicate-e2", mediaId: "tv-reset-duplicate", number: 2 });
    await progress({
      id: "tv-reset-completed-old",
      mediaId: "tv-reset-duplicate",
      episodeId: "tv-reset-duplicate-e1",
      completed: true,
      updatedAt: new Date("2026-07-19T10:00:00.000Z"),
    });
    await progress({
      id: "tv-reset-unwatched-new",
      mediaId: "tv-reset-duplicate",
      episodeId: "tv-reset-duplicate-e1",
      position: 0,
      updatedAt: new Date("2026-07-20T10:00:00.000Z"),
    });

    const items = await mediaQueries.getContinueWatching(20);
    const candidate = items.find((item) => item.id === "tv-reset-duplicate");
    assert.equal(candidate?.progressEpisodeId, "tv-reset-duplicate-e1");
    assert.equal(candidate?.progressPosition, 0);

    const detail = await mediaQueries.getMediaDetail("tv-reset-duplicate");
    assert.equal(detail?.playbackDecision?.target?.episodeId, "tv-reset-duplicate-e1");
    assert.equal(detail?.playbackDecision?.reason, "first-unwatched-regular");
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
