"use client";

import { Bookmark } from "lucide-react";
import { useMyList } from "@/lib/queries";
import { MediaCard } from "./media-card";
import { GridSkeleton } from "./skeletons";
import { useMediaStore } from "@/store/media-store";
import { LogoEmblem } from "./logo";

interface Props {
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
}

export function MyListView({ onOpen, onPlay }: Props) {
  const { data, isLoading } = useMyList();
  const setRoute = useMediaStore((s) => s.setRoute);
  const items = data?.items ?? [];

  return (
    <div className="lumina-page px-4 pb-10 pt-20 sm:px-6 lg:px-8">
      <div className="lumina-panel film-grain relative mb-7 overflow-hidden rounded-xl p-5 sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_0%,rgba(238,209,132,0.14),transparent_26%),radial-gradient(circle_at_16%_100%,rgba(12,26,45,0.78),transparent_38%)]" />
        <div className="relative">
          <p className="label-eyebrow mb-2 text-primary/90">Personal shelf</p>
          <h1 className="lumina-title text-5xl font-semibold leading-none sm:text-7xl">My List</h1>
          <p className="mt-3 text-sm text-foreground/56">
            {items.length} saved {items.length === 1 ? "title" : "titles"} ready when the room goes dark.
          </p>
        </div>
      </div>

      {isLoading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <div className="lumina-panel flex flex-col items-center justify-center rounded-xl px-6 py-24 text-center">
          <LogoEmblem detailed size={96} className="mb-3 opacity-90" />
          <h3 className="lumina-title text-3xl font-semibold">Your list is waiting for its first title.</h3>
          <p className="mt-1 max-w-sm text-sm text-foreground/60">
            Add films and shows to build your private watchlist.
          </p>
          <button
            onClick={() => setRoute("home")}
            className="lumina-button-primary mt-5 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition-transform hover:scale-105"
          >
            <Bookmark className="h-4 w-4" />
            Browse library
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 sm:gap-x-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
          {items.map((m) => (
            <MediaCard key={m.id} media={m} onOpen={onOpen} onPlay={onPlay} variant="grid" className="w-full" />
          ))}
        </div>
      )}
    </div>
  );
}
