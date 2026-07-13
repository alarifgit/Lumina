"use client";

import { useState } from "react";
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
import { Loader2, AlertCircle, Play, Plus } from "lucide-react";
import type { MediaSummary, MediaType } from "@/lib/types";
import { formatRuntime } from "@/lib/media-utils";
import { cn } from "@/lib/utils";

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

  const query = useBrowseInfinite({ type, genre, sort, pageSize: 24 });

  const pages = (query.data?.pages ?? []) as {
    items: MediaSummary[];
    total: number;
    page: number;
    pageSize: number;
  }[];
  const items = pages.flatMap((p) => p.items);
  const total = pages[0]?.total ?? 0;
  const hasMore = !!query.hasNextPage;
  const featured = items[0] ?? null;

  return (
    <div className="lumina-page px-4 pb-10 pt-20 sm:px-6 lg:px-8 min-[2200px]:pt-24">
      {featured ? (
        <BrowseFeature
          item={featured}
          title={genre ? genre : title}
          total={total}
          onOpen={onOpen}
          onPlay={onPlay}
        />
      ) : (
        <div className="mb-5">
          <p className="label-eyebrow mb-2 text-primary/90">Browse</p>
          <h1 className="lumina-title text-4xl font-bold sm:text-5xl">
            {genre ? genre : title}
          </h1>
          <p className="mt-1 text-sm text-foreground/50">
            {total} {total === 1 ? "title" : "titles"}
          </p>
        </div>
      )}

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          <FilterChip active={!genre} onClick={() => setGenre(null)}>
            All {type === "TV" ? "Shows" : type === "MOVIE" ? "Movies" : "Titles"}
          </FilterChip>
          <FilterChip active={sort === "year"} onClick={() => setSort("year")}>
            New releases
          </FilterChip>
          <FilterChip active={sort === "rating"} onClick={() => setSort("rating")}>
            Critically acclaimed
          </FilterChip>
          <FilterChip active={sort === "popular"} onClick={() => setSort("popular")}>
            Most popular
          </FilterChip>
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
          <div className="lumina-media-grid">
            {items.map((m) => (
              <MediaCard key={m.id} media={m} onOpen={onOpen} onPlay={onPlay} variant="grid" className="w-full" />
            ))}
          </div>
          {hasMore && (
            <div className="mt-8 flex justify-center">
              <button
                onClick={() => query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-white/[0.04] px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-white/10 disabled:opacity-50"
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

function BrowseFeature({
  item,
  title,
  total,
  onOpen,
  onPlay,
}: {
  item: MediaSummary;
  title: string;
  total: number;
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
}) {
  const backdrop = item.backdropUrl || item.posterUrl || "/brand/hero-1.png";
  return (
    <section
      data-lumina-frame="true"
      className="lumina-panel relative mb-6 min-h-[330px] overflow-hidden rounded-lg lg:min-h-[clamp(330px,22vw,620px)]"
    >
      <img
        src={backdrop}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.92)_0%,rgba(0,0,0,0.62)_42%,rgba(0,0,0,0.08)_74%,rgba(0,0,0,0.46)_100%),linear-gradient(180deg,rgba(0,0,0,0.05)_0%,rgba(0,0,0,0.72)_100%)]" />
      <div className="relative flex min-h-[310px] flex-col justify-end p-5 sm:p-7 lg:min-h-[clamp(330px,22vw,620px)]">
        <div className="max-w-2xl">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-[var(--lumina-ink)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white">
              Spotlight
            </span>
            <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-foreground/70 ring-1 ring-white/12">
              {total.toLocaleString()} {total === 1 ? "title" : "titles"}
            </span>
          </div>
          <p className="label-eyebrow mb-2 text-primary/90">{title}</p>
          <h1 className="lumina-title text-shadow-lg text-5xl font-bold leading-[0.95] sm:text-6xl lg:text-7xl">
            {item.title}
          </h1>
          {item.overview && (
            <p className="mt-3 line-clamp-3 max-w-xl text-sm leading-6 text-foreground/72">
              {item.overview}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground/74 tabular-nums">
            {item.year && <span>{item.year}</span>}
            {item.runtime && <span>{formatRuntime(item.runtime)}</span>}
            {item.certification && (
              <span className="rounded border border-white/25 px-1.5 py-0 text-[11px] font-semibold">
                {item.certification}
              </span>
            )}
            {item.genres.slice(0, 3).map((g) => (
              <span key={g}>{g}</span>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={() => onPlay(item.id, item.progressEpisodeId ?? null, item.progressPosition ?? 0)}
              className="lumina-button-primary inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold transition-transform hover:scale-[1.03]"
            >
              <Play className="h-4 w-4 fill-current" />
              {item.progressPercent ? "Resume" : "Play"}
            </button>
            <button
              onClick={() => onOpen(item.id)}
              className="lumina-button-secondary inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition-colors hover:bg-white/[0.12]"
            >
              <Plus className="h-4 w-4" />
              More info
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function FilterChip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors",
        active
          ? "border-white/24 bg-white/16 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]"
          : "border-white/10 bg-white/[0.065] text-foreground/68 hover:bg-white/[0.12] hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
