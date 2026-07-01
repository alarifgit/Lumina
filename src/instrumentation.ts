/**
 * Next.js instrumentation — runs once when the server starts.
 * Starts the filesystem watcher so new media is auto-detected (like Plex).
 */
export async function register() {
  // Only run on the server (not during build/client)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startMediaWatcher } = await import("./lib/watcher");
    // Start after a short delay so the server is ready to handle DB queries
    setTimeout(() => {
      startMediaWatcher().catch((e) =>
        console.error("[Lumina] Failed to start media watcher:", e.message)
      );
    }, 3000);
  }
}
