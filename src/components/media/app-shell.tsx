"use client";

import { useMediaStore } from "@/store/media-store";
import { TopNav } from "./top-nav";
import { Footer } from "./footer";
import { HomeView } from "./home-view";
import { BrowseView } from "./browse-view";
import { SearchView } from "./search-view";
import { MyListView } from "./my-list-view";
import { LibraryView } from "./library-view";
import { DetailOverlay } from "./detail-overlay";
import { VideoPlayer } from "./video-player";
import { useEffect } from "react";

export function AppShell() {
  const route = useMediaStore((s) => s.route);
  const openDetail = useMediaStore((s) => s.openDetail);
  const openWatch = useMediaStore((s) => s.openWatch);

  const handlePlay = (mediaId: string, episodeId: string | null, startAt: number) =>
    openWatch(mediaId, episodeId, startAt);

  // scroll to top on route change
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <TopNav />
      <main className="flex-1">
        {route === "home" && <HomeView onOpen={openDetail} onPlay={handlePlay} />}
        {route === "movies" && (
          <BrowseView type="MOVIE" title="Movies" onOpen={openDetail} onPlay={handlePlay} />
        )}
        {route === "tv" && (
          <BrowseView type="TV" title="TV Shows" onOpen={openDetail} onPlay={handlePlay} />
        )}
        {route === "search" && <SearchView onOpen={openDetail} onPlay={handlePlay} />}
        {route === "category" && (
          <BrowseView title="Categories" onOpen={openDetail} onPlay={handlePlay} />
        )}
        {route === "mylist" && <MyListView onOpen={openDetail} onPlay={handlePlay} />}
        {route === "library" && <LibraryView />}
      </main>
      <Footer />
      <DetailOverlay onPlay={handlePlay} />
      <VideoPlayer />
    </div>
  );
}
