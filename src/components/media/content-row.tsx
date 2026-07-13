import type { MediaSummary } from "@/lib/types";
import { MediaCard } from "./media-card";
import { HorizontalRail } from "./horizontal-rail";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  items: MediaSummary[];
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
  accent?: boolean;
}

export function ContentRow({ title, items, onOpen, onPlay, accent }: Props) {
  if (!items?.length) return null;

  return (
    <section className="lumina-page render-lazy-row relative py-4">
      <div className="mb-2 px-4 sm:px-6 lg:px-8">
        <h2
          className={cn(
            "lumina-shelf-heading text-lg font-semibold tracking-[-0.025em] text-white sm:text-xl",
            accent && "text-foreground"
          )}
        >
          {title}
        </h2>
      </div>
      <HorizontalRail
        itemCount={items.length}
        label={title}
        viewportClassName="gap-3 px-4 pb-6 pt-4 sm:gap-4 sm:px-6 lg:px-8"
      >
          {items.map((m) => (
            <div
              key={m.id}
              className="w-[clamp(142px,38vw,172px)] shrink-0 snap-start sm:w-[clamp(172px,22vw,210px)] lg:w-[clamp(210px,12.5vw,420px)]"
            >
              <MediaCard media={m} onOpen={onOpen} onPlay={onPlay} />
            </div>
          ))}
      </HorizontalRail>
    </section>
  );
}
