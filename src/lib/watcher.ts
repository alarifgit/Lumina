import { watch, type FSWatcher } from "chokidar";
import path from "path";
import { db } from "@/lib/db";
import { scanSection } from "@/lib/scanner";

const VIDEO_EXTS = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".ts"];

let watchers: FSWatcher[] = [];
let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
let started = false;

/**
 * Start watching all library sections for new/changed media files.
 * When a new video file appears (or is renamed/moved into a section dir),
 * debounce then re-scan just that section — exactly how Plex detects new media.
 *
 * This runs once on server boot (see src/lib/watcher-startup.ts).
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function startMediaWatcher() {
  if (started) return;
  started = true;

  const sections = await db.librarySection.findMany().catch(() => []);
  if (sections.length === 0) {
    // No sections yet — try again in 30s (sections may be added via the UI)
    setTimeout(() => {
      started = false;
      startMediaWatcher();
    }, 30000);
    return;
  }

  for (const section of sections) {
    try {
      const watcher = watch(section.mediaDir, {
        ignored: (p) => {
          const ext = path.extname(p).toLowerCase();
          // Ignore dotfiles, non-video files, and subtitle files (they're handled by the scanner)
          return (
            p.startsWith(".") ||
            (ext !== "" && !VIDEO_EXTS.includes(ext) && ![".srt", ".vtt", ".ass", ".ssa", ".sub"].includes(ext))
          );
        },
        persistent: true,
        ignoreInitial: true, // don't fire for files that already exist
        awaitWriteFinish: { stabilityThreshold: 3000, pollInterval: 1000 }, // wait for file write to finish
      });

      const triggerRescan = () => {
        // Debounce: if many files arrive at once (e.g. copying a folder), only scan once
        const existing = debounceTimers.get(section.id);
        if (existing) clearTimeout(existing);
        debounceTimers.set(
          section.id,
          setTimeout(async () => {
            debounceTimers.delete(section.id);
            console.log(`[Lumina Watcher] New media detected in "${section.name}" — auto-scanning…`);
            try {
              const result = await scanSection({ sectionId: section.id });
              console.log(
                `[Lumina Watcher] "${section.name}" scan complete: ${result.added} added, ${result.updated} updated`
              );
            } catch (e) {
              console.error(`[Lumina Watcher] Auto-scan failed for "${section.name}":`, (e as Error).message);
            }
          }, 5000) // 5s debounce
        );
      };

      watcher.on("add", triggerRescan);
      watcher.on("addDir", triggerRescan);
      // "rename" fires when a file is moved into the directory
      watcher.on("raw", (event, p) => {
        if (event === "rename" && p) triggerRescan();
      });

      watcher.on("error", (err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Lumina Watcher] Error watching "${section.mediaDir}":`, message);
      });

      watchers.push(watcher);
      console.log(`[Lumina Watcher] Watching "${section.name}" → ${section.mediaDir}`);
    } catch (e) {
      console.error(`[Lumina Watcher] Couldn't watch "${section.mediaDir}":`, (e as Error).message);
    }
  }
}

/** Stop all watchers (used in tests / graceful shutdown). */
export async function stopMediaWatcher() {
  for (const w of watchers) {
    await w.close().catch(() => {});
  }
  watchers = [];
  for (const [, t] of debounceTimers) clearTimeout(t);
  debounceTimers.clear();
  started = false;
}
