"use client";

import { Bookmark, Plus } from "lucide-react";
import { useMyList } from "@/lib/queries";
import { MediaCard } from "./media-card";
import { GridSkeleton } from "./skeletons";
import { useMediaStore } from "@/store/media-store";

interface Props {
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
}

export function MyListView({ onOpen, onPlay }: Props) {
  const { data, isLoading } = useMyList();
  const setRoute = useMediaStore((s) => s.setRoute);
  const items = data?.items ?? [];

  return (
    <div className="px-4 pb-10 pt-20 sm:px-6 lg:px-8">
      <div className="mb-5">
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">My List</h1>
        <p className="mt-1 text-sm text-foreground/50">
          {items.length} saved {items.length === 1 ? "title" : "titles"}
        </p>
      </div>

      {isLoading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-foreground/5">
            <Bookmark className="h-8 w-8 text-foreground/40" />
          </div>
          <h3 className="text-lg font-semibold">Your list is empty</h3>
          <p className="mt-1 max-w-sm text-sm text-foreground/60">
            Add movies and shows to your list with the{" "}
            <Plus className="inline h-3.5 w-3.5" /> button — they’ll show up here for quick access.
          </p>
          <button
            onClick={() => setRoute("home")}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-transform hover:scale-105"
          >
            Browse library
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((m) => (
            <MediaCard key={m.id} media={m} onOpen={onOpen} onPlay={onPlay} className="w-full" />
          ))}
        </div>
      )}
    </div>
  );
}
