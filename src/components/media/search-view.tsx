"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { LoaderCircle, RefreshCw, Search as SearchIcon, X } from "lucide-react";
import { useMediaStore } from "@/store/media-store";
import { useSearch } from "@/lib/queries";
import { cn } from "@/lib/utils";
import {
  SearchEpisodeResultCard,
  SearchMediaResultCard,
  type SearchGroupKey,
} from "./search-result-card";

interface Props {
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
}

type SearchScope = "all" | SearchGroupKey;

const GROUP_ORDER: SearchGroupKey[] = ["movies", "shows", "episodes"];

function useDebouncedValue(value: string, delayMs: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}

function SearchSkeleton() {
  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-3 lg:grid-cols-2" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="lumina-panel flex h-32 animate-pulse gap-3 rounded-lg p-2.5">
          <div className="aspect-[2/3] h-full rounded-md bg-white/[0.08]" />
          <div className="flex flex-1 flex-col justify-center gap-3">
            <div className="h-2.5 w-20 rounded-full bg-white/[0.08]" />
            <div className="h-4 w-2/3 rounded-full bg-white/[0.1]" />
            <div className="h-2.5 w-1/3 rounded-full bg-white/[0.07]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function GroupSection({
  id,
  title,
  displayed,
  total,
  children,
}: {
  id: string;
  title: string;
  displayed: number;
  total: number;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="scroll-mt-24">
      <div className="mb-3 flex items-end justify-between gap-4 border-b border-white/[0.09] pb-3">
        <div>
          <p className="label-eyebrow text-primary/84">Library matches</p>
          <h2 id={id} className="lumina-title mt-1 text-2xl font-semibold">
            {title}
          </h2>
        </div>
        <p className="shrink-0 text-xs tabular-nums text-white/42">
          Showing {displayed} of {total}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{children}</div>
    </section>
  );
}

export function SearchView({ onOpen, onPlay }: Props) {
  const searchQuery = useMediaStore((state) => state.searchQuery);
  const setSearchQuery = useMediaStore((state) => state.setSearchQuery);
  const closeSearch = useMediaStore((state) => state.closeSearch);
  const [scope, setScope] = useState<SearchScope>("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const q = searchQuery.trim();
  const debouncedQuery = useDebouncedValue(q, 220);
  const { data, error, isError, isFetching, isLoading, refetch } = useSearch(debouncedQuery);
  const pendingInput = q !== debouncedQuery;
  const displayedData =
    !pendingInput && data?.query.trim() === debouncedQuery ? data : undefined;

  useEffect(() => {
    const focusSearch = () => inputRef.current?.focus();
    focusSearch();
    window.addEventListener("lumina:focus-search", focusSearch);
    return () => window.removeEventListener("lumina:focus-search", focusSearch);
  }, []);

  const groupLengths = useMemo(
    () => ({
      movies: displayedData?.groups.movies.items.length ?? 0,
      shows: displayedData?.groups.shows.items.length ?? 0,
      episodes: displayedData?.groups.episodes.items.length ?? 0,
    }),
    [displayedData]
  );

  const visibleGroups = useMemo(
    () =>
      scope === "all"
        ? GROUP_ORDER.filter((key) => groupLengths[key] > 0)
        : groupLengths[scope] > 0
          ? [scope]
          : [],
    [groupLengths, scope]
  );

  const focusResult = (group: SearchGroupKey, index: number) => {
    resultsRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-search-result][data-search-group="${group}"][data-search-index="${index}"]`
      )
      ?.focus();
  };

  const handleResultKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    group: SearchGroupKey,
    index: number
  ) => {
    const groupPosition = visibleGroups.indexOf(group);
    let targetGroup = group;
    let targetIndex = index;

    if (event.key === "ArrowRight") {
      targetIndex = Math.min(index + 1, groupLengths[group] - 1);
    } else if (event.key === "ArrowLeft") {
      targetIndex = Math.max(index - 1, 0);
    } else if (event.key === "Home") {
      targetIndex = 0;
    } else if (event.key === "End") {
      targetIndex = Math.max(groupLengths[group] - 1, 0);
    } else if (event.key === "ArrowDown" && groupPosition < visibleGroups.length - 1) {
      targetGroup = visibleGroups[groupPosition + 1];
      targetIndex = Math.min(index, groupLengths[targetGroup] - 1);
    } else if (event.key === "ArrowUp" && groupPosition > 0) {
      targetGroup = visibleGroups[groupPosition - 1];
      targetIndex = Math.min(index, groupLengths[targetGroup] - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      inputRef.current?.focus();
      return;
    } else {
      return;
    }

    event.preventDefault();
    focusResult(targetGroup, targetIndex);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && visibleGroups.length > 0) {
      event.preventDefault();
      focusResult(visibleGroups[0], 0);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (searchQuery) {
        setScope("all");
        setSearchQuery("");
      } else {
        closeSearch();
      }
    }
  };

  const totals = {
    all: displayedData?.total ?? 0,
    movies: displayedData?.groups.movies.total ?? 0,
    shows: displayedData?.groups.shows.total ?? 0,
    episodes: displayedData?.groups.episodes.total ?? 0,
  };
  const selectedTotal = totals[scope];
  const showLoading = !!q && (pendingInput || (isLoading && !displayedData));
  const refreshing = !!displayedData && isFetching;

  const scopes: { key: SearchScope; label: string }[] = [
    { key: "all", label: "All" },
    { key: "movies", label: "Movies" },
    { key: "shows", label: "TV Shows" },
    { key: "episodes", label: "Episodes" },
  ];

  return (
    <div className="lumina-page px-4 pb-14 pt-20 sm:px-6 lg:px-8 min-[2200px]:pt-24">
      <div className="lumina-panel mx-auto mb-8 max-w-4xl rounded-lg p-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/48" />
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search movies, shows, and episodes…"
            className="h-14 w-full rounded-lg border border-white/12 bg-[var(--lumina-ink)]/72 pl-12 pr-12 text-base text-white placeholder:text-white/40 focus:border-white/28 focus:bg-[var(--lumina-ink)]/84 focus:outline-none focus:ring-2 focus:ring-primary/35"
            aria-label="Search your library"
            aria-controls="search-results"
            aria-busy={showLoading || refreshing}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setScope("all");
                setSearchQuery("");
                inputRef.current?.focus();
              }}
              className="absolute right-4 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-white/48 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
          {scopes.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setScope(item.key)}
              aria-pressed={scope === item.key}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80",
                scope === item.key
                  ? "border-white/18 bg-white/[0.14] text-white"
                  : "border-white/10 bg-white/[0.035] text-white/54 hover:bg-white/[0.08] hover:text-white/82"
              )}
            >
              {item.label}
              <span className="tabular-nums text-[10px] text-current opacity-60">
                {displayedData ? totals[item.key] : "—"}
              </span>
            </button>
          ))}
          {refreshing && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-white/42">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Refreshing
            </span>
          )}
        </div>
      </div>

      <div
        id="search-results"
        ref={resultsRef}
        className="mx-auto max-w-7xl"
        aria-busy={showLoading || refreshing}
      >
        <p className="sr-only" aria-live="polite">
          {displayedData
            ? `${displayedData.total} results for ${displayedData.query}`
            : showLoading
              ? `Searching for ${q}`
              : ""}
        </p>

        {!q ? (
          <div className="lumina-panel mx-auto flex max-w-xl flex-col items-center justify-center rounded-lg px-6 py-20 text-center">
            <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/14 bg-[var(--lumina-ink)]/72 text-white/78">
              <SearchIcon className="h-6 w-6" />
            </span>
            <h1 className="lumina-title text-3xl font-semibold">Find something worth watching.</h1>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-white/56">
              Search your locally playable movies, TV shows, and individual episodes.
            </p>
            <p className="mt-5 text-xs text-white/34">Press Esc to return to your previous view.</p>
          </div>
        ) : showLoading ? (
          <SearchSkeleton />
        ) : isError ? (
          <div className="lumina-panel mx-auto flex max-w-xl flex-col items-center justify-center rounded-lg px-6 py-16 text-center" role="alert">
            <SearchIcon className="mb-4 h-10 w-10 text-white/30" />
            <h2 className="lumina-title text-2xl font-semibold">Search could not finish.</h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-white/54">
              {error instanceof Error ? error.message : "Lumina could not query the library."}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-[var(--lumina-ink)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#102a37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80"
            >
              <RefreshCw className="h-4 w-4" /> Retry
            </button>
          </div>
        ) : displayedData && displayedData.total === 0 ? (
          <div className="lumina-panel mx-auto flex max-w-xl flex-col items-center justify-center rounded-lg px-6 py-20 text-center">
            <SearchIcon className="mb-3 h-11 w-11 text-white/28" />
            <h2 className="lumina-title text-2xl font-semibold">No playable matches</h2>
            <p className="mt-2 text-sm text-white/56">
              Nothing in Movies, TV Shows, or Episodes matched “{displayedData.query}”.
            </p>
          </div>
        ) : displayedData && selectedTotal === 0 ? (
          <div className="lumina-panel mx-auto flex max-w-xl flex-col items-center justify-center rounded-lg px-6 py-16 text-center">
            <SearchIcon className="mb-3 h-10 w-10 text-white/28" />
            <h2 className="lumina-title text-2xl font-semibold">No {scopes.find((item) => item.key === scope)?.label} matches</h2>
            <p className="mt-2 text-sm text-white/56">
              Other result types are available above for “{displayedData.query}”.
            </p>
          </div>
        ) : displayedData ? (
          <div className={cn("space-y-10 transition-opacity", refreshing && "opacity-72")}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="label-eyebrow text-white/42">Search results</p>
                <h1 className="lumina-title mt-1 text-3xl font-semibold sm:text-4xl">
                  “{displayedData.query}”
                </h1>
              </div>
              <p className="text-sm tabular-nums text-white/48">
                {selectedTotal} match{selectedTotal === 1 ? "" : "es"}
              </p>
            </div>

            {(scope === "all" || scope === "movies") &&
              displayedData.groups.movies.items.length > 0 && (
                <GroupSection
                  id="search-movies-heading"
                  title="Movies"
                  displayed={displayedData.groups.movies.items.length}
                  total={displayedData.groups.movies.total}
                >
                  {displayedData.groups.movies.items.map((media, index) => (
                    <SearchMediaResultCard
                      key={media.id}
                      media={media}
                      group="movies"
                      index={index}
                      onOpen={onOpen}
                      onPlay={onPlay}
                      onNavigate={handleResultKeyDown}
                    />
                  ))}
                </GroupSection>
              )}

            {(scope === "all" || scope === "shows") &&
              displayedData.groups.shows.items.length > 0 && (
                <GroupSection
                  id="search-shows-heading"
                  title="TV Shows"
                  displayed={displayedData.groups.shows.items.length}
                  total={displayedData.groups.shows.total}
                >
                  {displayedData.groups.shows.items.map((media, index) => (
                    <SearchMediaResultCard
                      key={media.id}
                      media={media}
                      group="shows"
                      index={index}
                      onOpen={onOpen}
                      onPlay={onPlay}
                      onNavigate={handleResultKeyDown}
                    />
                  ))}
                </GroupSection>
              )}

            {(scope === "all" || scope === "episodes") &&
              displayedData.groups.episodes.items.length > 0 && (
                <GroupSection
                  id="search-episodes-heading"
                  title="Episodes"
                  displayed={displayedData.groups.episodes.items.length}
                  total={displayedData.groups.episodes.total}
                >
                  {displayedData.groups.episodes.items.map((episode, index) => (
                    <SearchEpisodeResultCard
                      key={episode.id}
                      episode={episode}
                      group="episodes"
                      index={index}
                      onOpen={onOpen}
                      onPlay={onPlay}
                      onNavigate={handleResultKeyDown}
                    />
                  ))}
                </GroupSection>
              )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
