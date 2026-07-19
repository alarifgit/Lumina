import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PrismaClient } from "@prisma/client";
import type { searchMedia as SearchMedia } from "@/lib/media-queries";

let tempRoot: string;
let db: PrismaClient;
let searchMedia: typeof SearchMedia;

before(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-search-"));
  const databasePath = path.join(tempRoot, "test.db");
  process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, "/")}`;
  const sqlite = new DatabaseSync(databasePath);
  sqlite.exec(`
    CREATE TABLE Media (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, sortTitle TEXT, filePath TEXT, sourceCreatedAt DATETIME, sourceModifiedAt DATETIME, streamUrl TEXT, tmdbId INTEGER, imdbId TEXT, overview TEXT, tagline TEXT, posterUrl TEXT, backdropUrl TEXT, releaseDate DATETIME, year INTEGER, runtime INTEGER, rating REAL, voteCount INTEGER, status TEXT, certification TEXT, featured INTEGER NOT NULL DEFAULT 0, trending INTEGER NOT NULL DEFAULT 0, popularity REAL NOT NULL DEFAULT 0, sectionId TEXT, category TEXT NOT NULL DEFAULT 'default', createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE UNIQUE INDEX Media_type_tmdbId_key ON Media(type, tmdbId);
    CREATE TABLE Episode (id TEXT PRIMARY KEY, mediaId TEXT NOT NULL, seasonNumber INTEGER NOT NULL, episodeNumber INTEGER NOT NULL, title TEXT NOT NULL, filePath TEXT, sourceCreatedAt DATETIME, sourceModifiedAt DATETIME, streamUrl TEXT, overview TEXT, stillUrl TEXT, airDate DATETIME, runtime INTEGER, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(mediaId, seasonNumber, episodeNumber));
    CREATE TABLE WatchProgress (id TEXT PRIMARY KEY, mediaId TEXT NOT NULL, episodeId TEXT, position REAL NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, hiddenFromContinueWatching INTEGER NOT NULL DEFAULT 0, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE Genre (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
    CREATE TABLE MediaGenre (mediaId TEXT NOT NULL, genreId INTEGER NOT NULL, PRIMARY KEY(mediaId, genreId));
    CREATE TABLE Collection (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE DEFAULT 'my-list', createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE CollectionItem (id TEXT PRIMARY KEY, collectionId TEXT NOT NULL, mediaId TEXT NOT NULL, addedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(collectionId, mediaId));
  `);
  sqlite.close();
  ({ db } = await import("@/lib/db"));
  ({ searchMedia } = await import("@/lib/media-queries"));
});

beforeEach(async () => {
  await db.collectionItem.deleteMany();
  await db.collection.deleteMany();
  await db.mediaGenre.deleteMany();
  await db.genre.deleteMany();
  await db.watchProgress.deleteMany();
  await db.episode.deleteMany();
  await db.media.deleteMany();
});

after(async () => {
  await db?.$disconnect();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("grouped library search", () => {
  test("returns one stable empty contract for a blank query", async () => {
    assert.deepEqual(await searchMedia("   "), {
      query: "   ",
      groups: {
        movies: { items: [], total: 0 },
        shows: { items: [], total: 0 },
        episodes: { items: [], total: 0 },
      },
      total: 0,
    });
  });

  test("groups only playable matches and keeps totals independent of the cap", async () => {
    await db.media.createMany({
      data: [
        {
          id: "movie-file",
          type: "MOVIE",
          title: "Signal Fire",
          filePath: "/movies/signal-fire.mkv",
          popularity: 5,
        },
        {
          id: "movie-stream",
          type: "MOVIE",
          title: "The Signal",
          streamUrl: "https://example.test/signal.m3u8",
          popularity: 10,
        },
        {
          id: "movie-unavailable",
          type: "MOVIE",
          title: "Signal Lost",
          popularity: 100,
        },
        {
          id: "show-playable",
          type: "TV",
          title: "Signal House",
          filePath: "/tv/signal-house",
          popularity: 8,
        },
        {
          id: "show-root-only",
          type: "TV",
          title: "Signal Archive",
          filePath: "/tv/signal-archive",
          popularity: 99,
        },
        {
          id: "show-episode-match",
          type: "TV",
          title: "Orbital",
          popularity: 7,
        },
      ],
    });
    await db.episode.createMany({
      data: [
        {
          id: "episode-show-match",
          mediaId: "show-playable",
          seasonNumber: 1,
          episodeNumber: 1,
          title: "Arrival",
          filePath: "/tv/signal-house/s01e01.mkv",
        },
        {
          id: "episode-title-match",
          mediaId: "show-episode-match",
          seasonNumber: 1,
          episodeNumber: 2,
          title: "The Signal",
          filePath: "/tv/orbital/s01e02.mkv",
        },
        {
          id: "episode-unavailable",
          mediaId: "show-episode-match",
          seasonNumber: 1,
          episodeNumber: 3,
          title: "Signal Lost",
        },
      ],
    });

    const result = await searchMedia("Signal", 1);

    assert.equal(result.groups.movies.items.length, 1);
    assert.equal(result.groups.movies.items[0]?.id, "movie-stream");
    assert.equal(result.groups.movies.total, 2);
    assert.equal(result.groups.shows.items.length, 1);
    assert.equal(result.groups.shows.items[0]?.id, "show-playable");
    assert.equal(result.groups.shows.total, 1);
    assert.equal(result.groups.episodes.items.length, 1);
    assert.equal(result.groups.episodes.items[0]?.id, "episode-title-match");
    assert.equal(result.groups.episodes.total, 2);
    assert.equal(result.total, 5);
  });

  test("serializes exact episode playback context and latest progress", async () => {
    await db.media.create({
      data: {
        id: "night-sky",
        type: "TV",
        title: "Night Sky",
        posterUrl: "https://image.test/night-sky-poster.jpg",
        backdropUrl: "https://image.test/night-sky-backdrop.jpg",
        year: 2022,
      },
    });
    await db.episode.create({
      data: {
        id: "night-sky-s01e02",
        mediaId: "night-sky",
        seasonNumber: 1,
        episodeNumber: 2,
        title: "The Signal",
        overview: "A signal arrives.",
        stillUrl: "https://image.test/night-sky-still.jpg",
        airDate: new Date("2022-05-20T00:00:00.000Z"),
        runtime: 54,
        filePath: "/tv/night-sky/s01e02.mkv",
      },
    });
    await db.watchProgress.createMany({
      data: [
        {
          id: "progress-old",
          mediaId: "night-sky",
          episodeId: "night-sky-s01e02",
          position: 120,
          duration: 3_000,
          updatedAt: new Date("2026-07-12T10:00:00.000Z"),
        },
        {
          id: "progress-latest",
          mediaId: "night-sky",
          episodeId: "night-sky-s01e02",
          position: 1_500,
          duration: 3_000,
          completed: true,
          updatedAt: new Date("2026-07-13T10:00:00.000Z"),
        },
      ],
    });

    const result = await searchMedia("signal");
    const episode = result.groups.episodes.items[0];

    assert.equal(result.groups.episodes.total, 1);
    assert.deepEqual(episode, {
      type: "EPISODE",
      id: "night-sky-s01e02",
      mediaId: "night-sky",
      showTitle: "Night Sky",
      title: "The Signal",
      seasonNumber: 1,
      episodeNumber: 2,
      stillUrl: "https://image.test/night-sky-still.jpg",
      posterUrl: "https://image.test/night-sky-poster.jpg",
      backdropUrl: "https://image.test/night-sky-backdrop.jpg",
      overview: "A signal arrives.",
      airDate: "2022-05-20T00:00:00.000Z",
      year: 2022,
      runtime: 54,
      progressPercent: 50,
      progressPosition: 1_500,
      progressDuration: 3_000,
      completed: true,
    });
  });
});
