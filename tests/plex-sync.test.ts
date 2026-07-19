import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PrismaClient } from "@prisma/client";
import type { syncPlexWatched as SyncPlexWatched } from "@/lib/plex-sync";

let tempRoot: string;
let db: PrismaClient;
let syncPlexWatched: typeof SyncPlexWatched;
let originalFetch: typeof globalThis.fetch;

before(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-plex-sync-"));
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
  `);
  sqlite.close();
  ({ db } = await import("@/lib/db"));
  ({ syncPlexWatched } = await import("@/lib/plex-sync"));
  originalFetch = globalThis.fetch;
});

beforeEach(async () => {
  globalThis.fetch = originalFetch;
  await db.watchProgress.deleteMany();
  await db.episode.deleteMany();
  await db.media.deleteMany();
  await db.librarySection.deleteMany();
  await db.libraryConfig.deleteMany();
  await db.libraryConfig.create({
    data: {
      id: "default",
      mediaDir: "",
      plexUrl: "https://plex.fixture",
      plexToken: "fixture-token",
      plexSyncDirection: "pull",
    },
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

after(async () => {
  globalThis.fetch = originalFetch;
  await db?.$disconnect();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

type PlexFixtureOptions = {
  sectionType?: "show" | "movie";
  episodes?: Record<string, unknown>[];
  parents?: Record<string, unknown>[];
  movies?: Record<string, unknown>[];
  parentFailure?: boolean;
  parentXml?: string;
  requestedTypes?: string[];
  scrobbledKeys?: string[];
};

function plexLibraryFixture({
  sectionType = "show",
  episodes = [],
  parents = [],
  movies = [],
  parentFailure = false,
  parentXml,
  requestedTypes,
  scrobbledKeys,
}: PlexFixtureOptions) {
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    );
    if (url.pathname === "/identity") {
      return Response.json({ MediaContainer: { friendlyName: "Fixture Plex" } });
    }
    if (url.pathname === "/library/sections") {
      return Response.json({
        MediaContainer: {
          Directory: [{ key: "7", title: sectionType === "show" ? "TV" : "Movies", type: sectionType }],
        },
      });
    }
    if (url.pathname === "/library/sections/7/all") {
      const type = url.searchParams.get("type") ?? "";
      requestedTypes?.push(type);
      if (type === "2") {
        if (parentFailure) return new Response("parent inventory failed", { status: 503 });
        if (parentXml) return new Response(parentXml, { headers: { "content-type": "application/xml" } });
        return Response.json({ MediaContainer: { Metadata: parents } });
      }
      if (type === "4") return Response.json({ MediaContainer: { Metadata: episodes } });
      return Response.json({ MediaContainer: { Metadata: movies } });
    }
    if (url.pathname === "/:/scrobble") {
      const key = url.searchParams.get("key");
      if (key) scrobbledKeys?.push(key);
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  };
}

function plexFixture(
  metadata: Record<string, unknown>,
  sectionType: "show" | "movie" = "show"
) {
  plexLibraryFixture(
    sectionType === "show"
      ? { sectionType, episodes: [metadata] }
      : { sectionType, movies: [metadata] }
  );
}

async function createShow(input: {
  id: string;
  title: string;
  year?: number;
  tmdbId?: number;
  imdbId?: string;
  sortTitle?: string;
  filePath: string;
  episodes: Array<{ seasonNumber: number; episodeNumber: number }>;
}) {
  await db.media.create({
    data: {
      id: input.id,
      type: "TV",
      title: input.title,
      year: input.year,
      tmdbId: input.tmdbId,
      imdbId: input.imdbId,
      sortTitle: input.sortTitle,
      filePath: input.filePath,
      episodes: {
        create: input.episodes.map((episode) => ({
          id: `${input.id}-s${episode.seasonNumber}e${episode.episodeNumber}`,
          ...episode,
          title: `Episode ${episode.episodeNumber}`,
          filePath: `${input.filePath}/S${episode.seasonNumber}E${episode.episodeNumber}.mkv`,
        })),
      },
    },
  });
}

describe("Plex watched-sync identity matching", () => {
  test("matches year-suffixed Plex show titles to the exact local episode", async () => {
    await db.media.create({
      data: {
        id: "animal-kingdom",
        type: "TV",
        title: "Animal Kingdom",
        year: 2016,
        tmdbId: 66025,
        filePath: "/media/tv/Animal Kingdom (2016)",
      },
    });
    await db.episode.create({
      data: {
        id: "animal-kingdom-s01e01",
        mediaId: "animal-kingdom",
        seasonNumber: 1,
        episodeNumber: 1,
        title: "Pilot",
        filePath: "/media/tv/Animal Kingdom (2016)/Season 1/S01E01.mkv",
      },
    });

    // Episode GUIDs are not show IDs. This deliberately collides with another
    // local show's TMDB ID to prove the parent title still resolves correctly.
    await db.media.create({
      data: {
        id: "unrelated-show",
        type: "TV",
        title: "Unrelated Show",
        year: 2020,
        tmdbId: 999999,
        filePath: "/media/tv/Unrelated Show (2020)",
      },
    });
    plexFixture({
      type: "episode",
      ratingKey: "plex-episode-1",
      title: "Pilot",
      grandparentTitle: "Animal Kingdom (2016)",
      grandparentGuid: "plex://show/animal-kingdom",
      Guid: [{ id: "tmdb://999999" }],
      year: 2017,
      parentIndex: 1,
      index: 1,
      duration: 2_700_000,
      viewCount: 1,
    });

    const result = await syncPlexWatched({ apply: false });

    assert.equal(result.scanned, 1);
    assert.equal(result.matched, 1);
    assert.equal(result.unmatched, 0);
    assert.equal(result.markedLuminaWatched, 1);
    assert.equal(result.items[0]?.title, "Animal Kingdom (2016)");
    assert.equal(result.items[0]?.seasonNumber, 1);
    assert.equal(result.items[0]?.episodeNumber, 1);
    assert.equal(result.items[0]?.action, "mark-lumina-watched");
  });

  test("refuses an ambiguous normalized show title and year", async () => {
    for (const id of ["shared-show-a", "shared-show-b"]) {
      await db.media.create({
        data: {
          id,
          type: "TV",
          title: "Shared Show",
          year: 2020,
          filePath: `/media/tv/${id}`,
        },
      });
      await db.episode.create({
        data: {
          id: `${id}-s01e01`,
          mediaId: id,
          seasonNumber: 1,
          episodeNumber: 1,
          title: "Pilot",
          filePath: `/media/tv/${id}/S01E01.mkv`,
        },
      });
    }
    plexFixture({
      type: "episode",
      ratingKey: "plex-shared-episode",
      title: "Pilot",
      grandparentTitle: "Shared Show",
      year: 2020,
      parentIndex: 1,
      index: 1,
      duration: 2_700_000,
      viewCount: 1,
    });

    const result = await syncPlexWatched({ apply: false });

    assert.equal(result.scanned, 1);
    assert.equal(result.matched, 0);
    assert.equal(result.unmatched, 1);
    assert.equal(result.markedLuminaWatched, 0);
    assert.equal(result.items[0]?.action, "unmatched");
  });

  test("refuses an ambiguous title-only fallback when Plex has no show year", async () => {
    for (const year of [2019, 2020]) {
      const id = `shared-show-${year}`;
      await db.media.create({
        data: {
          id,
          type: "TV",
          title: "Shared Show",
          year,
          filePath: `/media/tv/${id}`,
        },
      });
      await db.episode.create({
        data: {
          id: `${id}-s01e01`,
          mediaId: id,
          seasonNumber: 1,
          episodeNumber: 1,
          title: "Pilot",
          filePath: `/media/tv/${id}/S01E01.mkv`,
        },
      });
    }
    plexFixture({
      type: "episode",
      ratingKey: "plex-shared-episode",
      title: "Pilot",
      grandparentTitle: "Shared Show",
      parentIndex: 1,
      index: 1,
      duration: 2_700_000,
      viewCount: 1,
    });

    const result = await syncPlexWatched({ apply: false });

    assert.equal(result.matched, 0);
    assert.equal(result.unmatched, 1);
    assert.equal(result.items[0]?.action, "unmatched");
  });

  test("keeps a bare numeric movie title available for fallback matching", async () => {
    await db.media.create({
      data: {
        id: "1917",
        type: "MOVIE",
        title: "1917",
        year: 2019,
        filePath: "/media/movies/1917 (2019)/1917.mkv",
      },
    });
    plexFixture(
      {
        type: "movie",
        ratingKey: "plex-1917",
        title: "1917",
        year: 2019,
        duration: 7_140_000,
        viewCount: 1,
      },
      "movie"
    );

    const result = await syncPlexWatched({ apply: false });

    assert.equal(result.scanned, 1);
    assert.equal(result.matched, 1);
    assert.equal(result.unmatched, 0);
    assert.equal(result.items[0]?.title, "1917");
    assert.equal(result.items[0]?.action, "mark-lumina-watched");
  });

  test("bulk-fetches parent shows once and preserves nested XML parent GUIDs", async () => {
    await createShow({
      id: "parent-id-show",
      title: "Lumina Canonical Name",
      year: 2020,
      tmdbId: 4242,
      filePath: "/media/tv/Local Folder Name",
      episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
    });
    const requestedTypes: string[] = [];
    plexLibraryFixture({
      requestedTypes,
      episodes: [{
        type: "episode",
        ratingKey: "episode-1",
        title: "Pilot",
        grandparentTitle: "Remote Plex Name",
        grandparentRatingKey: "parent-1",
        parentIndex: 1,
        index: 1,
        year: 2021,
        duration: 2_700_000,
        viewCount: 1,
      }],
      parentXml: `<MediaContainer size="1"><Directory type="show" ratingKey="parent-1" key="/library/metadata/parent-1/children" title="Remote Plex Name" year="2020" guid="plex://show/parent-1"><Guid id="tmdb://4242" /></Directory></MediaContainer>`,
    });

    const result = await syncPlexWatched({ apply: false });

    assert.equal(requestedTypes.filter((type) => type === "2").length, 1);
    assert.equal(requestedTypes.filter((type) => type === "4").length, 1);
    assert.equal(result.matched, 1);
    assert.match(result.items[0]?.reason ?? "", /TMDB 4242/);
    assert.match(result.items[0]?.reason ?? "", /Lumina Canonical Name/);
  });

  test("falls back to an exact local folder alias when parent inventory fails", async () => {
    await createShow({
      id: "hells-kitchen",
      title: "Hell's Kitchen",
      year: 2005,
      tmdbId: 2370,
      filePath: "/media/tv/Hell's Kitchen (US)",
      episodes: [{ seasonNumber: 23, episodeNumber: 1 }],
    });
    plexLibraryFixture({
      parentFailure: true,
      episodes: [{
        type: "episode",
        ratingKey: "hells-s23e1",
        title: "Episode 1",
        grandparentTitle: "Hell's Kitchen (US)",
        grandparentRatingKey: "hells-parent",
        parentIndex: 23,
        index: 1,
        year: 2024,
        duration: 2_700_000,
        viewCount: 1,
      }],
    });

    const result = await syncPlexWatched({ apply: false });

    assert.equal(result.matched, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0] ?? "", /parent shows/);
    assert.match(result.items[0]?.reason ?? "", /source-folder alias/);
    assert.match(result.items[0]?.reason ?? "", /Hell's Kitchen/);
  });

  test("keeps US and UK Next Level Chef identities stable across episode air years", async () => {
    await createShow({
      id: "next-level-us",
      title: "Next Level Chef",
      year: 2022,
      tmdbId: 129500,
      sortTitle: "next level chef",
      filePath: "/media/tv/Next Level Chef",
      episodes: [
        { seasonNumber: 2, episodeNumber: 1 },
        { seasonNumber: 3, episodeNumber: 1 },
      ],
    });
    await createShow({
      id: "next-level-uk",
      title: "Next Level Chef",
      year: 2023,
      tmdbId: 218161,
      sortTitle: "next level chef",
      filePath: "/media/tv/Next Level Chef (UK)",
      episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
    });
    plexLibraryFixture({
      episodes: [
        {
          type: "episode", ratingKey: "us-s2", grandparentTitle: "Next Level Chef",
          grandparentRatingKey: "us", parentIndex: 2, index: 1, year: 2023, viewCount: 1,
        },
        {
          type: "episode", ratingKey: "us-s3", grandparentTitle: "Next Level Chef",
          grandparentRatingKey: "us", parentIndex: 3, index: 1, year: 2024, viewCount: 1,
        },
        {
          type: "episode", ratingKey: "uk-s1", grandparentTitle: "Next Level Chef (UK)",
          grandparentRatingKey: "uk", parentIndex: 1, index: 1, year: 2023, viewCount: 1,
        },
      ],
      parents: [
        { type: "show", ratingKey: "us", title: "Next Level Chef", year: 2022 },
        { type: "show", ratingKey: "uk", title: "Next Level Chef", year: 2023 },
      ],
    });

    const result = await syncPlexWatched({ apply: false });

    assert.equal(result.matched, 3);
    assert.equal(result.unmatched, 0);
    assert.deepEqual(result.items.map((item) => item.plexRatingKey).sort(), ["uk-s1", "us-s2", "us-s3"]);
    assert.ok(result.items.every((item) => item.reason.includes("source-folder alias")));
  });

  test("does not use a Star Trek episode air year as show identity", async () => {
    await createShow({
      id: "star-trek-original",
      title: "Star Trek",
      year: 1966,
      sortTitle: "star trek",
      filePath: "/media/tv/Star Trek",
      episodes: [{ seasonNumber: 1, episodeNumber: 16 }],
    });
    await createShow({
      id: "star-trek-animated",
      title: "Star Trek",
      year: 1973,
      sortTitle: "star trek",
      filePath: "/media/tv/Star Trek - The Animated Series",
      episodes: [{ seasonNumber: 1, episodeNumber: 16 }],
    });
    plexFixture({
      type: "episode",
      ratingKey: "star-trek-s1e16",
      grandparentTitle: "Star Trek",
      parentIndex: 1,
      index: 16,
      year: 1967,
      viewCount: 1,
    });

    const result = await syncPlexWatched({ apply: false });

    assert.equal(result.matched, 1);
    assert.match(result.items[0]?.reason ?? "", /source-folder alias/);
  });

  test("uses exact source aliases without stripping qualifiers or fuzzy characters", async () => {
    await createShow({
      id: "pluribus",
      title: "Pluribus",
      year: 2025,
      sortTitle: "plur1bus",
      filePath: "/media/tv/PLUR1BUS",
      episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
    });
    plexFixture({
      type: "episode",
      ratingKey: "plur1bus-s1e1",
      grandparentTitle: "PLUR1BUS",
      parentIndex: 1,
      index: 1,
      year: 2025,
      viewCount: 1,
    });

    const result = await syncPlexWatched({ apply: false });

    assert.equal(result.matched, 1);
    assert.match(result.items[0]?.reason ?? "", /PLUR1BUS/);
    assert.match(result.items[0]?.reason ?? "", /Lumina “Pluribus”/);
  });

  test("refuses a parent external-id and source-folder alias collision", async () => {
    await createShow({
      id: "source-show",
      title: "Source Show",
      year: 2020,
      tmdbId: 100,
      filePath: "/media/tv/Plex Display Name",
      episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
    });
    await createShow({
      id: "external-show",
      title: "External Show",
      year: 2020,
      tmdbId: 200,
      filePath: "/media/tv/External Show",
      episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
    });
    plexLibraryFixture({
      episodes: [{
        type: "episode", ratingKey: "collision", grandparentTitle: "Plex Display Name",
        grandparentRatingKey: "collision-parent", parentIndex: 1, index: 1, viewCount: 1,
      }],
      parents: [{
        type: "show", ratingKey: "collision-parent", title: "Plex Display Name",
        Guid: [{ id: "tmdb://200" }],
      }],
    });

    const result = await syncPlexWatched({ apply: false });

    assert.equal(result.matched, 0);
    assert.equal(result.unmatched, 1);
    assert.match(result.items[0]?.reason ?? "", /Identity collision/);
    assert.match(result.items[0]?.reason ?? "", /External Show/);
    assert.match(result.items[0]?.reason ?? "", /Source Show/);
  });

  test("refuses an ambiguous exact source-folder alias", async () => {
    for (const [id, title, root] of [
      ["duplicate-folder-a", "First Canonical Title", "/media/tv"],
      ["duplicate-folder-b", "Second Canonical Title", "/media/tv-anime"],
    ] as const) {
      await createShow({
        id,
        title,
        year: 2020,
        filePath: `${root}/Shared Source Folder`,
        episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
      });
    }
    plexFixture({
      type: "episode",
      ratingKey: "ambiguous-folder",
      grandparentTitle: "Shared Source Folder",
      parentIndex: 1,
      index: 1,
      viewCount: 1,
    });

    const result = await syncPlexWatched({ apply: false });

    assert.equal(result.matched, 0);
    assert.equal(result.unmatched, 1);
    assert.match(result.items[0]?.reason ?? "", /Ambiguous exact local source-folder alias/);
  });

  test("lets a unique parent TMDB identity disambiguate a shared source-folder alias", async () => {
    for (const [id, title, tmdbId, root] of [
      ["external-alias-a", "External Target", 301, "/media/tv"],
      ["external-alias-b", "Other Local Show", 302, "/media/tv-anime"],
    ] as const) {
      await createShow({
        id,
        title,
        tmdbId,
        year: 2020,
        filePath: `${root}/Shared Source Folder`,
        episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
      });
    }
    plexLibraryFixture({
      episodes: [{
        type: "episode",
        ratingKey: "externally-disambiguated",
        grandparentTitle: "Shared Source Folder",
        grandparentRatingKey: "external-parent",
        parentIndex: 1,
        index: 1,
        viewCount: 1,
      }],
      parents: [{
        type: "show",
        ratingKey: "external-parent",
        title: "Shared Source Folder",
        Guid: [{ id: "tmdb://301" }],
      }],
    });

    const result = await syncPlexWatched({ apply: false });

    assert.equal(result.matched, 1);
    assert.equal(result.unmatched, 0);
    assert.match(result.items[0]?.reason ?? "", /TMDB 301/);
    assert.match(result.items[0]?.reason ?? "", /External Target/);
  });

  test("matches a metadata-retitled movie through its exact source sort title", async () => {
    await db.media.create({
      data: {
        id: "run-retitled",
        type: "MOVIE",
        title: "Chicken Run",
        sortTitle: "Run",
        year: 2020,
        filePath: "/media/movies/Run (2020)/Run.mkv",
      },
    });
    plexFixture(
      { type: "movie", ratingKey: "run", title: "Run", year: 2020, viewCount: 1 },
      "movie"
    );

    const result = await syncPlexWatched({ apply: false });

    assert.equal(result.matched, 1);
    assert.match(result.items[0]?.reason ?? "", /source-title alias “Run”/);
    assert.match(result.items[0]?.reason ?? "", /Lumina “Chicken Run”/);
  });

  test("preview reports pull and push changes without progress or scrobble mutations", async () => {
    await createShow({
      id: "preview-show",
      title: "Preview Show",
      year: 2020,
      filePath: "/media/tv/Preview Show",
      episodes: [
        { seasonNumber: 1, episodeNumber: 1 },
        { seasonNumber: 1, episodeNumber: 2 },
      ],
    });
    await db.watchProgress.create({
      data: {
        id: "preview-existing-progress",
        mediaId: "preview-show",
        episodeId: "preview-show-s1e2",
        position: 2_700,
        duration: 2_700,
        completed: true,
      },
    });
    const scrobbledKeys: string[] = [];
    plexLibraryFixture({
      scrobbledKeys,
      episodes: [
        {
          type: "episode", ratingKey: "preview-pull", grandparentTitle: "Preview Show",
          parentIndex: 1, index: 1, duration: 2_700_000, viewCount: 1,
        },
        {
          type: "episode", ratingKey: "preview-push", grandparentTitle: "Preview Show",
          parentIndex: 1, index: 2, duration: 2_700_000, viewCount: 0,
        },
      ],
    });

    const result = await syncPlexWatched({ apply: false, direction: "two-way" });

    assert.equal(result.markedLuminaWatched, 1);
    assert.equal(result.markedPlexWatched, 1);
    assert.equal(await db.watchProgress.count(), 1);
    assert.equal(
      await db.watchProgress.findFirst({ where: { episodeId: "preview-show-s1e1" } }),
      null
    );
    assert.equal((await db.watchProgress.findUnique({ where: { id: "preview-existing-progress" } }))?.position, 2_700);
    assert.deepEqual(scrobbledKeys, []);
  });

  test("pull apply updates only the exact episode and restores Continue Watching visibility", async () => {
    await createShow({
      id: "pull-show",
      title: "Pull Show",
      year: 2020,
      filePath: "/media/tv/Pull Show",
      episodes: [
        { seasonNumber: 1, episodeNumber: 1 },
        { seasonNumber: 1, episodeNumber: 2 },
      ],
    });
    await db.watchProgress.create({
      data: {
        id: "pull-target-progress",
        mediaId: "pull-show",
        episodeId: "pull-show-s1e1",
        position: 15,
        duration: 2_700,
        completed: false,
        hiddenFromContinueWatching: true,
      },
    });
    plexLibraryFixture({
      episodes: [
        {
          type: "episode", ratingKey: "pull-target", grandparentTitle: "Pull Show",
          parentIndex: 1, index: 1, duration: 2_700_000, viewCount: 1,
        },
        {
          type: "episode", ratingKey: "pull-skipped", grandparentTitle: "Pull Show",
          parentIndex: 1, index: 2, duration: 2_700_000, viewCount: 0,
        },
        {
          type: "episode", ratingKey: "pull-unmatched", grandparentTitle: "Pull Show",
          parentIndex: 9, index: 9, duration: 2_700_000, viewCount: 1,
        },
      ],
    });

    const result = await syncPlexWatched({ apply: true, direction: "pull" });
    const target = await db.watchProgress.findUnique({ where: { id: "pull-target-progress" } });

    assert.equal(result.markedLuminaWatched, 1);
    assert.equal(target?.completed, true);
    assert.equal(target?.position, 2_700);
    assert.equal(target?.duration, 2_700);
    assert.equal(target?.hiddenFromContinueWatching, false);
    assert.equal(
      await db.watchProgress.findFirst({ where: { episodeId: "pull-show-s1e2" } }),
      null
    );
    assert.equal(await db.watchProgress.count(), 1);
  });

  test("push apply scrobbles only the exact pending Plex rating key", async () => {
    for (const [id, completed] of [
      ["push-target", true],
      ["push-synced", true],
      ["push-skipped", false],
    ] as const) {
      await db.media.create({
        data: { id, type: "MOVIE", title: id, year: 2020, filePath: `/media/movies/${id}.mkv` },
      });
      if (completed) {
        await db.watchProgress.create({
          data: {
            id: `${id}-progress`,
            mediaId: id,
            position: 100,
            duration: 100,
            completed: true,
          },
        });
      }
    }
    const scrobbledKeys: string[] = [];
    plexLibraryFixture({
      sectionType: "movie",
      scrobbledKeys,
      movies: [
        { type: "movie", ratingKey: "push-rating", title: "push-target", year: 2020, viewCount: 0 },
        { type: "movie", ratingKey: "synced-rating", title: "push-synced", year: 2020, viewCount: 1 },
        { type: "movie", ratingKey: "skipped-rating", title: "push-skipped", year: 2020, viewCount: 0 },
        { type: "movie", ratingKey: "unmatched-rating", title: "not-in-lumina", year: 2020, viewCount: 0 },
      ],
    });

    const result = await syncPlexWatched({ apply: true, direction: "push" });

    assert.equal(result.markedPlexWatched, 1);
    assert.equal(result.alreadySynced, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.unmatched, 1);
    assert.deepEqual(scrobbledKeys, ["push-rating"]);
    assert.equal(await db.watchProgress.count(), 2);
  });

  test("returns changes before unmatched rows with an explicit bounded detail cap", async () => {
    for (const [id, completed] of [["change", false], ["synced", true], ["skip", false]] as const) {
      await db.media.create({
        data: { id, type: "MOVIE", title: id, year: 2020, filePath: `/media/movies/${id}.mkv` },
      });
      if (completed) {
        await db.watchProgress.create({
          data: { id: `${id}-progress`, mediaId: id, position: 100, duration: 100, completed: true },
        });
      }
    }
    const unmatched = Array.from({ length: 2_001 }, (_, index) => ({
      type: "movie",
      ratingKey: `unmatched-${index}`,
      title: `Unmatched ${String(index).padStart(4, "0")}`,
      year: 2020,
      viewCount: 0,
    }));
    plexLibraryFixture({
      sectionType: "movie",
      movies: [
        { type: "movie", ratingKey: "change", title: "change", year: 2020, viewCount: 1 },
        { type: "movie", ratingKey: "synced", title: "synced", year: 2020, viewCount: 1 },
        { type: "movie", ratingKey: "skip", title: "skip", year: 2020, viewCount: 0 },
        ...unmatched,
      ],
    });

    const result = await syncPlexWatched({ apply: false });

    assert.equal(result.scanned, 2_004);
    assert.equal(result.matched, 3);
    assert.equal(result.unmatched, 2_001);
    assert.equal(result.alreadySynced, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.attentionTotal, 2_002);
    assert.equal(result.detailReturned, 2_000);
    assert.equal(result.detailTruncated, true);
    assert.equal(result.items.length, 2_000);
    assert.equal(result.items[0]?.action, "mark-lumina-watched");
    assert.ok(result.items.every((item) => item.action !== "already-synced" && item.action !== "skipped"));
  });
});
