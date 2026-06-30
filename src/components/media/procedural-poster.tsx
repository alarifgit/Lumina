"use client";

import { cn } from "@/lib/utils";
import {
  posterGradient,
  posterInitials,
  hueForMedia,
} from "@/lib/media-utils";

interface Props {
  title: string;
  genres: string[];
  variant?: "poster" | "backdrop";
  className?: string;
  showTitle?: boolean;
}

/** Boutique-style procedural poster/backdrop used when no real image is available. */
export function ProceduralPoster({
  title,
  genres,
  variant = "poster",
  className,
  showTitle = true,
}: Props) {
  const grad = posterGradient(title, genres, variant);
  const hue = hueForMedia(title, genres);
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ background: grad }}>
      <div
        className="absolute inset-0 opacity-40 mix-blend-overlay"
        style={{
          background: `radial-gradient(circle at 50% ${variant === "backdrop" ? "40%" : "30%"}, hsl(${hue} 70% 75% / 0.35), transparent 60%)`,
        }}
      />
      <div className="absolute inset-0 opacity-[0.04] film-grain" />
      {showTitle && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
          <span className="bg-gradient-to-b from-white to-white/70 bg-clip-text text-4xl font-black tracking-tight text-transparent drop-shadow-sm sm:text-5xl">
            {posterInitials(title)}
          </span>
          <span className="mt-2 line-clamp-3 max-w-[90%] text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60 sm:text-xs">
            {title}
          </span>
        </div>
      )}
      <span className="absolute bottom-2 right-2.5 text-[8px] font-bold tracking-[0.25em] text-white/35">
        LUMINA
      </span>
    </div>
  );
}
