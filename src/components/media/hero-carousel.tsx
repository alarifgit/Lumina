"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Play, Info, Plus, Check, Star } from "lucide-react";
import type { MediaSummary } from "@/lib/types";
import { ProceduralPoster } from "./procedural-poster";
import { useToggleMyList } from "@/lib/queries";
import { formatRuntime } from "@/lib/media-utils";
import { cn } from "@/lib/utils";

interface Props {
  items: MediaSummary[];
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
}

function HeroBackdrop({ item, index }: { item: MediaSummary; index: number }) {
  const [stage, setStage] = useState<number>(item.backdropUrl ? 0 : 1);
  const brand = `/brand/hero-${(index % 2) + 1}.png`;
  if (stage === 0 && item.backdropUrl) {
    return (
      <img
        src={item.backdropUrl}
        alt=""
        className="h-full w-full object-cover"
        onError={() => setStage(1)}
      />
    );
  }
  if (stage === 1) {
    return (
      <img
        src={brand}
        alt=""
        className="h-full w-full object-cover"
        onError={() => setStage(2)}
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

export function HeroCarousel({ items, onOpen, onPlay }: Props) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const toggle = useToggleMyList();

  useEffect(() => {
    if (paused || items.length <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % items.length), 8000);
    return () => clearInterval(t);
  }, [paused, items.length]);

  if (!items.length) return null;
  const item = items[index % items.length];

  return (
    <div
      className="relative h-[62vh] min-h-[440px] w-full overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
    >
      <AnimatePresence mode="sync">
        <motion.div
          key={index}
          initial={{ opacity: 0, scale: 1.03 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="absolute inset-0"
        >
          <HeroBackdrop item={item} index={index} />
        </motion.div>
      </AnimatePresence>

      {/* scrims */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/85 via-background/30 to-transparent" />

      {/* content */}
      <div className="absolute inset-x-0 bottom-0 px-4 pb-10 sm:px-6 sm:pb-12 lg:px-8">
        <div className="max-w-2xl">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
              Featured
            </span>
            <span className="rounded bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/70">
              {item.type === "TV" ? "Series" : "Film"}
            </span>
          </div>
          <h1 className="text-shadow-lg text-3xl font-black leading-[0.95] tracking-tight sm:text-5xl lg:text-6xl">
            {item.title}
          </h1>
          {item.tagline && (
            <p className="mt-3 text-sm italic text-foreground/70 sm:text-base">
              {item.tagline}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground/80">
            {item.year && <span className="font-medium">{item.year}</span>}
            {item.rating != null && (
              <span className="inline-flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-primary text-primary" />
                {item.rating.toFixed(1)}
              </span>
            )}
            {item.runtime && <span>{formatRuntime(item.runtime)}</span>}
            {item.certification && (
              <span className="rounded border border-foreground/30 px-1.5 py-0 text-[11px] font-semibold text-foreground/70">
                {item.certification}
              </span>
            )}
            {item.genres.slice(0, 3).map((g) => (
              <span key={g} className="text-foreground/60">
                {g}
              </span>
            ))}
          </div>
          {item.overview && (
            <p className="mt-3 line-clamp-2 max-w-xl text-sm text-foreground/70 sm:line-clamp-3 sm:text-base">
              {item.overview}
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              onClick={() =>
                onPlay(item.id, item.progressEpisodeId ?? null, item.progressPosition ?? 0)
              }
              className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-2.5 text-sm font-bold text-black transition-transform hover:scale-105"
            >
              <Play className="h-5 w-5 fill-current" />
              {item.progressPercent ? "Resume" : "Play"}
            </button>
            <button
              onClick={() => onOpen(item.id)}
              className="inline-flex items-center gap-2 rounded-lg border border-foreground/20 bg-foreground/10 px-6 py-2.5 text-sm font-bold text-foreground backdrop-blur transition-colors hover:bg-foreground/20"
            >
              <Info className="h-5 w-5" />
              More Info
            </button>
            <button
              onClick={() => toggle.mutate(item.id)}
              className={cn(
                "inline-flex h-10 w-10 items-center justify-center rounded-full border border-foreground/20 bg-foreground/10 backdrop-blur transition-colors hover:bg-foreground/20",
                item.inMyList && "border-primary/50 text-primary"
              )}
              aria-label={item.inMyList ? "Remove from My List" : "Add to My List"}
            >
              {item.inMyList ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* dots */}
      {items.length > 1 && (
        <div className="absolute bottom-4 right-4 flex items-center gap-1.5 sm:right-8">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-6 bg-primary" : "w-1.5 bg-foreground/40 hover:bg-foreground/70"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
