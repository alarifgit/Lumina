import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePlaybackDecision,
  type PlaybackEpisodeCandidate,
  type PlaybackProgressCandidate,
} from "@/lib/playback-selection";
import { playbackRequestForSummary } from "@/lib/media-utils";

const NOW = new Date("2026-07-20T12:00:00.000Z");

function episode(
  id: string,
  seasonNumber: number,
  episodeNumber: number,
  overrides: Partial<PlaybackEpisodeCandidate> = {},
): PlaybackEpisodeCandidate {
  return {
    id,
    mediaId: "show",
    seasonNumber,
    episodeNumber,
    available: true,
    ...overrides,
  };
}

function progress(
  id: string,
  episodeId: string,
  overrides: Partial<PlaybackProgressCandidate> = {},
): PlaybackProgressCandidate {
  return {
    id,
    mediaId: "show",
    episodeId,
    position: 0,
    duration: 1200,
    completed: false,
    updatedAt: "2026-07-20T10:00:00.000Z",
    ...overrides,
  };
}

function select(
  episodes: PlaybackEpisodeCandidate[],
  rows: PlaybackProgressCandidate[] = [],
) {
  return resolvePlaybackDecision({ mediaId: "show", episodes, progress: rows, now: NOW });
}

describe("shared show playback selection", () => {
  test("keeps generic show controls automatic while Continue Watching stays exact", () => {
    const summary = {
      type: "TV" as const,
      progressEpisodeId: "s2e6",
      progressPosition: 29.8,
    };

    assert.deepEqual(playbackRequestForSummary(summary), { episodeId: null, startAt: 0 });
    assert.deepEqual(playbackRequestForSummary(summary, "resume"), {
      episodeId: "s2e6",
      startAt: 29.8,
    });
  });

  test("starts an untouched show at the earliest regular episode before Specials", () => {
    const decision = select([
      episode("s2e6", 2, 6),
      episode("special", 0, 1),
      episode("s1e2", 1, 2),
      episode("s1e1", 1, 1),
    ]);

    assert.equal(decision.target?.episodeId, "s1e1");
    assert.equal(decision.target?.startAt, 0);
    assert.equal(decision.reason, "first-unwatched-regular");
    assert.equal(decision.counts.regularEpisodes, 3);
    assert.equal(decision.counts.specials, 1);
  });

  test("resumes only when progress belongs to the canonical earliest unwatched episode", () => {
    const canonical = select(
      [episode("s1e1", 1, 1), episode("s1e2", 1, 2)],
      [progress("p1", "s1e1", { position: 240 })],
    );
    assert.equal(canonical.target?.episodeId, "s1e1");
    assert.equal(canonical.target?.startAt, 240);
    assert.equal(canonical.reason, "resume-canonical-episode");

    const later = select(
      [episode("s1e1", 1, 1), episode("s1e2", 1, 2)],
      [progress("p2", "s1e2", { position: 360 })],
    );
    assert.equal(later.target?.episodeId, "s1e1");
    assert.equal(later.target?.startAt, 0);
    assert.equal(later.reason, "first-unwatched-regular");
    assert.ok(later.warnings.some((warning) => warning.code === "noncanonical-progress-ignored"));
  });

  test("fills an earlier unwatched gap instead of advancing from a later completed episode", () => {
    const decision = select(
      [episode("s1e1", 1, 1), episode("s2e5", 2, 5), episode("s2e6", 2, 6)],
      [progress("watched", "s2e5", { position: 1200, completed: true })],
    );

    assert.equal(decision.target?.episodeId, "s1e1");
    assert.equal(decision.reason, "first-unwatched-regular");
  });

  test("replays the first regular episode after all regular episodes are complete", () => {
    const decision = select(
      [episode("special", 0, 1), episode("s1e1", 1, 1), episode("s1e2", 1, 2)],
      [
        progress("w1", "s1e1", { position: 1200, completed: true }),
        progress("w2", "s1e2", { position: 1200, completed: true }),
      ],
    );

    assert.equal(decision.target?.episodeId, "s1e1");
    assert.equal(decision.target?.startAt, 0);
    assert.equal(decision.reason, "restart-first-regular");
  });

  test("uses Specials only when there are no regular episodes", () => {
    const decision = select([
      episode("special-2", 0, 2),
      episode("special-1", 0, 1),
    ]);

    assert.equal(decision.target?.episodeId, "special-1");
    assert.equal(decision.reason, "first-unwatched-special");
  });

  test("keeps future-dated local regular episodes playable ahead of Specials", () => {
    const decision = select([
      episode("special", 0, 1),
      episode("future-regular", 1, 1, { airDate: "2027-01-01T00:00:00.000Z" }),
    ]);

    assert.equal(decision.target?.episodeId, "future-regular");
    assert.equal(decision.reason, "first-unwatched-regular");
    assert.equal(decision.counts.futureEpisodes, 1);
    assert.ok(decision.warnings.some((warning) => warning.code === "future-local-episode"));
  });

  test("keeps explicit episode playback exact and never silently falls back", () => {
    const episodes = [
      episode("s1e1", 1, 1),
      episode("s2e6", 2, 6),
      episode("future", 3, 1, { airDate: "2027-01-01T00:00:00.000Z" }),
      episode("missing", 4, 1, { available: false }),
    ];
    const explicit = resolvePlaybackDecision({
      mediaId: "show",
      intent: { kind: "episode", episodeId: "s2e6" },
      episodes,
      progress: [progress("resume", "s2e6", { position: 90 })],
      now: NOW,
    });
    assert.equal(explicit.target?.episodeId, "s2e6");
    assert.equal(explicit.target?.startAt, 90);
    assert.equal(explicit.reason, "explicit-episode");

    const explicitFuture = resolvePlaybackDecision({
      mediaId: "show",
      intent: { kind: "episode", episodeId: "future" },
      episodes,
      progress: [],
      now: NOW,
    });
    assert.equal(explicitFuture.target?.episodeId, "future");
    assert.ok(
      explicitFuture.warnings.some((warning) => warning.code === "future-local-episode")
    );

    const unavailable = resolvePlaybackDecision({
      mediaId: "show",
      intent: { kind: "episode", episodeId: "missing" },
      episodes,
      progress: [],
      now: NOW,
    });
    assert.equal(unavailable.target, null);
    assert.equal(unavailable.reason, "explicit-episode-unavailable");

    const unknown = resolvePlaybackDecision({
      mediaId: "show",
      intent: { kind: "episode", episodeId: "unknown" },
      episodes,
      progress: [],
      now: NOW,
    });
    assert.equal(unknown.target, null);
    assert.equal(unknown.reason, "explicit-episode-not-found");
  });

  test("uses the latest duplicate progress row deterministically and reports the anomaly", () => {
    const decision = select(
      [episode("s1e1", 1, 1)],
      [
        progress("older", "s1e1", {
          position: 100,
          updatedAt: "2026-07-19T10:00:00.000Z",
        }),
        progress("newer", "s1e1", {
          position: 420,
          updatedAt: "2026-07-20T10:00:00.000Z",
        }),
      ],
    );

    assert.equal(decision.target?.startAt, 420);
    assert.equal(decision.target?.progressId, "newer");
    assert.equal(decision.counts.effectiveProgressTargets, 1);
    assert.ok(decision.warnings.some((warning) => warning.code === "duplicate-progress-target"));
  });

  test("ignores foreign progress and explains incomplete library starts", () => {
    const decision = select(
      [episode("s2e6", 2, 6)],
      [progress("foreign", "s2e6", { mediaId: "another-show", position: 500 })],
    );

    assert.equal(decision.target?.episodeId, "s2e6");
    assert.equal(decision.target?.startAt, 0);
    assert.ok(decision.warnings.some((warning) => warning.code === "progress-media-mismatch"));
    assert.ok(decision.warnings.some((warning) => warning.code === "missing-series-premiere"));
  });
});
