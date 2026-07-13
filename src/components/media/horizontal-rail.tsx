"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface HorizontalRailProps {
  children: ReactNode;
  itemCount: number;
  label: string;
  className?: string;
  viewportClassName?: string;
}

/**
 * Shared, resize-aware horizontal shelf. Desktop controls remain visible while
 * more content exists; touch layouts retain native momentum scrolling.
 */
export function HorizontalRail({
  children,
  itemCount,
  label,
  className,
  viewportClassName,
}: HorizontalRailProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateControls = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    setCanScrollLeft(viewport.scrollLeft > 8);
    setCanScrollRight(maxScroll > 8 && viewport.scrollLeft < maxScroll - 8);
  }, []);

  const scheduleUpdate = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      updateControls();
    });
  }, [updateControls]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    scheduleUpdate();
    viewport.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    observer?.observe(viewport);

    return () => {
      viewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      observer?.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [itemCount, scheduleUpdate]);

  const move = (direction: -1 | 1) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollBy({
      left: direction * Math.max(320, viewport.clientWidth * 0.82),
      behavior: "smooth",
    });
  };

  const controlClass =
    "absolute top-1/2 z-30 hidden h-[clamp(3rem,2vw,4rem)] w-[clamp(3rem,2vw,4rem)] -translate-y-1/2 items-center justify-center rounded-full border border-white/18 bg-[var(--lumina-ink)]/94 text-white shadow-[0_16px_38px_rgba(7,23,32,0.42)] backdrop-blur-xl transition-[transform,background-color,border-color] hover:scale-105 hover:border-white/32 hover:bg-[#102a37] active:scale-95 md:flex [&_svg]:h-[clamp(1.5rem,1vw,2rem)] [&_svg]:w-[clamp(1.5rem,1vw,2rem)]";

  return (
    <div className={cn("relative", className)}>
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => move(-1)}
          className={cn(controlClass, "left-3 sm:left-5 lg:left-7")}
          aria-label={`Show previous ${label}`}
        >
          <ChevronLeft />
        </button>
      )}

      <div
        ref={viewportRef}
        className={cn(
          "no-scrollbar flex snap-x snap-proximity scroll-px-4 overflow-x-auto overflow-y-visible scroll-smooth overscroll-x-contain sm:scroll-px-6 lg:scroll-px-8",
          viewportClassName
        )}
        role="region"
        aria-label={label}
      >
        {children}
      </div>

      {canScrollRight && (
        <button
          type="button"
          onClick={() => move(1)}
          className={cn(controlClass, "right-3 sm:right-5 lg:right-7")}
          aria-label={`Show more ${label}`}
        >
          <ChevronRight />
        </button>
      )}
    </div>
  );
}
