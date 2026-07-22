"use client";

import { useState } from "react";
import { useBrowseInfinite, useGenres } from "@/lib/queries";
import {
  useMediaStore,
  type BrowsePreferences,
  type BrowseTarget,
} from "@/store/media-store";
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
import type { BrowseSort, MediaSummary, WatchState } from "@/lib/types";
import { formatRuntime, playbackRequestForSummary } from "@/lib/media-utils";
import { cn } from "@/lib/utils";
import { ProceduralPoster } from "./procedural-poster";

interface Props {
  target: BrowseTarget;
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
}

const SORTS: { value: BrowseSort; label: string }[] = [
  { value: "popular", label: "Most Popular" },
  { value: "rating", label: "Highest Rated" },
  { value: "year", label: "Newest" },
  { value: "title", label: "A–Z" },
];

const WATCH_STATES: { value: WatchState; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unwatched", label: "Unwatched" },
  { value: "in-progress", label: "In progress" },
  { value: "watched", label: "Watched" },
];

export function BrowseView({ target, onOpen, onPlay }: Props) {
  const storedPreferences = useMediaStore((s) => s.browsePreferences[target.scope]);
  const updatePreferences = useMediaStore((s) => s.updateBrowsePreferences);
  const genre = storedPreferences?.genre ?? null;
  const sort = storedPreferences?.sort ?? (target.preset ? null : "popular");
  const watchState = storedPreferences?.watchState ?? "all";
  const { data: genres } = useGenres();
  const changePreferences = (updates: Partial<BrowsePreferences>) => {
    updatePreferences(target.scope, updates);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const query = useBrowseInfinite({
    type: target.type,
    preset: target.preset,
    genre,
    sort: sort ?? undefined,
    watchState,
    pageSize: 24,
  });

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
          title={genre ? genre : target.title}
          total={total}
          onOpen={onOpen}
          onPlay={onPlay}
        />
      ) : (
        <div className="mb-5">
          <p className="label-eyebrow mb-2 text-primary/90">{target.eyebrow ?? "Browse"}</p>
          <h1 className="lumina-title text-4xl font-bold sm:text-5xl">
            {genre ? genre : target.title}
          </h1>
          <p className="mt-1 text-sm text-foreground/50">
            {total} {total === 1 ? "title" : "titles"}
          </p>
        </div>
      )}

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="no-scrollbar flex gap-2 overflow-x-auto pb-1"
          role="group"
          aria-label="Watch state"
        >
          {WATCH_STATES.map((state) => (
            <FilterChip
              key={state.value}
              active={watchState === state.value}
              onClick={() => changePreferences({ watchState: state.value })}
            >
              {state.label}
            </FilterChip>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={genre ?? "all"}
            onValueChange={(value) =>
              changePreferences({ genre: value === "all" ? null : value })
            }
          >
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
          <Select
            value={sort ?? "shelf"}
            onValueChange={(value) =>
              changePreferences({
                sort: value === "shelf" ? null : (value as BrowseSort),
              })
            }
          >
            <SelectTrigger className="h-9 w-36 sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {target.preset && <SelectItem value="shelf">Shelf order</SelectItem>}
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
          <p className="text-sm text-foreground/60">
            No {watchState === "all"
              ? ""
              : `${WATCH_STATES.find((state) => state.value === watchState)?.label.toLowerCase()} `}
            titles found{genre ? ` in ${genre}` : ""}.
          </p>
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
  const [imageFailed, setImageFailed] = useState(false);
  const backdrop = item.backdropUrl || item.posterUrl || "/brand/hero-1.png";
  const playback = playbackRequestForSummary(item);
  return (
    <section
      data-lumina-frame="true"
      className="lumina-panel lumina-hero-frame film-grain lumina-reveal relative mb-7 min-h-[300px] overflow-hidden rounded-lg border-white/16 lg:min-h-[clamp(300px,19vw,500px)]"
    >
      {!imageFailed ? (
        <img
          src={backdrop}
          alt=""
          className="absolute inset-0 h-full w-full scale-[1.01] object-cover brightness-[0.9] contrast-[1.03] saturate-[0.8]"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <ProceduralPoster
          title={item.title}
          genres={item.genres}
          variant="backdrop"
          className="absolute inset-0 h-full w-full"
        />
      )}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_74%_30%,rgba(244,204,139,0.14),transparent_26%),linear-gradient(90deg,rgba(7,23,32,0.96)_0%,rgba(7,23,32,0.7)_41%,rgba(21,49,61,0.12)_73%,rgba(7,23,32,0.5)_100%),linear-gradient(180deg,rgba(81,111,124,0.08)_0%,rgba(7,23,32,0.84)_100%)]" />
      <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/10" />
      <div className="pointer-events-none absolute right-5 top-5 z-10 hidden items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/48 sm:right-7 sm:top-7 sm:flex">
        <span>Curated from your library</span>
        <span className="h-px w-7 bg-primary/55" />
      </div>
      <div className="relative flex min-h-[280px] flex-col justify-end p-5 sm:p-7 lg:min-h-[clamp(300px,19vw,500px)]">
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
          <h1 className="lumina-title text-shadow-lg text-4xl font-bold leading-[0.95] sm:text-5xl lg:text-6xl">
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
              onClick={() => onPlay(item.id, playback.episodeId, playback.startAt)}
              className="lumina-button-primary inline-flex items-center gap-2 rounded-md px-6 py-2.5 text-sm font-bold transition-colors"
            >
              <Play className="h-4 w-4 fill-current" />
              {item.progressPercent ? "Resume" : "Play"}
            </button>
            <button
              onClick={() => onOpen(item.id)}
              className="lumina-button-secondary inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-bold transition-colors hover:bg-white/[0.12]"
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
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
