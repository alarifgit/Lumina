import path from "path";
import type { Stats } from "fs";

export const WATCHER_VIDEO_EXTS = new Set([".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".ts"]);
export const WATCHER_SUBTITLE_EXTS = new Set([".srt", ".vtt", ".ass", ".ssa", ".sub"]);
export const WATCHER_RESCAN_EVENTS = new Set(["add", "addDir", "change", "unlink", "unlinkDir"]);

const SYSTEM_NAMES = /^(?:\._.*|\.DS_Store|Thumbs\.db|desktop\.ini|@eaDir|\.AppleDouble|#recycle)$/i;

/**
 * Chokidar calls `ignored` before and after stat. Never classify an unknown
 * path as a file: doing so treats dotted directory names as extensions and
 * prevents Chokidar from traversing their contents.
 */
export function shouldIgnoreWatcherPath(target: string, stats?: Stats) {
  const name = path.basename(target);
  if (SYSTEM_NAMES.test(name)) return true;
  if (!stats || stats.isDirectory()) return false;
  if (!stats.isFile()) return true;
  const extension = path.extname(name).toLowerCase();
  return !WATCHER_VIDEO_EXTS.has(extension) && !WATCHER_SUBTITLE_EXTS.has(extension);
}

export function isWatcherRescanEvent(event: string) {
  return WATCHER_RESCAN_EVENTS.has(event);
}

export function isWatcherRelevantPath(event: string, target: string) {
  const name = path.basename(target);
  if (SYSTEM_NAMES.test(name)) return false;
  if (event === "addDir" || event === "unlinkDir") return true;
  const extension = path.extname(name).toLowerCase();
  return WATCHER_VIDEO_EXTS.has(extension) || WATCHER_SUBTITLE_EXTS.has(extension);
}

export function watcherPollingEnabled(value = process.env.LUMINA_WATCH_USE_POLLING) {
  if (!value) return true;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

export function watcherPollingInterval(value = process.env.LUMINA_WATCH_POLL_INTERVAL_MS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : 10_000;
}
