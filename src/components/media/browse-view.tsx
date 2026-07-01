"use client";

import { useEffect, useState } from "react";
import { useBrowseInfinite, useGenres } from "@/lib/queries";
import { useMediaStore } from "@/store/media-store";
import { MediaCard } from "./media-card";
import { GridSkeleton } from "./skeletons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, AlertCircle } from "lucide-react";
import type { MediaType } from "@/lib/types";

interface Props {
  type?: MediaType;
  title: string;
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
}

const SORTS = [
  { value: "popular", label: "Most Popular" },
  { value: "rating", label: "Highest Rated" },
  { value: "year", label: "Newest" },
  { value: "title", label: "A–Z" },
];

export function BrowseView({ type, title, onOpen, onPlay }: Props) {
  // Sync local genre with the global store (set when picking from the nav dropdown)
  const storeGenre = useMediaStore((s) => s.genreFilter);
  const [genre, setGenre] = useState<string | null>(storeGenre);
  const [sort, setSort] = useState("popular");
  const { data: genres } = useGenres();

  // When the store genre changes (from nav dropdown), update local state
  useEffect(() => {
    setGenre(storeGenre);
  }, [storeGenre]);

  const query = useBrowseInfinite({ type, genre, sort, pageSize: 24 });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  const hasMore = !!query.hasNextPage;

  return (
    <div className="px-4 pb-10 pt-20 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
            {genre ? genre : title}
          </h1>
          <p className="mt-1 text-sm text-foreground/50">
            {total} {total === 1 ? "title" : "titles"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={genre ?? "all"} onValueChange={(v) => setGenre(v === "all" ? null : v)}>
            <SelectTrigger className="h-9 w-36 sm:w-44">
              <SelectValue placeholder="Genre" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Genres</SelectItem>
              {(genres ?? []).map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-9 w-36 sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {query.isLoading ? (
        <GridSkeleton />
      ) : query.error ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle className="mb-3 h-10 w-10 text-foreground/40" />
          <p className="text-sm text-foreground/70">Couldn't load titles.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm text-foreground/60">No titles found.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {items.map((m) => (
              <MediaCard key={m.id} media={m} onOpen={onOpen} onPlay={onPlay} className="w-full" />
            ))}
          </div>
          {hasMore && (
            <div className="mt-8 flex justify-center">
              <button
                onClick={() => query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
                className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-foreground/5 px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-foreground/10 disabled:opacity-50"
              >
                {query.isFetchingNextPage ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </>
                ) : (
                  "Load More"
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
