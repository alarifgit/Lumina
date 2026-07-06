"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Play, Info, Plus, Check, Star, ChevronLeft, ChevronRight } from "lucide-react";
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
  const deck = items.slice(0, Math.min(items.length, 4));
  const go = (dir: number) =>
    setIndex((i) => (i + dir + items.length) % items.length);

  return (
    <section
      className="lumina-page px-4 pt-20 sm:px-6 lg:px-8"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
    >
    <div
      data-lumina-frame="true"
      className="lumina-panel film-grain relative w-full overflow-hidden rounded-xl"
      style={{ minHeight: "clamp(420px, 44vw, 610px)" }}
    >
      <AnimatePresence mode="sync">
        <motion.div
          key={index}
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="absolute inset-0"
        >
          <HeroBackdrop item={item} index={index} />
        </motion.div>
      </AnimatePresence>

      {/* Cinematic scrims (design.md §6): left + bottom black gradients + faint warm gold overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, rgba(3,4,5,0.96) 0%, rgba(8,17,29,0.78) 36%, rgba(8,17,29,0.22) 72%, rgba(3,4,5,0.58) 100%), linear-gradient(180deg, rgba(3,4,5,0.08) 0%, rgba(3,4,5,0.78) 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 18% 80%, rgba(245,182,42,0.10), transparent 40%)",
        }}
      />

      {/* Content — aligned to the same horizontal padding as the content rows below */}
      <div className="absolute inset-0 flex">
        <div className="grid w-full grid-cols-1 gap-6 px-6 pb-7 pt-24 sm:px-9 sm:pb-9 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-11 lg:pb-11">
          <div className="flex max-w-2xl flex-col justify-end">
            <div className="mb-3 flex items-center gap-2">
              <span
                className="rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] shadow-[0_0_18px_rgba(245,182,42,0.28)]"
                style={{ background: "var(--lumina-gold)", color: "#160d04" }}
              >
                Featured
              </span>
              <span className="rounded-md bg-black/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-foreground/70 ring-1 ring-white/10">
                {item.type === "TV" ? "Series" : "Film"}
              </span>
            </div>
            <h1 className="lumina-title text-shadow-lg text-4xl font-semibold leading-[0.98] sm:text-6xl lg:text-7xl">
              {item.title}
            </h1>
            {item.tagline && (
              <p className="mt-3 text-sm italic text-foreground/70 sm:text-base">
                {item.tagline}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground/85 tabular-nums">
              {item.year && <span className="font-medium">{item.year}</span>}
              {item.rating != null && (
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 fill-[var(--lumina-gold)] text-[var(--lumina-gold)]" />
                  <span className="font-semibold">{item.rating.toFixed(1)}</span>
                </span>
              )}
              {item.runtime && <span>{formatRuntime(item.runtime)}</span>}
              {item.certification && (
                <span className="rounded border border-white/25 px-1.5 py-0 text-[11px] font-semibold text-foreground/75">
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
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                onClick={() =>
                  onPlay(item.id, item.progressEpisodeId ?? null, item.progressPosition ?? 0)
                }
                className="lumina-button-primary inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold transition-transform hover:scale-[1.04]"
              >
                <Play className="h-5 w-5 fill-current" />
                {item.progressPercent ? "Resume" : "Play"}
              </button>
              <button
                onClick={() => onOpen(item.id)}
                className="lumina-button-secondary inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold transition-colors hover:bg-white/12"
              >
                <Info className="h-5 w-5" />
                More Info
              </button>
              <button
                onClick={() => toggle.mutate(item.id)}
                className={cn(
                  "inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/8 backdrop-blur transition-colors hover:bg-white/20",
                  item.inMyList && "border-[var(--lumina-gold)]/60 text-[var(--lumina-gold)]"
                )}
                aria-label={item.inMyList ? "Remove from My List" : "Add to My List"}
              >
                {item.inMyList ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
              </button>
            </div>
          </div>
          <div className="hidden flex-col justify-end gap-2 lg:flex">
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/48">
              <span>On deck</span>
              <span>{index + 1}/{items.length}</span>
            </div>
            {deck.map((candidate, i) => {
              const active = items[index % items.length]?.id === candidate.id;
              return (
                <button
                  key={candidate.id}
                  onClick={() => setIndex(i)}
                  className={cn(
                  "group grid grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-lg border p-2 text-left transition-all",
                    active
                      ? "border-primary/45 bg-primary/10 text-foreground shadow-[0_0_24px_rgba(215,168,77,0.12)]"
                      : "border-white/10 bg-black/36 text-foreground/72 hover:border-white/18 hover:bg-black/52 hover:text-foreground"
                  )}
                >
                  <div className="aspect-video overflow-hidden rounded-md bg-black/40">
                    {candidate.backdropUrl || candidate.posterUrl ? (
                      <img
                        src={candidate.backdropUrl || candidate.posterUrl || ""}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <ProceduralPoster
                        title={candidate.title}
                        genres={candidate.genres}
                        variant="backdrop"
                        className="h-full w-full"
                      />
                    )}
                  </div>
                  <div className="min-w-0 self-center">
                    <div className="line-clamp-1 text-sm font-semibold">{candidate.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-foreground/48 tabular-nums">
                      {candidate.year && <span>{candidate.year}</span>}
                      {candidate.rating != null && (
                        <span className="inline-flex items-center gap-1">
                          <Star className="h-3 w-3 fill-primary text-primary" />
                          {candidate.rating.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Slide arrows — desktop, aligned to the same horizontal padding */}
      {items.length > 1 && (
        <>
          <button
            onClick={() => go(-1)}
            className="absolute left-0 top-1/2 z-10 hidden h-16 w-12 -translate-y-1/2 items-center justify-center text-white/70 transition-colors hover:text-white lg:flex lg:px-2"
            aria-label="Previous"
          >
            <ChevronLeft className="h-8 w-8 drop-shadow-lg" />
          </button>
          <button
            onClick={() => go(1)}
            className="absolute right-0 top-1/2 z-10 hidden h-16 w-12 -translate-y-1/2 items-center justify-center text-white/70 transition-colors hover:text-white lg:flex lg:px-2"
            aria-label="Next"
          >
            <ChevronRight className="h-8 w-8 drop-shadow-lg" />
          </button>

          {/* Slide indicators — aligned to the right edge with the same padding */}
          <div className="absolute bottom-3 right-0 flex items-center gap-1.5 px-4 sm:px-6 lg:px-8">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                aria-label={`Go to slide ${i + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === index
                    ? "w-6 bg-[var(--lumina-gold)] shadow-[0_0_10px_rgba(245,182,42,0.6)]"
                    : "w-1.5 bg-white/35 hover:bg-white/60"
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
    </section>
  );
}
