import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { decideTmdbAutoMatch } from "@/lib/tmdb-match";

const candidate = (
  tmdbId: number,
  title: string,
  year: number | null,
  originalTitle: string | null = null
) => ({ tmdbId, title, year, originalTitle });

describe("collision-safe TMDB auto matching", () => {
  test("ignores search rank and chooses the unique exact Run (2020) identity", () => {
    const decision = decideTmdbAutoMatch("Run", 2020, [
      candidate(7443, "Chicken Run", 2000),
      candidate(546121, "Run", 2020),
    ]);
    assert.equal(decision.reason, "matched");
    assert.equal(decision.match?.tmdbId, 546121);
  });

  test("normalizes punctuation and ampersands without confusing distinct titles", () => {
    const decision = decideTmdbAutoMatch("Mr & Mrs Smith", 2024, [
      candidate(1952, "Mr. & Mrs. North", 1952),
      candidate(118642, "Mr. & Mrs. Smith", 2024),
    ]);
    assert.equal(decision.match?.tmdbId, 118642);
  });

  test("rejects wrong-only and exact-title wrong-year candidates", () => {
    assert.equal(
      decideTmdbAutoMatch("Run", 2020, [candidate(7443, "Chicken Run", 2000)]).reason,
      "no-exact-title"
    );
    assert.equal(
      decideTmdbAutoMatch("Run", 2020, [candidate(100, "Run", 1991)]).reason,
      "year-mismatch"
    );
  });

  test("leaves duplicate exact identities and yearless remakes ambiguous", () => {
    assert.equal(
      decideTmdbAutoMatch("Run", 2020, [
        candidate(100, "Run", 2020),
        candidate(101, "Run", 2020),
      ]).reason,
      "ambiguous"
    );
    assert.equal(
      decideTmdbAutoMatch("Run", null, [
        candidate(100, "Run", 2020),
        candidate(101, "Run", 1991),
      ]).reason,
      "ambiguous"
    );
  });

  test("allows one unique missing-year identity and treats 1917 as a title", () => {
    assert.equal(
      decideTmdbAutoMatch("Moon", null, [candidate(17431, "Moon", 2009)]).match?.tmdbId,
      17431
    );
    assert.equal(
      decideTmdbAutoMatch("1917", null, [
        candidate(530915, "1917", 2019),
        candidate(999, "1917: The Real Story", 2020),
      ]).match?.tmdbId,
      530915
    );
  });

  test("keeps yearless fallback for manual search but disables it for auto search", async () => {
    process.env.DATABASE_URL ??= "file:./tests/tmdb-match-unused.db";
    const { searchTmdb } = await import("@/lib/tmdb");
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      const hasYear = new URL(url).searchParams.has("year");
      return new Response(
        JSON.stringify({
          results: hasYear
            ? []
            : [{ id: 7443, title: "Chicken Run", release_date: "2000-06-23" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      const automatic = await searchTmdb("Run", "MOVIE", 2020, "fixture-key", {
        allowYearlessFallback: false,
      });
      assert.deepEqual(automatic, []);
      assert.equal(requests.length, 1);

      requests.length = 0;
      const manual = await searchTmdb("Run", "MOVIE", 2020, "fixture-key");
      assert.equal(requests.length, 2);
      assert.equal(manual[0]?.title, "Chicken Run");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("preserves a source episode title when provider season ordering conflicts", async () => {
    process.env.DATABASE_URL ??= "file:./tests/tmdb-match-unused.db";
    const { getEpisodeSourceMetadataConflict } = await import("@/lib/tmdb");
    const localEpisode = {
      filePath: "/media/tv/Kitchen Nightmares (US)/Season 9/Kitchen Nightmares (US) - S09E01 - Freddy's Steak House WEBDL-1080p.mkv",
      overview: null,
      stillUrl: null,
      airDate: null,
      runtime: null,
    };

    assert.deepEqual(
      getEpisodeSourceMetadataConflict(localEpisode, "Iberville: Ramsay's Worst Nightmare"),
      {
        sourceTitle: "Freddy's Steak House",
        providerTitle: "Iberville: Ramsay's Worst Nightmare",
      }
    );
    assert.equal(getEpisodeSourceMetadataConflict(localEpisode, "Freddy's Steak House"), null);
  });
});
