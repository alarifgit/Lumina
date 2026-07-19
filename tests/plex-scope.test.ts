import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { plexItemMatchesSectionType } from "@/lib/plex-scope";

describe("Plex preview section scope", () => {
  test("keeps only movies for a movie section", () => {
    assert.equal(plexItemMatchesSectionType("movie", "MOVIE"), true);
    assert.equal(plexItemMatchesSectionType("episode", "MOVIE"), false);
  });

  test("keeps only episodes for a TV section", () => {
    assert.equal(plexItemMatchesSectionType("episode", "TV"), true);
    assert.equal(plexItemMatchesSectionType("movie", "TV"), false);
  });

  test("keeps the full Plex library when no section is selected", () => {
    assert.equal(plexItemMatchesSectionType("movie", undefined), true);
    assert.equal(plexItemMatchesSectionType("episode", undefined), true);
  });
});
