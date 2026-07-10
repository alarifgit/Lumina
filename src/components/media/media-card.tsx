"use client";

import { useState } from "react";
import { Check, FileText, Info, MoreHorizontal, Play, Plus, Star } from "lucide-react";
import type { MediaSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProceduralPoster } from "./procedural-poster";
import { useMediaDetail, useSaveProgress, useToggleMyList } from "@/lib/queries";
import { formatRuntime, progressPercent } from "@/lib/media-utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  media: MediaSummary;
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
  variant?: "row" | "grid";
  className?: string;
}

export function MediaCard({ media, onOpen, onPlay, className }: Props) {
  const [imgError, setImgError] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const info = useMediaDetail(infoOpen ? media.id : null);
  const toggle = useToggleMyList();
  const saveProgress = useSaveProgress();
  const pct = progressPercent(media);
  const showImg = !!media.posterUrl && !imgError;
  const isNew = (() => {
    const date = media.sourceModifiedAt ?? media.createdAt;
    if (!date) return false;
    const age = Date.now() - new Date(date).getTime();
    return age < 14 * 86400000;
  })();
  const markWatched = () => {
    const duration = Math.max(1, media.progressDuration ?? (media.runtime ?? 1) * 60);
    saveProgress.mutate({
      mediaId: media.id,
      episodeId: media.progressEpisodeId ?? null,
      position: duration,
      duration,
      completed: true,
    });
  };

  return (
    <>
    <div
      className={cn("group/card relative z-[1] shrink-0 cursor-pointer transition-none hover:z-30", className)}
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
      <div
        className="relative z-10 aspect-[2/3] overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10 transition-[transform,box-shadow,ring-color] duration-200 ease-out will-change-transform group-hover/card:-translate-y-1 group-hover/card:scale-[1.025] group-hover/card:ring-white/22 group-hover/card:shadow-[0_18px_38px_-18px_rgba(0,0,0,0.92)]"
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
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent opacity-0 transition-opacity duration-200 group-hover/card:opacity-100" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay(media.id, media.progressEpisodeId ?? null, media.progressPosition ?? 0);
          }}
          className="absolute left-1/2 top-1/2 z-10 inline-flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 scale-90 items-center justify-center rounded-full bg-white/95 text-black opacity-0 shadow-[0_12px_32px_rgba(0,0,0,0.42)] transition-[opacity,transform] duration-200 hover:scale-100 group-hover/card:scale-100 group-hover/card:opacity-100"
          aria-label={`Play ${media.title}`}
        >
          <Play className="ml-0.5 h-5 w-5 fill-current" />
        </button>
        <div
          className="absolute inset-x-0 bottom-0 translate-y-2 p-3 opacity-0 transition-[opacity,transform] duration-200 group-hover/card:translate-y-0 group-hover/card:opacity-100"
        >
          <div className="mb-2 flex items-center gap-2">
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/40 bg-black/50 text-white backdrop-blur transition-colors hover:border-white hover:bg-black/70"
                  aria-label="More actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(media.id);
                  }}
                >
                  <Info className="h-4 w-4" />
                  More info
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlay(media.id, media.progressEpisodeId ?? null, media.progressPosition ?? 0);
                  }}
                >
                  <Play className="h-4 w-4" />
                  Play
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    setInfoOpen(true);
                  }}
                >
                  <FileText className="h-4 w-4" />
                  Get info
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle.mutate(media.id);
                  }}
                >
                  {media.inMyList ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  {media.inMyList ? "Remove from My List" : "Add to My List"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    markWatched();
                  }}
                >
                  <Check className="h-4 w-4" />
                  Mark as watched
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
      </div>
    </div>
    <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
      <DialogContent
        className="max-h-[82vh] overflow-hidden border-[var(--line-soft)] bg-[#08111d] p-0 text-foreground shadow-[0_24px_90px_rgba(0,0,0,0.7)] sm:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader className="border-b border-[var(--line-soft)] px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileText className="h-5 w-5 text-primary" />
            Media info
          </DialogTitle>
          <DialogDescription>
            Local paths and match identifiers for {media.title}.
          </DialogDescription>
        </DialogHeader>
        <div className="thin-scrollbar max-h-[64vh] space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {!info.data && (
            <div className="rounded-lg border border-[var(--line-soft)] bg-white/[0.035] p-4 text-foreground/60">
              Loading media details...
            </div>
          )}
          {info.data && (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <InfoField label="Title" value={info.data.title} />
                <InfoField label="Type" value={info.data.type === "TV" ? "TV show" : "Movie"} />
                <InfoField label="Year" value={info.data.year ? String(info.data.year) : null} />
                <InfoField label="Runtime" value={info.data.runtime ? formatRuntime(info.data.runtime) : null} />
                <InfoField label="TMDB ID" value={info.data.tmdbId ? String(info.data.tmdbId) : null} />
                <InfoField label="IMDb ID" value={info.data.imdbId} />
                <InfoField label="Source modified" value={formatDateTime(info.data.sourceModifiedAt)} />
                <InfoField label="Source created" value={formatDateTime(info.data.sourceCreatedAt)} />
              </div>

              <PathBlock label={info.data.type === "TV" ? "Show folder" : "Media file"} value={info.data.filePath} />

              {info.data.type === "TV" && (
                <div className="space-y-2">
                  <div className="label-eyebrow text-primary/90">Episode files</div>
                  {info.data.episodes.length === 0 ? (
                    <div className="rounded-lg border border-[var(--line-soft)] bg-white/[0.035] p-3 text-foreground/55">
                      No episode file paths loaded for this season.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {info.data.episodes.slice(0, 12).map((episode) => (
                        <PathBlock
                          key={episode.id}
                          label={`S${episode.seasonNumber} E${episode.episodeNumber} · ${episode.title}`}
                          value={episode.filePath}
                        />
                      ))}
                      {info.data.episodes.length > 12 && (
                        <p className="text-xs text-foreground/50">
                          Showing the first 12 episode files for this season.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

function InfoField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-lg border border-[var(--line-soft)] bg-white/[0.035] p-3">
      <div className="label-eyebrow text-foreground/45">{label}</div>
      <div className="mt-1 min-h-5 break-words font-medium text-foreground/88">{value || "Not available"}</div>
    </div>
  );
}

function PathBlock({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-lg border border-[var(--line-soft)] bg-black/24 p-3">
      <div className="label-eyebrow text-foreground/45">{label}</div>
      <div className="mt-1 break-all font-mono text-xs leading-5 text-foreground/82">
        {value || "No local path recorded"}
      </div>
    </div>
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}
