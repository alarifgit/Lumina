"use client";

import { useState, type KeyboardEvent } from "react";
import { Check, Film, Play, Star, Tv } from "lucide-react";
import type { MediaSummary, SearchEpisodeResult } from "@/lib/types";
import { formatRuntime, progressPercent } from "@/lib/media-utils";
import { cn } from "@/lib/utils";
import { ProceduralPoster } from "./procedural-poster";

export type SearchGroupKey = "movies" | "shows" | "episodes";

interface KeyboardProps {
  group: SearchGroupKey;
  index: number;
  onNavigate: (
    event: KeyboardEvent<HTMLButtonElement>,
    group: SearchGroupKey,
    index: number
  ) => void;
}

interface MediaResultProps extends KeyboardProps {
  media: MediaSummary;
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
}

export function SearchMediaResultCard({
  media,
  group,
  index,
  onOpen,
  onPlay,
  onNavigate,
}: MediaResultProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const pct = progressPercent(media);
  const TypeIcon = media.type === "TV" ? Tv : Film;

  return (
    <article className="lumina-panel group/result flex min-h-32 gap-2 rounded-lg p-2.5 transition-colors hover:border-white/24">
      <button
        type="button"
        onClick={() => onOpen(media.id)}
        onKeyDown={(event) => onNavigate(event, group, index)}
        data-search-result
        data-search-group={group}
        data-search-index={index}
        className="grid min-w-0 flex-1 grid-cols-[4.65rem_minmax(0,1fr)] gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/80"
        aria-label={`Open ${media.title}${media.year ? `, ${media.year}` : ""}`}
      >
        <span className="relative aspect-[2/3] h-full max-h-[7.25rem] overflow-hidden rounded-md bg-[var(--lumina-ink)] ring-1 ring-white/12">
          {media.posterUrl && !imageFailed ? (
            <img
              src={media.posterUrl}
              alt=""
              className="h-full w-full object-cover transition-transform duration-500 group-hover/result:scale-[1.035]"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <ProceduralPoster title={media.title} genres={media.genres} className="h-full w-full" />
          )}
          {pct > 0 && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
              <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
            </span>
          )}
        </span>

        <span className="min-w-0 self-center py-1 pr-1">
          <span className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-white/46">
            <TypeIcon className="h-3.5 w-3.5" />
            {media.type === "TV" ? "TV show" : "Movie"}
          </span>
          <span className="block truncate text-base font-semibold tracking-[-0.02em] text-white">
            {media.title}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/54">
            {media.rating != null && (
              <span className="inline-flex items-center gap-1 text-white/78">
                <Star className="h-3 w-3 fill-primary text-primary" />
                {media.rating.toFixed(1)}
              </span>
            )}
            {media.year && <span>{media.year}</span>}
            {media.runtime && <span>{formatRuntime(media.runtime)}</span>}
          </span>
          {media.overview && (
            <span className="mt-2 hidden line-clamp-2 text-xs leading-relaxed text-white/45 xl:block">
              {media.overview}
            </span>
          )}
        </span>
      </button>

      <div className="flex shrink-0 items-end">
        <button
          type="button"
          onClick={() =>
            onPlay(media.id, media.progressEpisodeId ?? null, media.progressPosition ?? 0)
          }
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/12 bg-[var(--lumina-ink)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#102a37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80"
          aria-label={`${media.progressPosition ? "Resume" : "Play"} ${media.title}`}
        >
          <Play className="h-3.5 w-3.5 fill-current" />
          <span className="hidden sm:inline">{media.progressPosition ? "Resume" : "Play"}</span>
        </button>
      </div>
    </article>
  );
}

interface EpisodeResultProps extends KeyboardProps {
  episode: SearchEpisodeResult;
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
}

export function SearchEpisodeResultCard({
  episode,
  group,
  index,
  onOpen,
  onPlay,
  onNavigate,
}: EpisodeResultProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const image = episode.stillUrl ?? episode.backdropUrl ?? episode.posterUrl;
  const pct = Math.max(0, Math.min(100, episode.progressPercent ?? 0));
  const seasonEpisode = `S${String(episode.seasonNumber).padStart(2, "0")} · E${String(
    episode.episodeNumber
  ).padStart(2, "0")}`;
  const primaryLabel = episode.completed
    ? "Replay"
    : (episode.progressPosition ?? 0) > 0
      ? "Resume"
      : "Play";

  return (
    <article className="lumina-panel group/result flex min-h-32 gap-2 rounded-lg p-2.5 transition-colors hover:border-white/24">
      <button
        type="button"
        onClick={() =>
          onPlay(
            episode.mediaId,
            episode.id,
            episode.completed ? 0 : (episode.progressPosition ?? 0)
          )
        }
        onKeyDown={(event) => onNavigate(event, group, index)}
        data-search-result
        data-search-group={group}
        data-search-index={index}
        className="grid min-w-0 flex-1 grid-cols-[7.5rem_minmax(0,1fr)] gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/80 sm:grid-cols-[9rem_minmax(0,1fr)]"
        aria-label={`${primaryLabel} ${episode.showTitle}, ${seasonEpisode}, ${episode.title}`}
      >
        <span className="relative aspect-video self-center overflow-hidden rounded-md bg-[var(--lumina-ink)] ring-1 ring-white/12">
          {image && !imageFailed ? (
            <img
              src={image}
              alt=""
              className={cn(
                "h-full w-full transition-transform duration-500 group-hover/result:scale-[1.035]",
                image === episode.posterUrl ? "object-cover object-top" : "object-cover"
              )}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-white/28">
              <Tv className="h-7 w-7" />
            </span>
          )}
          <span className="absolute inset-0 bg-gradient-to-t from-[var(--lumina-ink)]/58 via-transparent to-transparent" />
          <span className="absolute bottom-2 left-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--lumina-ink)]/92 text-white shadow-lg">
            <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
          </span>
          {pct > 0 && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
              <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
            </span>
          )}
        </span>

        <span className="min-w-0 self-center py-1 pr-1">
          <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.11em] text-primary/90">
            {episode.showTitle}
          </span>
          <span className="mt-1 block truncate text-base font-semibold tracking-[-0.02em] text-white">
            {episode.title || "Episode"}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/54">
            <span>{seasonEpisode}</span>
            {episode.runtime && <span>{formatRuntime(episode.runtime)}</span>}
            {episode.year && <span>{episode.year}</span>}
            {episode.completed && (
              <span className="inline-flex items-center gap-1 text-emerald-300/86">
                <Check className="h-3 w-3" /> Watched
              </span>
            )}
          </span>
        </span>
      </button>

      <div className="flex shrink-0 items-end">
        <button
          type="button"
          onClick={() => onOpen(episode.mediaId)}
          className="inline-flex h-9 items-center rounded-full border border-white/12 bg-white/[0.07] px-3 text-xs font-semibold text-white/76 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80"
          aria-label={`View ${episode.showTitle}`}
        >
          <span className="hidden sm:inline">View show</span>
          <span className="sm:hidden">Show</span>
        </button>
      </div>
    </article>
  );
}
