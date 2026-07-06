"use client";

import {
  Clapperboard,
  Diamond,
  Film,
  Globe2,
  Languages,
  LayoutGrid,
  Moon,
  Sparkles,
  Stars,
} from "lucide-react";
import { useBrowse, useGenres } from "@/lib/queries";
import { useMediaStore } from "@/store/media-store";
import { MediaCard } from "./media-card";
import { GridSkeleton } from "./skeletons";
import { cn } from "@/lib/utils";

interface Props {
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
}

const browseCards = [
  { title: "Genre", count: "Browse shelves", icon: LayoutGrid },
  { title: "Mood", count: "Late night, family, comfort", icon: Moon },
  { title: "Collections", count: "Curated sets", icon: Clapperboard },
  { title: "Language", count: "Original audio and subtitles", icon: Languages },
  { title: "Quality", count: "4K, HDR, Atmos", icon: Diamond },
  { title: "Decade", count: "By release era", icon: Globe2 },
];

const smartCollections = [
  "Trending this week",
  "Hidden gems",
  "Critically acclaimed",
  "Recently added",
  "Continue watching",
  "4K showcase",
  "Unwatched",
  "Family night",
];

export function CategoryView({ onOpen, onPlay }: Props) {
  const genreFilter = useMediaStore((s) => s.genreFilter);
  const setGenreFilter = useMediaStore((s) => s.setGenreFilter);
  const { data: genres, isLoading: genresLoading } = useGenres();
  const selectedGenre = genreFilter ?? genres?.[0] ?? null;
  const browse = useBrowse({
    genre: selectedGenre,
    page: 1,
    pageSize: 14,
    sort: "popular",
    enabled: !!selectedGenre,
  });

  return (
    <div className="lumina-page px-4 pb-12 pt-20 sm:px-6 lg:px-8">
      <section className="lumina-panel film-grain relative mb-7 overflow-hidden rounded-xl p-5 sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_0%,rgba(238,209,132,0.16),transparent_26%),radial-gradient(circle_at_18%_100%,rgba(12,26,45,0.78),transparent_38%)]" />
        <div className="relative max-w-3xl">
          <p className="label-eyebrow mb-2 text-primary/90">Discover</p>
          <h1 className="lumina-title text-5xl font-semibold leading-none sm:text-7xl">
            Categories
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground/68 sm:text-base">
            Browse your private cinema by genre, mood, language, quality, decade, and smart
            collections built from the library Lumina already knows about.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="lumina-title text-2xl font-semibold sm:text-3xl">Browse by</h2>
          <button className="hidden rounded-full border border-[var(--line-soft)] px-4 py-2 text-sm font-semibold text-foreground/70 transition-colors hover:border-primary/40 hover:text-primary sm:inline-flex">
            Refine preferences
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {browseCards.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.title}
                className="group lumina-panel overflow-hidden rounded-xl p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_0_28px_rgba(238,209,132,0.12)]"
              >
                <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-full border border-primary/22 bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="font-semibold text-foreground">{card.title}</div>
                <div className="mt-1 text-xs leading-5 text-foreground/48">{card.count}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mb-8 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="lumina-title text-2xl font-semibold sm:text-3xl">Genre cards</h2>
          </div>
          {genresLoading ? (
            <GridSkeleton count={8} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {(genres ?? []).slice(0, 12).map((genre, index) => (
                <button
                  key={genre}
                  onClick={() => setGenreFilter(genre)}
                  className={cn(
                    "group relative min-h-28 overflow-hidden rounded-xl border p-4 text-left transition-all",
                    selectedGenre === genre
                      ? "border-primary/55 bg-primary/12"
                      : "border-[var(--line-soft)] bg-[#0c1a2d]/62 hover:border-primary/35"
                  )}
                >
                  <div
                    className="absolute inset-0 opacity-70"
                    style={{
                      background: `radial-gradient(circle at ${24 + (index % 5) * 14}% 10%, rgba(238,209,132,0.16), transparent 32%), linear-gradient(135deg, rgba(16,34,58,0.74), rgba(3,4,5,0.82))`,
                    }}
                  />
                  <div className="relative flex min-h-20 flex-col justify-end">
                    <div className="text-lg font-semibold text-foreground">{genre}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.12em] text-foreground/44">
                      Open shelf
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="lumina-panel rounded-xl p-5">
          <div className="mb-4 flex items-center gap-2">
            <Stars className="h-5 w-5 text-primary" />
            <h2 className="lumina-title text-2xl font-semibold">Smart collections</h2>
          </div>
          <div className="space-y-2">
            {smartCollections.map((label) => (
              <button
                key={label}
                className="flex w-full items-center justify-between rounded-lg border border-[var(--line-soft)] bg-white/[0.035] px-3 py-2.5 text-left text-sm font-semibold text-foreground/76 transition-colors hover:border-primary/36 hover:bg-primary/8 hover:text-foreground"
              >
                <span>{label}</span>
                <Film className="h-4 w-4 text-primary/70" />
              </button>
            ))}
          </div>
        </aside>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="label-eyebrow mb-1 text-primary/90">Selected shelf</p>
            <h2 className="lumina-title text-3xl font-semibold">
              {selectedGenre ?? "No category selected"}
            </h2>
          </div>
          {browse.data?.total != null && (
            <p className="text-sm text-foreground/50">
              {browse.data.total.toLocaleString()} titles
            </p>
          )}
        </div>
        {browse.isLoading ? (
          <GridSkeleton count={10} />
        ) : browse.data?.items.length ? (
          <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 sm:gap-x-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
            {browse.data.items.map((m) => (
              <MediaCard
                key={m.id}
                media={m}
                onOpen={onOpen}
                onPlay={onPlay}
                variant="grid"
                className="w-full"
              />
            ))}
          </div>
        ) : (
          <div className="lumina-panel rounded-xl px-6 py-12 text-center text-sm text-foreground/58">
            No titles found for this category yet.
          </div>
        )}
      </section>
    </div>
  );
}
