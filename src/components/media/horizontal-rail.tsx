"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getRailEdgeState, getRailPageDistance } from "@/lib/rail-state";

const savedRailPositions = new Map<string, number>();

interface HorizontalRailProps {
  children: ReactNode;
  itemCount: number;
  label: string;
  className?: string;
  viewportClassName?: string;
  stateKey?: string;
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
  stateKey,
}: HorizontalRailProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const persistenceKey = stateKey ?? label;
  const [edgeState, setEdgeState] = useState(() =>
    getRailEdgeState(0, 0, 0)
  );

  const updateControls = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const nextState = getRailEdgeState(
      viewport.scrollLeft,
      viewport.scrollWidth,
      viewport.clientWidth
    );
    setEdgeState((current) =>
      current.canScrollLeft === nextState.canScrollLeft &&
      current.canScrollRight === nextState.canScrollRight &&
      current.maxScroll === nextState.maxScroll
        ? current
        : nextState
    );
  }, []);

  const scheduleUpdate = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      updateControls();
    });
  }, [updateControls]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let firstFrame = 0;
    let secondFrame = 0;
    const restorePosition = () => {
      const savedPosition = savedRailPositions.get(persistenceKey);
      if (savedPosition != null) {
        viewport.scrollLeft = Math.min(
          savedPosition,
          Math.max(0, viewport.scrollWidth - viewport.clientWidth)
        );
      }
      updateControls();
    };

    restorePosition();
    firstFrame = requestAnimationFrame(() => {
      restorePosition();
      secondFrame = requestAnimationFrame(restorePosition);
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [itemCount, persistenceKey, updateControls]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    scheduleUpdate();
    const handleScroll = () => {
      savedRailPositions.set(persistenceKey, viewport.scrollLeft);
      scheduleUpdate();
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    observer?.observe(viewport);

    return () => {
      // A browser may reset a detached scroller to zero before React runs the
      // passive cleanup. Keep the last scroll-event value in that case.
      if (viewport.scrollLeft > 0 || !savedRailPositions.has(persistenceKey)) {
        savedRailPositions.set(persistenceKey, viewport.scrollLeft);
      }
      viewport.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", scheduleUpdate);
      observer?.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [itemCount, persistenceKey, scheduleUpdate]);

  const move = (direction: -1 | 1) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollBy({
      left: direction * getRailPageDistance(viewport.clientWidth),
      behavior: "smooth",
    });
  };

  const controlClass =
    "absolute top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg border border-white/18 bg-[var(--lumina-ink)]/94 text-white shadow-[0_12px_30px_rgba(7,23,32,0.34)] backdrop-blur-xl transition-[background-color,border-color] hover:border-white/30 hover:bg-[#14313f] active:bg-[#0b202b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80 md:flex [&_svg]:h-5 [&_svg]:w-5";

  return (
    <div className={cn("relative", className)}>
      {edgeState.canScrollLeft && (
        <button
          type="button"
          onClick={() => move(-1)}
          className={cn(controlClass, "left-3")}
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

      {edgeState.canScrollRight && (
        <button
          type="button"
          onClick={() => move(1)}
          className={cn(controlClass, "right-3")}
          aria-label={`Show more ${label}`}
        >
          <ChevronRight />
        </button>
      )}
    </div>
  );
}
