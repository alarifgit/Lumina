"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Info,
  Pause,
  Play,
  Sparkles,
  Star,
} from "lucide-react";
import type { MediaSummary } from "@/lib/types";
import { ProceduralPoster } from "./procedural-poster";
import { cn } from "@/lib/utils";
import { playbackRequestForSummary } from "@/lib/media-utils";
import { normalizeFeatureIndex, resolveActiveFeatureIndex } from "@/lib/feature-state";

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
        className="h-full w-full scale-[1.01] object-cover brightness-[0.9] contrast-[1.03] saturate-[0.82]"
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
  const playback = playbackRequestForSummary(item);
  return (
    <article
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${total}: ${item.title}`}
      className={cn(
        "lumina-hero-frame film-grain relative min-h-[300px] overflow-hidden rounded-lg bg-[#1b303b] ring-1 ring-white/18",
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
        {secondary ? (
          <h2
            className="max-w-[16ch] text-balance text-2xl font-semibold leading-[0.98] tracking-[-0.045em] text-white 2xl:text-3xl"
          >
            {item.title}
          </h2>
        ) : (
          <h1
            className={cn(
              "max-w-[16ch] text-balance font-semibold leading-[0.98] tracking-[-0.045em] text-white",
              "text-4xl sm:text-5xl lg:text-6xl"
            )}
          >
            {item.title}
          </h1>
        )}
        {!secondary && item.tagline && (
          <p className="mt-3 line-clamp-2 max-w-md text-sm leading-6 text-white/68">
            {item.tagline}
          </p>
        )}
        <div className={cn("flex items-center gap-4", secondary ? "mt-4" : "mt-6")}>
          <button
            onClick={() => onPlay(item.id, playback.episodeId, playback.startAt)}
            className="group/play inline-flex items-center gap-3 text-sm font-semibold text-white transition-opacity duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:opacity-[0.86]"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[var(--lumina-ink)] shadow-[0_10px_26px_rgba(7,23,32,0.28)] transition-colors duration-200 group-hover/play:bg-[#102a37]">
              <Play className="ml-0.5 h-4 w-4 fill-current" />
            </span>
            {item.progressPercent ? "Resume" : "Play now"}
          </button>
          <button
            onClick={() => onOpen(item.id)}
            className="inline-flex items-center gap-2 text-sm font-medium text-white/66 transition-colors duration-200 hover:text-white"
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
  const featured = useMemo(() => items.slice(0, 6), [items]);
  const featureIds = useMemo(() => featured.map((item) => item.id), [featured]);
  const [activeId, setActiveId] = useState<string | null>(() => featured[0]?.id ?? null);
  const [userPaused, setUserPaused] = useState(false);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const safeActiveIndex = resolveActiveFeatureIndex(featureIds, activeId);

  useEffect(() => {
    const updateVisibility = () => setDocumentHidden(document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  const moveTo = useCallback(
    (nextIndex: number) => {
      if (featured.length < 2) return;
      const normalizedIndex = normalizeFeatureIndex(featured.length, nextIndex);
      setActiveId(featured[normalizedIndex].id);
    },
    [featured]
  );

  const autoplayPaused =
    userPaused || pointerInside || focusWithin || documentHidden || !!prefersReducedMotion;

  useEffect(() => {
    if (featured.length < 2 || autoplayPaused) return;
    const timer = window.setTimeout(() => {
      const nextIndex = (safeActiveIndex + 1) % featured.length;
      setActiveId(featured[nextIndex].id);
    }, 11_000);
    return () => window.clearTimeout(timer);
  }, [autoplayPaused, featured, safeActiveIndex]);

  if (!featured.length) return null;

  const visibleFeatures = Array.from(
    { length: Math.min(3, featured.length) },
    (_, offset) => {
      const index = (safeActiveIndex + offset) % featured.length;
      return { item: featured[index], index };
    }
  );

  const activeFeature = visibleFeatures[0];

  return (
    <section
      className="lumina-page lumina-reveal relative px-4 pt-20 sm:px-6 lg:px-8 min-[2200px]:pt-24"
      aria-label="Featured titles"
      aria-roledescription="carousel"
      onMouseEnter={() => setPointerInside(true)}
      onMouseLeave={() => setPointerInside(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusWithin(false);
        }
      }}
    >
      <div className="pointer-events-none absolute inset-x-12 bottom-[-8%] top-24 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(224,236,241,0.13),transparent_68%)]" />
      <div className="relative grid">
        <AnimatePresence initial={false}>
          <motion.div
            key={activeFeature.item.id}
            className={cn(
              "col-start-1 row-start-1 grid gap-3",
              visibleFeatures.length > 1 && "xl:grid-cols-[1.35fr_0.65fr] xl:grid-rows-2"
            )}
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.34, ease: [0.16, 1, 0.3, 1] }}
          >
            {visibleFeatures.map(({ item, index }, position) => (
              <FeatureTile
                key={`${position}:${item.id}`}
                item={item}
                secondary={position > 0}
                index={index}
                total={featured.length}
                onOpen={onOpen}
                onPlay={onPlay}
              />
            ))}
          </motion.div>
        </AnimatePresence>
        {featured.length > 1 && (
          <div className="absolute right-3 top-3 z-20 sm:right-4 sm:top-4 xl:right-[calc(32.5%+0.75rem)]">
            <div
              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-white/10 bg-[var(--lumina-ink)]/82 px-2 py-1.5 shadow-[0_10px_28px_rgba(7,23,32,0.22)] backdrop-blur-xl sm:gap-3 sm:px-3"
              role="group"
              aria-label="Featured title controls"
            >
              <span className="hidden min-w-10 text-[10px] font-semibold tracking-[0.16em] text-white/48 tabular-nums sm:inline">
                {String(safeActiveIndex + 1).padStart(2, "0")} / {String(featured.length).padStart(2, "0")}
              </span>

              <div className="flex items-center gap-0.5" aria-label="Choose a featured title">
                {featured.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => moveTo(index)}
                    aria-label={`Show ${item.title}`}
                    aria-current={index === safeActiveIndex ? "true" : undefined}
                    className="group/segment grid h-7 w-6 place-items-center rounded-sm"
                  >
                    <span
                      className={cn(
                        "h-px w-3.5 rounded-full transition-[width,background-color] duration-300 sm:w-4",
                        index === safeActiveIndex
                          ? "w-5 bg-primary sm:w-6"
                          : "bg-white/22 group-hover/segment:bg-white/48"
                      )}
                    />
                  </button>
                ))}
              </div>

              <span className="h-5 w-px bg-white/10" aria-hidden="true" />

              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => moveTo(safeActiveIndex - 1)}
                  className="grid h-8 w-8 place-items-center rounded-md text-white/62 transition-colors hover:bg-white/8 hover:text-white"
                  aria-label="Previous featured title"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setUserPaused((paused) => !paused)}
                  disabled={!!prefersReducedMotion}
                  className="grid h-8 w-8 place-items-center rounded-md text-white/62 transition-colors hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label={
                    prefersReducedMotion
                      ? "Automatic feature rotation disabled by reduced motion preference"
                      : userPaused
                        ? "Resume automatic feature rotation"
                        : "Pause automatic feature rotation"
                  }
                  title={
                    prefersReducedMotion
                      ? "Automatic rotation is off with reduced motion"
                      : undefined
                  }
                >
                  {userPaused || prefersReducedMotion ? (
                    <Play className="h-3.5 w-3.5 fill-current" />
                  ) : (
                    <Pause className="h-3.5 w-3.5 fill-current" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => moveTo(safeActiveIndex + 1)}
                  className="grid h-8 w-8 place-items-center rounded-md text-white/62 transition-colors hover:bg-white/8 hover:text-white"
                  aria-label="Next featured title"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
