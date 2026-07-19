"use client";

import { useMediaStore, type BrowseTarget } from "@/store/media-store";
import { TopNav } from "./top-nav";
import { Footer } from "./footer";
import { HomeView } from "./home-view";
import { BrowseView } from "./browse-view";
import { SearchView } from "./search-view";
import { MyListView } from "./my-list-view";
import { LibraryView } from "./library-view";
import { CategoryView } from "./category-view";
import { DetailOverlay } from "./detail-overlay";
import { VideoPlayer } from "./video-player";
import { useEffect } from "react";

const MOVIES_TARGET: BrowseTarget = {
  scope: "library:movies",
  title: "Movies",
  eyebrow: "Browse",
  type: "MOVIE",
};

const TV_TARGET: BrowseTarget = {
  scope: "library:tv",
  title: "TV Shows",
  eyebrow: "Browse",
  type: "TV",
};

export function AppShell() {
  const route = useMediaStore((s) => s.route);
  const browseTarget = useMediaStore((s) => s.browseTarget);
  const openDetail = useMediaStore((s) => s.openDetail);
  const openWatch = useMediaStore((s) => s.openWatch);
  const setScrollPosition = useMediaStore((s) => s.setScrollPosition);

  const viewKey =
    route === "movies"
      ? `browse:${MOVIES_TARGET.scope}`
      : route === "tv"
        ? `browse:${TV_TARGET.scope}`
        : route === "browse" && browseTarget
          ? `browse:${browseTarget.scope}`
          : route;

  const handlePlay = (mediaId: string, episodeId: string | null, startAt: number) =>
    openWatch(mediaId, episodeId, startAt);

  // Restore each logical view independently. React Query keeps loaded infinite
  // pages mounted in cache, so returning to a shelf can recover its exact place.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const position = useMediaStore.getState().scrollPositions[viewKey] ?? 0;
      window.scrollTo({ top: position, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [viewKey]);

  useEffect(() => {
    let frame: number | null = null;
    const capture = () => {
      if (frame != null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        setScrollPosition(viewKey, window.scrollY);
      });
    };
    window.addEventListener("scroll", capture, { passive: true });
    return () => {
      window.removeEventListener("scroll", capture);
      if (frame != null) window.cancelAnimationFrame(frame);
    };
  }, [setScrollPosition, viewKey]);

  return (
    <div className="lumina-canvas relative flex min-h-screen flex-col text-foreground">
      <TopNav />
      <main className="flex-1">
        {route === "home" && <HomeView onOpen={openDetail} onPlay={handlePlay} />}
        {route === "movies" && (
          <BrowseView target={MOVIES_TARGET} onOpen={openDetail} onPlay={handlePlay} />
        )}
        {route === "tv" && (
          <BrowseView target={TV_TARGET} onOpen={openDetail} onPlay={handlePlay} />
        )}
        {route === "browse" && browseTarget && (
          <BrowseView target={browseTarget} onOpen={openDetail} onPlay={handlePlay} />
        )}
        {route === "search" && <SearchView onOpen={openDetail} onPlay={handlePlay} />}
        {route === "category" && <CategoryView onOpen={openDetail} onPlay={handlePlay} />}
        {route === "mylist" && <MyListView onOpen={openDetail} onPlay={handlePlay} />}
        {route === "library" && <LibraryView />}
        {route === "settings" && <LibraryView mode="settings" />}
      </main>
      <Footer />
      <DetailOverlay onPlay={handlePlay} />
      <VideoPlayer />
    </div>
  );
}
