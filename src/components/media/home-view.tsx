"use client";

import { useHome } from "@/lib/queries";
import { useMediaStore } from "@/store/media-store";
import { Button } from "@/components/ui/button";
import { HeroCarousel } from "./hero-carousel";
import { ContentRow } from "./content-row";
import { ContinueWatchingCard } from "./continue-watching-card";
import { ContentRowSkeleton, HeroSkeleton } from "./skeletons";
import { LogoEmblem, LogoLockup } from "./logo";
import {
  AlertCircle,
  ArrowRight,
  Clapperboard,
  FolderPlus,
  HardDrive,
  Library,
  ScanSearch,
  Sparkles,
} from "lucide-react";
import type { MediaSummary } from "@/lib/types";

interface Props {
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
}

export function HomeView({ onOpen, onPlay }: Props) {
  const { data, isLoading, error } = useHome();
  const setRoute = useMediaStore((s) => s.setRoute);

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

  const rowsWithItems = data.rows.filter((row) => row.items.length > 0);
  const hasLibraryContent =
    data.featured.length > 0 ||
    data.continueWatching.length > 0 ||
    rowsWithItems.length > 0;

  if (!hasLibraryContent) {
    return (
      <EmptyHomeState
        onAddLibrary={() => setRoute("settings")}
        onOpenLibrary={() => setRoute("library")}
      />
    );
  }

  return (
    <div className="pb-10">
      {data.featured.length > 0 && (
        <div>
          <HeroCarousel items={data.featured} onOpen={onOpen} onPlay={onPlay} />
        </div>
      )}
      <div className="mt-6 space-y-5">
        {data.continueWatching.length > 0 && (
          <section className="render-lazy-row py-4">
            <h2 className="mb-2 px-4 text-lg font-semibold tracking-tight sm:px-6 sm:text-xl lg:px-8">
              Continue Watching
            </h2>
            <div className="no-scrollbar flex gap-3 overflow-x-auto overflow-y-visible px-4 pb-6 pt-4 sm:gap-4 sm:px-6 lg:px-8">
              {data.continueWatching.map((m: MediaSummary) => (
                <ContinueWatchingCard key={m.id} media={m} onPlay={onPlay} />
              ))}
            </div>
          </section>
        )}
        {rowsWithItems.map((r) => (
          <ContentRow
            key={r.key}
            title={r.title}
            items={r.items}
            onOpen={onOpen}
            onPlay={onPlay}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyHomeState({
  onAddLibrary,
  onOpenLibrary,
}: {
  onAddLibrary: () => void;
  onOpenLibrary: () => void;
}) {
  const setupSteps = [
    {
      icon: FolderPlus,
      label: "Library Paths",
      detail: "Add movie, TV, anime, or NAS folders.",
    },
    {
      icon: Sparkles,
      label: "Metadata Providers",
      detail: "Set TMDB artwork and language preferences.",
    },
    {
      icon: ScanSearch,
      label: "Scanning & Indexing",
      detail: "Build shelves, runtime, artwork, and resume data.",
    },
  ];

  return (
    <section className="lumina-page px-4 pb-16 pt-24 sm:px-6 lg:px-8">
      <div className="lumina-panel film-grain relative isolate overflow-hidden rounded-xl" aria-labelledby="empty-home-title">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(112deg,rgba(217,170,76,0.16)_0%,rgba(217,170,76,0)_32%),linear-gradient(135deg,rgba(12,26,45,0.92),rgba(3,4,5,0.64)_48%,rgba(3,4,5,0.94))]" />
        <div className="pointer-events-none absolute -right-12 top-10 opacity-[0.06] sm:right-8 sm:top-8">
          <LogoEmblem detailed size={360} />
        </div>

        <div className="relative grid gap-8 px-6 py-8 sm:px-9 sm:py-10 lg:min-h-[560px] lg:grid-cols-[minmax(0,1fr)_420px] lg:px-12 lg:py-12">
          <div className="flex max-w-3xl flex-col justify-center">
            <div className="mb-6">
              <LogoLockup width={230} />
            </div>
            <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-[var(--line-soft)] bg-white/[0.045] px-3 py-1 text-xs font-semibold text-foreground/64">
              <Clapperboard className="h-3.5 w-3.5 text-[var(--lumina-gold-soft)]" />
              Ready for first light
            </div>
            <h1
              id="empty-home-title"
              className="lumina-title max-w-3xl text-5xl font-semibold leading-[0.95] sm:text-6xl lg:text-7xl"
            >
              Build your private cinema.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-foreground/72 sm:text-lg">
              Connect your media roots and Lumina will turn the archive into cinematic shelves,
              resume points, artwork, and search.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" onClick={onAddLibrary} className="rounded-full">
                <FolderPlus className="h-4 w-4" />
                Add library path
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={onOpenLibrary}
                className="rounded-full"
              >
                <Library className="h-4 w-4" />
                Open library
              </Button>
            </div>
          </div>

          <aside className="self-end border-t border-[var(--line-soft)] pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="label-eyebrow text-primary/90">Media access</p>
                <h2 className="lumina-title mt-1 text-3xl font-semibold">Control room</h2>
              </div>
              <div className="grid h-12 w-12 place-items-center rounded-full border border-[var(--line-bright)] bg-primary/10 text-primary">
                <HardDrive className="h-5 w-5" />
              </div>
            </div>

            <ol className="divide-y divide-[var(--line-soft)] rounded-lg border border-[var(--line-soft)] bg-[#07101c]/66">
              {setupSteps.map((step) => {
                const Icon = step.icon;
                return (
                  <li key={step.label} className="grid grid-cols-[38px_minmax(0,1fr)] gap-3 p-4">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block font-semibold text-foreground">{step.label}</span>
                      <span className="mt-1 block text-sm leading-5 text-foreground/58">
                        {step.detail}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>

            <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs text-foreground/54">
              <div className="rounded-lg border border-[var(--line-soft)] bg-white/[0.035] px-2 py-3">
                <span className="block text-lg font-semibold text-foreground tabular-nums">0</span>
                titles
              </div>
              <div className="rounded-lg border border-[var(--line-soft)] bg-white/[0.035] px-2 py-3">
                <span className="block text-lg font-semibold text-foreground tabular-nums">0</span>
                paths
              </div>
              <div className="rounded-lg border border-[var(--line-soft)] bg-white/[0.035] px-2 py-3">
                <span className="block text-base font-semibold text-foreground">Direct</span>
                play
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
