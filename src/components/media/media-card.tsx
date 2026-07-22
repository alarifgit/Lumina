"use client";

import { useState } from "react";
import { Play, Star } from "lucide-react";
import type { MediaSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProceduralPoster } from "./procedural-poster";
import { formatRuntime, playbackRequestForSummary, progressPercent } from "@/lib/media-utils";
import { MediaActionsMenu } from "./media-actions-menu";

interface Props {
  media: MediaSummary;
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
  variant?: "row" | "grid";
  className?: string;
}

export function MediaCard({ media, onOpen, onPlay, className }: Props) {
  const [imgError, setImgError] = useState(false);
  const pct = progressPercent(media);
  const showImg = !!media.posterUrl && !imgError;
  const playback = playbackRequestForSummary(media);
  const episodeContext =
    media.contextSeason != null && media.contextEpisode != null
      ? `S${media.contextSeason} · E${media.contextEpisode}`
      : null;
  const isNew = (() => {
    const date = media.sourceModifiedAt ?? media.createdAt;
    if (!date) return false;
    const age = Date.now() - new Date(date).getTime();
    return age < 14 * 86400000;
  })();

  return (
    <div
      className={cn("group/card relative z-[1] shrink-0 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#18313d]", className)}
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
      <div
        className="relative z-10 aspect-[2/3] overflow-hidden rounded-lg bg-card ring-1 ring-white/12 transition-shadow duration-200 group-hover/card:ring-white/22"
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

        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,23,32,0.02)_42%,rgba(7,23,32,0.48)_100%)] opacity-55 transition-opacity duration-200 group-hover/card:opacity-80" />
        <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/36 to-transparent opacity-50" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay(media.id, playback.episodeId, playback.startAt);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className="absolute left-1/2 top-1/2 z-10 inline-flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 bg-[var(--lumina-ink)] text-white opacity-0 shadow-[0_12px_28px_rgba(7,23,32,0.28)] transition-[opacity,background-color] duration-200 hover:bg-[#102a37] group-hover/card:opacity-100 group-focus-within/card:opacity-100 min-[2200px]:h-14 min-[2200px]:w-14 min-[2800px]:h-16 min-[2800px]:w-16"
          aria-label={`Play ${media.title}`}
        >
          <Play className="ml-0.5 h-5 w-5 fill-current min-[2200px]:h-6 min-[2200px]:w-6 min-[2800px]:h-7 min-[2800px]:w-7" />
        </button>
        <MediaActionsMenu
          media={media}
          onOpen={onOpen}
          onPlay={onPlay}
          triggerClassName="absolute right-2 top-2 z-20 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/card:opacity-100 data-[state=open]:opacity-100 min-[2200px]:h-10 min-[2200px]:w-10 min-[2200px]:[&_svg]:h-5 min-[2200px]:[&_svg]:w-5"
        />

        {/* always-visible badges */}
        {isNew && (
          <div className="absolute bottom-2 left-2 rounded bg-[var(--lumina-ink)]/88 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white backdrop-blur">
            New
          </div>
        )}

        {/* progress bar */}
        {pct > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="px-0.5 pt-2.5">
        <h3 className="line-clamp-1 text-sm font-semibold leading-tight tracking-[-0.01em] text-white min-[2200px]:text-base min-[2800px]:text-lg">
          {media.title}
        </h3>
        <div className="mt-1.5 flex items-center gap-2 text-[11px] font-medium tabular-nums text-white/58 min-[2200px]:text-xs min-[2800px]:text-sm">
          {media.rating != null && (
            <span className="inline-flex items-center gap-1 text-white/82">
              <Star className="h-3 w-3 fill-primary text-primary" />
              {media.rating.toFixed(1)}
            </span>
          )}
          {media.year && <span>{media.year}</span>}
          {media.runtime && <span className="hidden xl:inline">{formatRuntime(media.runtime)}</span>}
          <span className="ml-auto text-white/38">
            {episodeContext ?? (media.type === "TV" ? "Series" : "Film")}
          </span>
        </div>
      </div>
    </div>
  );
}
