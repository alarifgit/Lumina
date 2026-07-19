import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { resolvePlaybackTimeline } from "@/lib/playback-progress";

describe("playback progress timeline", () => {
  test("adds a transcode segment offset to the browser clock", () => {
    assert.deepEqual(
      resolvePlaybackTimeline({
        transcoded: true,
        timelineOffset: 1200,
        currentTime: 45,
        mediaDuration: Number.POSITIVE_INFINITY,
        probeDuration: 7200,
      }),
      { position: 1245, duration: 7200, completed: false }
    );
  });

  test("uses metadata runtime when a fragmented stream has no finite duration", () => {
    const result = resolvePlaybackTimeline({
      transcoded: true,
      timelineOffset: 300,
      currentTime: 30,
      mediaDuration: Number.POSITIVE_INFINITY,
      runtimeMinutes: 100,
    });
    assert.equal(result.position, 330);
    assert.equal(result.duration, 6000);
  });

  test("keeps direct-play time absolute", () => {
    const result = resolvePlaybackTimeline({
      transcoded: false,
      timelineOffset: 900,
      currentTime: 90,
      mediaDuration: 5400,
      probeDuration: 5400,
    });
    assert.equal(result.position, 90);
    assert.equal(result.duration, 5400);
  });
});
