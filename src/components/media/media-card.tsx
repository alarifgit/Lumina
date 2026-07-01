"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Star, Play, Plus, Check, ChevronDown, Info } from "lucide-react";
import type { MediaSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProceduralPoster } from "./procedural-poster";
import { useToggleMyList } from "@/lib/queries";
import { formatRuntime, progressPercent } from "@/lib/media-utils";

interface Props {
  media: MediaSummary;
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
  className?: string;
}

export function MediaCard({ media, onOpen, onPlay, className }: Props) {
  const [imgError, setImgError] = useState(false);
  const [hovered, setHovered] = useState(false);
  const toggle = useToggleMyList();
  const pct = progressPercent(media);
  const showImg = !!media.posterUrl && !imgError;
  const isNew = (() => {
    if (!media.createdAt) return false;
    const age = Date.now() - new Date(media.createdAt).getTime();
    return age < 14 * 86400000;
  })();

  return (
    <div
      className={cn("relative shrink-0 cursor-pointer transition-none", className)}
      style={{ zIndex: hovered ? 30 : 1 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpen(media.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(media.id);
        }
      }}
      aria-label={`${media.title}${media.year ? ` (${media.year})` : ""}`}
    >
      {/* Base poster card */}
      <motion.div
        animate={{
          scale: hovered ? 1.08 : 1,
          y: hovered ? -6 : 0,
        }}
        transition={{ type: "spring", stiffness: 250, damping: 30, mass: 0.6 }}
        className="relative z-10 aspect-[2/3] overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10"
        style={{
          boxShadow: hovered
            ? "0 25px 60px -5px rgba(0,0,0,0.8), 0 0 0 3px var(--primary), 0 0 50px 12px rgba(245,158,11,0.45), 0 0 80px 20px rgba(245,158,11,0.2)"
            : undefined,
        }}
      >
        {showImg ? (
          <img
            src={media.posterUrl!}
            alt={media.title}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <ProceduralPoster title={media.title} genres={media.genres} className="h-full w-full" />
        )}

        {/* hover gradient + info */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent opacity-0 transition-opacity duration-300" style={{ opacity: hovered ? 1 : 0 }} />
        <div
          className="absolute inset-x-0 bottom-0 p-3 transition-all duration-300"
          style={{
            opacity: hovered ? 1 : 0,
            transform: hovered ? "translateY(0)" : "translateY(8px)",
          }}
        >
          <div className="mb-2 flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay(media.id, media.progressEpisodeId ?? null, media.progressPosition ?? 0);
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-110"
              aria-label="Play"
            >
              <Play className="ml-0.5 h-4 w-4 fill-current" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggle.mutate(media.id);
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/40 bg-black/50 text-white backdrop-blur transition-colors hover:border-white hover:bg-black/70"
              aria-label={media.inMyList ? "Remove from My List" : "Add to My List"}
            >
              {media.inMyList ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpen(media.id);
              }}
              className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/40 bg-black/50 text-white backdrop-blur transition-colors hover:border-white hover:bg-black/70"
              aria-label="More info"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
          <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-white">
            {media.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/70">
            {media.year && <span className="font-medium">{media.year}</span>}
            {media.runtime && <span>{formatRuntime(media.runtime)}</span>}
            {media.genres.slice(0, 2).map((g) => (
              <span key={g} className="truncate text-white/50">
                {g}
              </span>
            ))}
          </div>
        </div>

        {/* always-visible badges */}
        <div className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/80 backdrop-blur">
          {media.type === "TV" ? "TV" : "Film"}
        </div>
        {isNew && (
          <div className="absolute left-1.5 top-7 rounded bg-primary px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-primary-foreground backdrop-blur">
            New
          </div>
        )}
        {media.rating != null && (
          <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
            <Star className="h-2.5 w-2.5 fill-primary text-primary" />
            {media.rating.toFixed(1)}
          </div>
        )}

        {/* progress bar */}
        {pct > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        )}
      </motion.div>
    </div>
  );
}
