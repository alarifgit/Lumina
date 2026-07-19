import { watch, type FSWatcher } from "chokidar";
import { db } from "@/lib/db";
import { scanSection } from "@/lib/scanner";
import {
  isWatcherRelevantPath,
  isWatcherRescanEvent,
  shouldIgnoreWatcherPath,
  watcherPollingEnabled,
  watcherPollingInterval,
} from "@/lib/watcher-policy";

type Registration = {
  watcher: FSWatcher;
  mediaDir: string;
  name: string;
};

const registrations = new Map<string, Registration>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingPaths = new Map<string, Set<string>>();
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshTail: Promise<void> = Promise.resolve();
let started = false;

const DEBOUNCE_MS = 5_000;
const SECTION_REFRESH_MS = 30_000;

function scheduleSectionScan(section: { id: string; name: string }, changedPath: string) {
  const paths = pendingPaths.get(section.id) ?? new Set<string>();
  paths.add(changedPath);
  pendingPaths.set(section.id, paths);

  const existing = debounceTimers.get(section.id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(async () => {
    debounceTimers.delete(section.id);
    const changedPaths = [...(pendingPaths.get(section.id) ?? [])];
    pendingPaths.delete(section.id);
    console.log(`[Lumina Watcher] Media change detected in "${section.name}" — auto-scanning…`);
    try {
      const result = await scanSection({
        sectionId: section.id,
        changedPaths,
        refreshExistingMetadata: false,
      });
      console.log(
        `[Lumina Watcher] "${section.name}" scan complete: ${result.added} added, ${result.updated} updated${result.complete ? "" : ", traversal incomplete"}`
      );
    } catch (error) {
      console.error(`[Lumina Watcher] Auto-scan failed for "${section.name}":`, (error as Error).message);
    }
  }, DEBOUNCE_MS);
  timer.unref?.();
  debounceTimers.set(section.id, timer);
}

async function attachSection(section: { id: string; name: string; mediaDir: string }) {
  const usePolling = watcherPollingEnabled();
  const pollInterval = watcherPollingInterval();
  const watcher = watch(section.mediaDir, {
    ignored: shouldIgnoreWatcherPath,
    persistent: true,
    ignoreInitial: true,
    usePolling,
    interval: pollInterval,
    binaryInterval: pollInterval,
    awaitWriteFinish: { stabilityThreshold: 3_000, pollInterval: 1_000 },
  });

  watcher.on("all", (event, changedPath) => {
    if (!isWatcherRescanEvent(event) || !isWatcherRelevantPath(event, changedPath)) return;
    scheduleSectionScan(section, changedPath);
  });
  watcher.on("ready", () => {
    console.log(
      `[Lumina Watcher] Watching "${section.name}" → ${section.mediaDir}${usePolling ? ` (polling every ${pollInterval}ms)` : ""}`
    );
  });
  watcher.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Lumina Watcher] Error watching "${section.mediaDir}":`, message);
  });

  registrations.set(section.id, { watcher, mediaDir: section.mediaDir, name: section.name });
}

async function syncWatcherRegistrations() {
  if (!started) return;
  const sections = await db.librarySection.findMany({
    select: { id: true, name: true, mediaDir: true },
  });
  const sectionIds = new Set(sections.map((section) => section.id));

  for (const [sectionId, registration] of registrations) {
    const section = sections.find((candidate) => candidate.id === sectionId);
    if (!sectionIds.has(sectionId) || section?.mediaDir !== registration.mediaDir || section?.name !== registration.name) {
      await registration.watcher.close().catch(() => {});
      registrations.delete(sectionId);
    }
  }

  for (const section of sections) {
    if (!registrations.has(section.id)) {
      try {
        await attachSection(section);
      } catch (error) {
        console.error(`[Lumina Watcher] Couldn't watch "${section.mediaDir}":`, (error as Error).message);
      }
    }
  }

  if (sections.length === 0) {
    console.log("[Lumina Watcher] No library sections configured; watcher will retry.");
  }
}

/** Reconcile watcher subscriptions with the current section table. */
export function refreshMediaWatchers() {
  const refresh = refreshTail.catch(() => {}).then(syncWatcherRegistrations);
  refreshTail = refresh;
  return refresh;
}

/**
 * Start remote-mount-safe library watching. The registration list is refreshed
 * periodically so section additions, path edits, and removals do not require a
 * container restart.
 */
export async function startMediaWatcher() {
  if (!started) {
    started = true;
    refreshTimer = setInterval(() => {
      refreshMediaWatchers().catch((error) =>
        console.error("[Lumina Watcher] Failed to refresh sections:", (error as Error).message)
      );
    }, SECTION_REFRESH_MS);
    refreshTimer.unref?.();
  }
  await refreshMediaWatchers();
}

/** Stop all watchers (used in tests / graceful shutdown). */
export async function stopMediaWatcher() {
  started = false;
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  await refreshTail.catch(() => {});
  for (const registration of registrations.values()) {
    await registration.watcher.close().catch(() => {});
  }
  registrations.clear();
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
  pendingPaths.clear();
}
