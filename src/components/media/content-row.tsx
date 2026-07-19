import type { MediaSummary } from "@/lib/types";
import { MediaCard } from "./media-card";
import { HorizontalRail } from "./horizontal-rail";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

interface Props {
  title: string;
  eyebrow?: string;
  items: MediaSummary[];
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
  onViewAll?: () => void;
  accent?: boolean;
}

export function ContentRow({ title, eyebrow, items, onOpen, onPlay, onViewAll, accent }: Props) {
  if (!items?.length) return null;

  return (
    <section className="lumina-page render-lazy-row lumina-reveal relative py-5">
      <div className="mb-1 flex items-end justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div>
          {eyebrow && <p className="lumina-shelf-kicker mb-2">{eyebrow}</p>}
          <h2
            className={cn(
              "lumina-shelf-heading text-lg font-semibold tracking-[-0.035em] text-white sm:text-xl",
              accent && "text-foreground"
            )}
          >
            {title}
          </h2>
        </div>
        {onViewAll ? (
          <button
            type="button"
            onClick={onViewAll}
            className="group/view-all inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.055] px-3 py-1.5 text-[11px] font-semibold text-white/62 transition-colors hover:border-white/20 hover:bg-white/[0.10] hover:text-white"
            aria-label={`View all ${title}`}
          >
            View all
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/view-all:translate-x-0.5" />
          </button>
        ) : (
          <span className="hidden pb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/36 tabular-nums sm:block">
            {items.length} {items.length === 1 ? "title" : "titles"}
          </span>
        )}
      </div>
      <HorizontalRail
        itemCount={items.length}
        label={title}
        viewportClassName="gap-3 px-4 pb-6 pt-4 sm:gap-4 sm:px-6 lg:px-8"
      >
          {items.map((m) => (
            <div
              key={m.id}
              className="w-[clamp(138px,37vw,168px)] shrink-0 snap-start sm:w-[clamp(164px,21vw,198px)] lg:w-[clamp(188px,10.5vw,300px)]"
            >
              <MediaCard media={m} onOpen={onOpen} onPlay={onPlay} />
            </div>
          ))}
      </HorizontalRail>
    </section>
  );
}
