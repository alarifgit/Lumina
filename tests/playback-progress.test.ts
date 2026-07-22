import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveAutoTranscodeStart,
  resolvePlaybackOffset,
  resolvePlaybackTimeline,
} from "@/lib/playback-progress";

describe("playback progress timeline", () => {
  test("uses a late server-selected resume point for generic transcoded TV playback", () => {
    assert.equal(
      resolvePlaybackOffset({
        resumeOverride: null,
        serverResumeAt: 845,
        timelineOffset: 0,
      }),
      845
    );
  });

  test("keeps an explicit seek offset after it takes ownership of the timeline", () => {
    assert.equal(
      resolvePlaybackOffset({
        resumeOverride: 845,
        serverResumeAt: 845,
        timelineOffset: 1_200,
      }),
      1_200
    );
  });

  test("a late auto-transcode switch keeps the furthest known absolute clock", () => {
    assert.equal(
      resolveAutoTranscodeStart({ currentTime: 852, serverResumeAt: 845 }),
      852
    );
    assert.equal(
      resolveAutoTranscodeStart({ currentTime: 0, serverResumeAt: 845 }),
      845
    );
  });

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
