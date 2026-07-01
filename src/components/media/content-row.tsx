"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { MediaSummary } from "@/lib/types";
import { MediaCard } from "./media-card";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  items: MediaSummary[];
  onOpen: (id: string) => void;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
  accent?: boolean;
}

export function ContentRow({ title, items, onOpen, onPlay, accent }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [canL, setCanL] = useState(false);
  const [canR, setCanR] = useState(false);
  const rafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  const update = () => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanL(left > 10);
    setCanR(left < maxScroll - 10);
  };

  // Debounced scroll handler — only run update once per animation frame
  // instead of on every scroll tick (which fires hundreds of times per scroll).
  const onScroll = () => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      update();
    });
  };

  useEffect(() => {
    update();
    const el = ref.current;
    if (el) el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      el?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [items]);

  const scrollBy = (dir: number) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  if (!items?.length) return null;

  return (
    <section className="group/row relative py-2">
      <div className="mb-2 px-4 sm:px-6 lg:px-8">
        <h2
          className={cn(
            "text-lg font-semibold tracking-tight sm:text-xl",
            accent && "text-foreground"
          )}
        >
          {title}
        </h2>
      </div>
      <div className="relative">
        {canL && (
          <button
            onClick={() => scrollBy(-1)}
            className="absolute left-0 top-0 z-20 hidden h-[calc(100%-0.5rem)] w-10 items-center justify-center bg-gradient-to-r from-background via-background/80 to-transparent text-foreground opacity-0 transition-opacity group-hover/row:opacity-100 md:flex lg:w-14"
            aria-label="Scroll left"
          >
            <ChevronLeft className="h-7 w-7" />
          </button>
        )}
        <div
          ref={ref}
          className="no-scrollbar flex gap-3 overflow-x-auto scroll-smooth px-4 pb-2 sm:gap-4 sm:px-6 lg:px-8"
        >
          {items.map((m) => (
            <div
              key={m.id}
              className="w-[130px] shrink-0 sm:w-[160px] md:w-[175px] lg:w-[190px]"
            >
              <MediaCard media={m} onOpen={onOpen} onPlay={onPlay} />
            </div>
          ))}
        </div>
        {canR && (
          <button
            onClick={() => scrollBy(1)}
            className="absolute right-0 top-0 z-20 hidden h-[calc(100%-0.5rem)] w-10 items-center justify-center bg-gradient-to-l from-background via-background/80 to-transparent text-foreground opacity-0 transition-opacity group-hover/row:opacity-100 md:flex lg:w-14"
            aria-label="Scroll right"
          >
            <ChevronRight className="h-7 w-7" />
          </button>
        )}
      </div>
    </section>
  );
}
