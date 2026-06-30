"use client";

import { useEffect, useRef } from "react";
import { Search as SearchIcon, X } from "lucide-react";
import { useMediaStore } from "@/store/media-store";
import { useSearch } from "@/lib/queries";
import { MediaCard } from "./media-card";
import { GridSkeleton } from "./skeletons";

interface Props {
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
}

export function SearchView({ onOpen, onPlay }: Props) {
  const searchQuery = useMediaStore((s) => s.searchQuery);
  const setSearch = useMediaStore((s) => s.setSearch);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = searchQuery.trim();
  const { data, isLoading, isFetching } = useSearch(q);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="px-4 pb-10 pt-20 sm:px-6 lg:px-8">
      <div className="relative mx-auto mb-6 max-w-2xl">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-foreground/50" />
        <input
          ref={inputRef}
          value={searchQuery}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your library — titles, shows, movies…"
          className="h-14 w-full rounded-full border border-border/60 bg-foreground/5 pl-12 pr-12 text-base text-foreground placeholder:text-foreground/40 focus:border-primary/50 focus:bg-foreground/8 focus:outline-none focus:ring-1 focus:ring-primary/30"
          aria-label="Search your library"
        />
        {searchQuery && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-foreground/50 hover:text-foreground"
            aria-label="Clear"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {!q ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <SearchIcon className="mb-3 h-12 w-12 text-foreground/30" />
          <p className="text-sm text-foreground/60">
            Search across every movie and show in your library.
          </p>
        </div>
      ) : isLoading || isFetching ? (
        <GridSkeleton count={12} />
      ) : data && data.items.length > 0 ? (
        <>
          <p className="mb-4 text-sm text-foreground/50">
            {data.items.length} result{data.items.length === 1 ? "" : "s"} for “{q}”
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {data.items.map((m) => (
              <MediaCard key={m.id} media={m} onOpen={onOpen} onPlay={onPlay} className="w-full" />
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm text-foreground/60">
            No matches for “{q}”. Try a different title.
          </p>
        </div>
      )}
    </div>
  );
}
