"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play, Plus, Check, Star, Clock, Calendar, X, CheckCircle2 } from "lucide-react";
import { useMediaStore } from "@/store/media-store";
import { useMediaDetail, useToggleMyList, useBrowse, useSaveProgress } from "@/lib/queries";
import { ProceduralPoster } from "./procedural-poster";
import { ContentRow } from "./content-row";
import { MediaActionsMenu } from "./media-actions-menu";
import { formatRuntime, progressPercent } from "@/lib/media-utils";
import { cn } from "@/lib/utils";

interface Props {
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
}

export function DetailOverlay({ onPlay }: Props) {
  const id = useMediaStore((s) => s.selectedMediaId);
  const close = useMediaStore((s) => s.closeDetail);

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && close()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[94vh] max-w-5xl gap-0 overflow-hidden rounded-2xl border-border/60 bg-card p-0 sm:max-w-5xl"
      >
        {id ? (
          <DetailContent key={id} id={id} onPlay={onPlay} />
        ) : (
          <div className="flex h-72 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground/20 border-t-primary" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailContent({ id, onPlay }: { id: string; onPlay: Props["onPlay"] }) {
  const [season, setSeason] = useState<number | undefined>(undefined);
  const detail = useMediaDetail(id, season);
  const toggle = useToggleMyList();
  const saveProgress = useSaveProgress();
  const similar = useBrowse({
    genre: detail.data?.genres?.[0] ?? null,
    page: 1,
    pageSize: 12,
  });

  const d = detail.data;
  const currentSeason = season ?? d?.seasons?.[0]?.seasonNumber;
  const similarItems = (similar.data?.items ?? []).filter((m) => m.id !== id).slice(0, 8);
  const nextEpisode = d?.type === "TV" ? (d.nextEpisode ?? d.episodes[0] ?? null) : null;
  const nextEpisodeProgress =
    nextEpisode && d?.type === "TV"
      ? (d.episodes.find((ep) => ep.id === nextEpisode.id)?.progressPosition ??
        (d.progressEpisodeId === nextEpisode.id ? d.progressPosition ?? 0 : 0))
      : 0;
  const hasTvProgress =
    d?.type === "TV" &&
    (Boolean(d.progressEpisodeId) ||
      (d.progressPosition ?? 0) > 0 ||
      d.episodes.some((ep) => (ep.progressPosition ?? 0) > 0 || (ep.progressPercent ?? 0) > 0));
  const playLabel =
    d?.type === "TV"
      ? hasTvProgress
        ? "Play Next Episode"
        : "Play"
      : d?.progressPosition
        ? "Resume"
        : "Play";

  const handleMainPlay = () => {
    if (!d) return;
    if (d.type === "TV") {
      onPlay(d.id, nextEpisode?.id ?? null, nextEpisodeProgress);
    } else {
      onPlay(d.id, null, d.progressPosition ?? 0);
    }
  };

  const markEpisodeWatched = async (episodeId: string, runtime: number | null | undefined) => {
    if (!d) return;
    const duration = runtime && runtime > 0 ? runtime * 60 : 1;
    await saveProgress.mutateAsync({
      mediaId: d.id,
      episodeId,
      position: duration,
      duration,
      completed: true,
    });
  };

  if (!d) {
    return (
      <div className="flex h-72 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground/20 border-t-primary" />
      </div>
    );
  }

  return (
    <>
      <DialogTitle className="sr-only">{d.title}</DialogTitle>
      {/* hero */}
      <div className="relative aspect-video w-full overflow-hidden">
        <BackdropArea d={d} />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />
        <button
          onClick={() => useMediaStore.getState().closeDetail()}
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
              {d.type === "TV" ? "Series" : "Film"}
            </span>
            {d.trending && (
              <span className="rounded bg-foreground/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-foreground/70">
                Trending
              </span>
            )}
          </div>
          <h2 className="text-shadow-lg text-3xl font-black leading-tight tracking-tight sm:text-5xl">
            {d.title}
          </h2>
          {d.tagline && (
            <p className="mt-1.5 text-sm italic text-foreground/70">{d.tagline}</p>
          )}
        </div>
      </div>

      {/* body */}
      <div className="thin-scrollbar max-h-[calc(94vh-28vw)] overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {d.rating != null && (
            <span className="inline-flex items-center gap-1 font-semibold text-foreground">
              <Star className="h-4 w-4 fill-primary text-primary" />
              {d.rating.toFixed(1)}
              {d.voteCount ? (
                <span className="ml-0.5 font-normal text-foreground/50">
                  ({(d.voteCount / 1000).toFixed(1)}K)
                </span>
              ) : null}
            </span>
          )}
          {d.year && (
            <span className="inline-flex items-center gap-1 text-foreground/70">
              <Calendar className="h-4 w-4" />
              {d.year}
            </span>
          )}
          {d.runtime && (
            <span className="inline-flex items-center gap-1 text-foreground/70">
              <Clock className="h-4 w-4" />
              {formatRuntime(d.runtime)}
            </span>
          )}
          {d.certification && (
            <span className="rounded border border-foreground/30 px-1.5 py-0 text-[11px] font-semibold text-foreground/70">
              {d.certification}
            </span>
          )}
          {d.status && <span className="text-foreground/50">{d.status}</span>}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={handleMainPlay}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-2.5 text-sm font-bold text-black transition-transform hover:scale-105"
          >
            <Play className="h-5 w-5 fill-current" />
            {playLabel}
          </button>
          <button
            onClick={() => toggle.mutate(d.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border border-foreground/20 bg-foreground/10 px-5 py-2.5 text-sm font-semibold backdrop-blur transition-colors hover:bg-foreground/20",
              d.inMyList && "border-primary/50 text-primary"
            )}
          >
            {d.inMyList ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {d.inMyList ? "In My List" : "My List"}
          </button>
          <MediaActionsMenu
            media={d}
            onPlay={onPlay}
            showPlay={false}
            showMyList={false}
            triggerClassName="h-10 w-10 rounded-lg border-foreground/20 bg-foreground/10 text-foreground hover:border-foreground/30 hover:bg-foreground/20"
          />
        </div>

        {d.genres.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {d.genres.map((g) => (
              <span
                key={g}
                className="rounded-full bg-foreground/8 px-3 py-1 text-xs font-medium text-foreground/70"
              >
                {g}
              </span>
            ))}
          </div>
        )}

        {d.overview && (
          <div className="mt-5">
            <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-foreground/50">
              Overview
            </h3>
            <p className="text-sm leading-relaxed text-foreground/80">{d.overview}</p>
          </div>
        )}

        {/* TV: seasons + episodes */}
        {d.type === "TV" && d.seasons.length > 0 && (
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-foreground/50">
                Episodes
              </h3>
              {d.seasons.length > 1 && (
                <Select
                  value={String(currentSeason)}
                  onValueChange={(v) => setSeason(Number(v))}
                >
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {d.seasons.map((s) => (
                      <SelectItem key={s.seasonNumber} value={String(s.seasonNumber)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="thin-scrollbar max-h-[28rem] space-y-2 overflow-y-auto pr-1">
              {d.episodes.length === 0 && (
                <p className="py-6 text-center text-sm text-foreground/50">
                  No episodes found for this season.
                </p>
              )}
              {d.episodes.map((ep) => {
                const pct = progressPercent(ep);
                return (
                  <div
                    key={ep.id}
                    className="group flex gap-3 rounded-lg p-2 transition-colors hover:bg-foreground/5"
                  >
                    <button
                      onClick={() => onPlay(d.id, ep.id, ep.progressPosition ?? 0)}
                      className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-md bg-foreground/10 sm:w-44"
                      aria-label={`Play ${ep.title}`}
                    >
                      {ep.stillUrl ? (
                        <img src={ep.stillUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ProceduralPoster
                          title={`${d.title} ${ep.seasonNumber}x${ep.episodeNumber}`}
                          genres={d.genres}
                          variant="backdrop"
                          className="h-full w-full"
                          showTitle={false}
                        />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                        <Play className="h-7 w-7 fill-white text-white" />
                      </div>
                      {pct > 0 && (
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/30">
                          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-bold text-foreground/40">{ep.episodeNumber}</span>
                        <h4 className="truncate text-sm font-semibold text-foreground">{ep.title}</h4>
                        {ep.runtime && (
                          <span className="ml-auto shrink-0 text-xs text-foreground/50">
                            {formatRuntime(ep.runtime)}
                          </span>
                        )}
                      </div>
                      {ep.overview && (
                        <p className="mt-1 line-clamp-2 text-xs text-foreground/60">{ep.overview}</p>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={() => markEpisodeWatched(ep.id, ep.runtime)}
                          disabled={ep.completed || saveProgress.isPending}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors",
                            ep.completed
                              ? "border-primary/35 bg-primary/10 text-primary"
                              : "border-foreground/15 bg-foreground/5 text-foreground/58 hover:border-primary/35 hover:text-primary",
                            saveProgress.isPending && "opacity-60"
                          )}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {ep.completed ? "Watched" : "Mark watched"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* more like this */}
        {similarItems.length > 0 && (
          <div className="mt-8 -mx-5 sm:-mx-7">
            <ContentRow
              title="More Like This"
              items={similarItems}
              onOpen={(mid) => useMediaStore.getState().openDetail(mid)}
              onPlay={onPlay}
            />
          </div>
        )}
      </div>
    </>
  );
}

function BackdropArea({ d }: { d: NonNullable<ReturnType<typeof useMediaDetail>["data"]> }) {
  const [stage, setStage] = useState<number>(d.backdropUrl ? 0 : 1);
  if (stage === 0 && d.backdropUrl) {
    return (
      <img
        src={d.backdropUrl}
        alt=""
        className="h-full w-full object-cover"
        onError={() => setStage(1)}
      />
    );
  }
  if (stage === 1) {
    return (
      <img
        src="/brand/hero-1.png"
        alt=""
        className="h-full w-full object-cover"
        onError={() => setStage(2)}
      />
    );
  }
  return (
    <ProceduralPoster
      title={d.title}
      genres={d.genres}
      variant="backdrop"
      className="h-full w-full"
    />
  );
}
