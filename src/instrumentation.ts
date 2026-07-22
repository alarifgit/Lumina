/**
 * Next.js instrumentation — runs once when the server starts.
 * Starts the filesystem watcher so new media is auto-detected (like Plex).
 */
export async function register() {
  // Only run on the server (not during build/client)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getHomeData } = await import("./lib/media-queries");
    const { primeHomeData } = await import("./lib/home-prime");
    const primeStartedAt = Date.now();
    try {
      await primeHomeData(getHomeData);
      console.log(`[Lumina] Home data ready in ${Date.now() - primeStartedAt}ms`);
    } catch (error) {
      console.error("[Lumina] Failed to prepare Home data:", (error as Error).message);
    }

    const { startMediaWatcher } = await import("./lib/watcher");
    // Home is prepared before the remote filesystem watcher begins its
    // initial crawl, preventing SMB traversal from contending with first paint.
    setTimeout(() => {
      startMediaWatcher().catch((e) =>
        console.error("[Lumina] Failed to start media watcher:", e.message)
      );
    }, 3000);
  }
}
