"use client";

import { useEffect, useRef } from "react";
import { Search as SearchIcon, X } from "lucide-react";
import { useMediaStore } from "@/store/media-store";
import { useSearch } from "@/lib/queries";
import { MediaCard } from "./media-card";
import { GridSkeleton } from "./skeletons";
import { LogoEmblem } from "./logo";

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
    <div className="lumina-page px-4 pb-10 pt-20 sm:px-6 lg:px-8">
      <div className="lumina-panel mx-auto mb-7 max-w-3xl rounded-2xl p-3 shadow-[0_32px_90px_rgba(0,0,0,0.38)]">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-foreground/50" />
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search titles, shows, episodes, collections..."
            className="h-14 w-full rounded-xl border border-[var(--line-soft)] bg-[#08111d]/72 pl-12 pr-12 text-base text-foreground placeholder:text-foreground/40 focus:border-[var(--lumina-gold)]/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-[rgba(238,209,132,0.18)]"
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
        <div className="mt-3 flex flex-wrap gap-2 px-1 text-xs text-foreground/46">
          <span className="rounded-full border border-[var(--line-soft)] px-2.5 py-1">Movies</span>
          <span className="rounded-full border border-[var(--line-soft)] px-2.5 py-1">TV Shows</span>
          <span className="rounded-full border border-[var(--line-soft)] px-2.5 py-1">Episodes</span>
          <span className="rounded-full border border-[var(--line-soft)] px-2.5 py-1">Settings</span>
        </div>
      </div>

      {!q ? (
        <div className="lumina-panel mx-auto flex max-w-xl flex-col items-center justify-center rounded-xl px-6 py-20 text-center">
          <LogoEmblem size={82} className="mb-3 opacity-80" />
          <h2 className="lumina-title text-3xl font-semibold">Find a title by its light.</h2>
          <p className="mt-1 text-sm text-foreground/60">
            Search across movies, shows, episodes, and collections.
          </p>
        </div>
      ) : isLoading || isFetching ? (
        <GridSkeleton count={12} />
      ) : data && data.items.length > 0 ? (
        <>
          <p className="mb-4 text-sm text-foreground/50">
            {data.items.length} result{data.items.length === 1 ? "" : "s"} for “{q}”
          </p>
          <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 sm:gap-x-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
            {data.items.map((m) => (
              <MediaCard key={m.id} media={m} onOpen={onOpen} onPlay={onPlay} variant="grid" className="w-full" />
            ))}
          </div>
        </>
      ) : (
        <div className="lumina-panel mx-auto flex max-w-xl flex-col items-center justify-center rounded-xl px-6 py-20 text-center">
          <SearchIcon className="mb-3 h-12 w-12 text-foreground/30" />
          <p className="text-sm text-foreground/60">
            No matches for “{q}”. Try a different title.
          </p>
        </div>
      )}
    </div>
  );
}
