"use client";

import { useHome } from "@/lib/queries";
import { HeroCarousel } from "./hero-carousel";
import { ContentRow } from "./content-row";
import { ContinueWatchingCard } from "./continue-watching-card";
import { ContentRowSkeleton, HeroSkeleton } from "./skeletons";
import { AlertCircle } from "lucide-react";
import type { MediaSummary } from "@/lib/types";

interface Props {
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
}

export function HomeView({ onOpen, onPlay }: Props) {
  const { data, isLoading, error } = useHome();

  if (isLoading) {
    return (
      <div>
        <HeroSkeleton />
        <div className="mt-6 space-y-4">
          <ContentRowSkeleton />
          <ContentRowSkeleton />
          <ContentRowSkeleton />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
        <AlertCircle className="mb-3 h-10 w-10 text-foreground/40" />
        <p className="text-sm text-foreground/70">
          Couldn’t load your library. {error?.message ?? ""}
        </p>
      </div>
    );
  }

  return (
    <div className="pb-10">
      {/* Hero pulls up under the transparent nav for a full-bleed cinematic feel */}
      <div className="-mt-16">
        <HeroCarousel items={data.featured} onOpen={onOpen} onPlay={onPlay} />
      </div>
      <div className="mt-6 space-y-5">
        {data.continueWatching.length > 0 && (
          <section className="py-2">
            <h2 className="mb-2 px-4 text-lg font-semibold tracking-tight sm:px-6 sm:text-xl lg:px-8">
              Continue Watching
            </h2>
            <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-2 sm:gap-4 sm:px-6 lg:px-8">
              {data.continueWatching.map((m: MediaSummary) => (
                <ContinueWatchingCard key={m.id} media={m} onPlay={onPlay} />
              ))}
            </div>
          </section>
        )}
        {data.rows.map((r) => (
          <ContentRow
            key={r.key}
            title={r.title}
            items={r.items}
            onOpen={onOpen}
            onPlay={onPlay}
          />
        ))}
        {data.rows.length === 0 && data.continueWatching.length === 0 && (
          <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
            <p className="text-sm text-foreground/60">
              Your library is empty. Head to <span className="font-semibold">Library</span> to scan
              your media.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
