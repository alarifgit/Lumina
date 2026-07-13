"use client";

import { useState } from "react";
import { Info, Play, Star } from "lucide-react";
import type { MediaSummary } from "@/lib/types";
import { ProceduralPoster } from "./procedural-poster";
import { cn } from "@/lib/utils";

interface Props {
  items: MediaSummary[];
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
}

function FeatureArtwork({ item }: { item: MediaSummary }) {
  const [failed, setFailed] = useState(false);
  const src = item.backdropUrl || item.posterUrl;

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover/tile:scale-[1.025]"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <ProceduralPoster
      title={item.title}
      genres={item.genres}
      variant="backdrop"
      className="h-full w-full"
    />
  );
}

function FeatureTile({
  item,
  secondary,
  onOpen,
  onPlay,
}: {
  item: MediaSummary;
  secondary?: boolean;
  onOpen: Props["onOpen"];
  onPlay: Props["onPlay"];
}) {
  return (
    <article
      className={cn(
        "group/tile relative min-h-[360px] overflow-hidden rounded-lg bg-[#1b303b] shadow-[0_24px_70px_rgba(15,34,44,0.25)] ring-1 ring-white/14",
        secondary
          ? "hidden xl:block xl:min-h-[clamp(430px,24vw,680px)]"
          : "lg:min-h-[400px] xl:min-h-[clamp(500px,28vw,760px)]"
      )}
    >
      <div className="absolute inset-0">
        <FeatureArtwork item={item} />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(7,23,32,0.88)_0%,rgba(7,23,32,0.46)_48%,rgba(7,23,32,0.08)_78%),linear-gradient(180deg,transparent_34%,rgba(7,23,32,0.78)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 z-10 p-6 sm:p-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium text-white/72">
          <span>{item.type === "TV" ? "Series" : "Movie"}</span>
          {item.year && <span>· {item.year}</span>}
          {item.rating != null && (
            <span className="inline-flex items-center gap-1">
              <Star className="h-3 w-3 fill-primary text-primary" />
              {item.rating.toFixed(1)}
            </span>
          )}
        </div>
        <h1
          className={cn(
            "max-w-[16ch] text-balance font-semibold leading-[0.98] tracking-[-0.045em] text-white",
            secondary
              ? "text-3xl sm:text-4xl 2xl:text-5xl"
              : "text-4xl sm:text-5xl lg:text-6xl 2xl:text-7xl"
          )}
        >
          {item.title}
        </h1>
        {item.tagline && (
          <p className="mt-3 line-clamp-2 max-w-md text-sm leading-6 text-white/68">
            {item.tagline}
          </p>
        )}
        <div className="mt-6 flex items-center gap-4">
          <button
            onClick={() =>
              onPlay(item.id, item.progressEpisodeId ?? null, item.progressPosition ?? 0)
            }
            className="inline-flex items-center gap-3 text-sm font-semibold text-white transition-opacity hover:opacity-80"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[var(--lumina-ink)] shadow-[0_10px_26px_rgba(7,23,32,0.28)] transition-transform hover:scale-105 active:scale-95">
              <Play className="ml-0.5 h-4 w-4 fill-current" />
            </span>
            {item.progressPercent ? "Resume" : "Play now"}
          </button>
          <button
            onClick={() => onOpen(item.id)}
            className="inline-flex items-center gap-2 text-sm font-medium text-white/66 transition-colors hover:text-white"
          >
            <Info className="h-4 w-4" />
            Details
          </button>
        </div>
      </div>
    </article>
  );
}

export function HeroCarousel({ items, onOpen, onPlay }: Props) {
  const featured = items.slice(0, 2);
  if (!featured.length) return null;

  return (
    <section className="lumina-page relative px-4 pt-20 sm:px-6 lg:px-8 min-[2200px]:pt-24" aria-label="Featured titles">
      <div className="pointer-events-none absolute inset-x-12 bottom-0 top-28 -z-10 rounded-[40%] bg-white/12 blur-3xl" />
      <div
        className={cn(
          "grid gap-4",
          featured.length > 1 && "xl:grid-cols-[1.08fr_0.92fr] xl:items-end"
        )}
      >
        <FeatureTile item={featured[0]} onOpen={onOpen} onPlay={onPlay} />
        {featured[1] && (
          <FeatureTile item={featured[1]} secondary onOpen={onOpen} onPlay={onPlay} />
        )}
      </div>
    </section>
  );
}
