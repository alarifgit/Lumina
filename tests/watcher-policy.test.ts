import { test } from "node:test";
import assert from "node:assert/strict";
import type { Stats } from "fs";
import {
  isWatcherRelevantPath,
  isWatcherRescanEvent,
  shouldIgnoreWatcherPath,
  watcherPollingEnabled,
  watcherPollingInterval,
} from "@/lib/watcher-policy";

const directory = { isDirectory: () => true, isFile: () => false } as Stats;
const file = { isDirectory: () => false, isFile: () => true } as Stats;

test("dotted media directories remain traversable while unsupported files are ignored", () => {
  assert.equal(shouldIgnoreWatcherPath("/media/tv/Mrs. Davis", directory), false);
  assert.equal(shouldIgnoreWatcherPath("/media/movies/Spider-Man.No.Way.Home.2021", undefined), false);
  assert.equal(shouldIgnoreWatcherPath("/media/movies/Film.mkv", file), false);
  assert.equal(shouldIgnoreWatcherPath("/media/movies/Film.en.srt", file), false);
  assert.equal(shouldIgnoreWatcherPath("/media/movies/readme.nfo", file), true);
  assert.equal(shouldIgnoreWatcherPath("/media/movies/._Film.mkv", file), true);
});

test("watcher reconciles additions, changes, and removals for media and subtitles", () => {
  for (const event of ["add", "addDir", "change", "unlink", "unlinkDir"]) {
    assert.equal(isWatcherRescanEvent(event), true);
  }
  assert.equal(isWatcherRelevantPath("add", "/media/Film.mkv"), true);
  assert.equal(isWatcherRelevantPath("add", "/media/Film.ass"), true);
  assert.equal(isWatcherRelevantPath("unlink", "/media/readme.txt"), false);
});

test("remote-safe polling defaults are bounded and can be disabled", () => {
  assert.equal(watcherPollingEnabled(undefined), true);
  assert.equal(watcherPollingEnabled("false"), false);
  assert.equal(watcherPollingInterval(undefined), 60_000);
  assert.equal(watcherPollingInterval("500"), 60_000);
  assert.equal(watcherPollingInterval("2500"), 2_500);
});
