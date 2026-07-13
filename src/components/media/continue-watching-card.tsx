"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import type { MediaSummary } from "@/lib/types";
import { ProceduralPoster } from "./procedural-poster";
import { formatRuntime, progressPercent } from "@/lib/media-utils";
import { MediaActionsMenu } from "./media-actions-menu";

interface Props {
  media: MediaSummary;
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
}

export function ContinueWatchingCard({ media, onOpen, onPlay }: Props) {
  const [imgError, setImgError] = useState(false);
  const pct = progressPercent(media);
  const showImg = !!media.backdropUrl && !imgError;
  const epLabel =
    media.type === "TV" && media.progressSeason
      ? `S${media.progressSeason} · E${media.progressEpisode}`
      : media.runtime
        ? formatRuntime(media.runtime)
        : "";

  return (
    <div
      className="group/card relative z-[1] w-[260px] shrink-0 cursor-pointer transition-none hover:z-30 sm:w-[320px]"
      onClick={() => onPlay(media.id, media.progressEpisodeId ?? null, media.progressPosition ?? 0)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlay(media.id, media.progressEpisodeId ?? null, media.progressPosition ?? 0);
        }
      }}
      aria-label={`Resume ${media.title}`}
    >
      <div
        className="relative aspect-video overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10 transition-[transform,box-shadow,ring-color] duration-200 ease-out will-change-transform group-hover/card:-translate-y-1 group-hover/card:scale-[1.02] group-hover/card:ring-white/22 group-hover/card:shadow-[0_18px_38px_-18px_rgba(0,0,0,0.92)]"
      >
        {showImg ? (
          <img
            src={media.backdropUrl!}
            alt={media.title}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <ProceduralPoster
            title={media.title}
            genres={media.genres}
            variant="backdrop"
            className="h-full w-full"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover/card:opacity-100">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-black shadow-lg">
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          </span>
        </div>
        <MediaActionsMenu
          media={media}
          onOpen={onOpen}
          onPlay={onPlay}
          showRemoveFromContinueWatching
          triggerClassName="absolute right-2 top-2 z-20 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/card:opacity-100 data-[state=open]:opacity-100"
        />
        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold text-white">{media.title}</span>
            {epLabel && (
              <span className="shrink-0 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white/80">
                {epLabel}
              </span>
            )}
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-white/25">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
