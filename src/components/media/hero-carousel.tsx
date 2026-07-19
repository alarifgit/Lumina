"use client";

import { useState } from "react";
import { Info, Play, Sparkles, Star } from "lucide-react";
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
        className="h-full w-full scale-[1.01] object-cover brightness-[0.9] contrast-[1.03] saturate-[0.82] transition-[transform,filter] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/tile:scale-[1.035] group-hover/tile:brightness-[0.94] group-hover/tile:saturate-[0.9]"
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
  index,
  total,
  onOpen,
  onPlay,
}: {
  item: MediaSummary;
  secondary?: boolean;
  index: number;
  total: number;
  onOpen: Props["onOpen"];
  onPlay: Props["onPlay"];
}) {
  return (
    <article
      className={cn(
        "lumina-hero-frame film-grain group/tile relative min-h-[300px] overflow-hidden rounded-lg bg-[#1b303b] ring-1 ring-white/18",
        secondary
          ? "hidden xl:block xl:min-h-0"
          : "lg:min-h-[380px] xl:min-h-[clamp(440px,25vw,650px)] xl:row-span-2"
      )}
    >
      <div className="absolute inset-0">
        <FeatureArtwork item={item} />
      </div>
      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          secondary
            ? "bg-[radial-gradient(circle_at_74%_24%,rgba(244,204,139,0.13),transparent_32%),linear-gradient(180deg,rgba(7,23,32,0.08)_12%,rgba(7,23,32,0.9)_100%)]"
            : "bg-[radial-gradient(circle_at_72%_35%,rgba(244,204,139,0.13),transparent_28%),linear-gradient(90deg,rgba(7,23,32,0.94)_0%,rgba(7,23,32,0.52)_48%,rgba(7,23,32,0.08)_78%),linear-gradient(180deg,transparent_24%,rgba(7,23,32,0.88)_100%)]"
        )}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 hidden items-center justify-end p-4 text-[10px] font-semibold tracking-[0.18em] text-white/52 tabular-nums sm:p-5 xl:flex">
        <span>{String(index + 1).padStart(2, "0")}</span>
        <span className="mx-2 h-px w-5 bg-primary/55" />
        <span>{String(total).padStart(2, "0")}</span>
      </div>
      <div className={cn("absolute inset-x-0 bottom-0 z-10", secondary ? "p-5" : "p-6 sm:p-8")}>
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-[var(--lumina-ink)]/78 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-primary backdrop-blur-xl">
          <Sparkles className="h-3 w-3" /> Featured
        </div>
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
              ? "text-2xl 2xl:text-3xl"
              : "text-4xl sm:text-5xl lg:text-6xl"
          )}
        >
          {item.title}
        </h1>
        {!secondary && item.tagline && (
          <p className="mt-3 line-clamp-2 max-w-md text-sm leading-6 text-white/68">
            {item.tagline}
          </p>
        )}
        <div className={cn("flex items-center gap-4", secondary ? "mt-4" : "mt-6")}>
          <button
            onClick={() =>
              onPlay(item.id, item.progressEpisodeId ?? null, item.progressPosition ?? 0)
            }
            className="group/play inline-flex items-center gap-3 text-sm font-semibold text-white transition-opacity duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:opacity-[0.86]"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[var(--lumina-ink)] shadow-[0_10px_26px_rgba(7,23,32,0.28)] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/play:scale-105 group-hover/play:translate-x-0.5 active:scale-95">
              <Play className="ml-0.5 h-4 w-4 fill-current" />
            </span>
            {item.progressPercent ? "Resume" : "Play now"}
          </button>
          <button
            onClick={() => onOpen(item.id)}
            className="inline-flex items-center gap-2 text-sm font-medium text-white/66 transition-[color,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:translate-x-0.5 hover:text-white"
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
  const featured = items.slice(0, 3);
  if (!featured.length) return null;

  return (
    <section className="lumina-page lumina-reveal relative px-4 pt-20 sm:px-6 lg:px-8 min-[2200px]:pt-24" aria-label="Featured titles">
      <div className="pointer-events-none absolute inset-x-12 bottom-[-8%] top-24 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(224,236,241,0.13),transparent_68%)]" />
      <div
        className={cn(
          "grid gap-3",
          featured.length > 1 && "xl:grid-cols-[1.35fr_0.65fr] xl:grid-rows-2"
        )}
      >
        <FeatureTile item={featured[0]} index={0} total={featured.length} onOpen={onOpen} onPlay={onPlay} />
        {featured[1] && (
          <FeatureTile item={featured[1]} secondary index={1} total={featured.length} onOpen={onOpen} onPlay={onPlay} />
        )}
        {featured[2] && (
          <FeatureTile item={featured[2]} secondary index={2} total={featured.length} onOpen={onOpen} onPlay={onPlay} />
        )}
      </div>
    </section>
  );
}
