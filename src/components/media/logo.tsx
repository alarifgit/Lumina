"use client";

import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { Play } from "lucide-react";

/**
 * Lumina brand mark — a radiant sun whose rays are play-button triangles,
 * with a glowing play symbol at its core. Combines "sun/light" (Lumina) with
 * "media playback" (streaming) in a single iconic silhouette.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="lumina-sun" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#FFF7E0" />
          <stop offset="35%" stopColor="#FCD34D" />
          <stop offset="70%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#B45309" />
        </radialGradient>
        <radialGradient id="lumina-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFBEB" />
          <stop offset="100%" stopColor="#FDE68A" stopOpacity="0.8" />
        </radialGradient>
        <linearGradient id="lumina-ray" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FCD34D" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
      </defs>

      {/* Play-button-triangle rays (8 triangles radiating outward) */}
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = i * 45;
        const isLong = i % 2 === 0;
        return (
          <polygon
            key={i}
            points="22,2 26,2 24,14"
            fill="url(#lumina-ray)"
            transform={`rotate(${angle} 24 24)`}
            opacity={isLong ? 1 : 0.75}
          />
        );
      })}

      {/* Sun core circle */}
      <circle cx="24" cy="24" r="13" fill="url(#lumina-sun)" />
      <circle
        cx="24"
        cy="24"
        r="13"
        fill="none"
        stroke="#FDE68A"
        strokeOpacity="0.3"
        strokeWidth="0.5"
      />

      {/* Play triangle at the center (the "light" of Lumina = playback) */}
      <path
        d="M21 19 L31 24 L21 29 Z"
        fill="#1A0F00"
        opacity="0.85"
      />
    </svg>
  );
}

export function Logo({
  className,
  showWord = true,
  size = "md",
}: {
  className?: string;
  showWord?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const dim =
    size === "sm" ? "h-6 w-6" : size === "lg" ? "h-10 w-10" : "h-7 w-7";
  const word =
    size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-lg";
  return (
    <div className={cn("flex items-center gap-2 select-none", className)}>
      <LogoMark className={cn(dim, "drop-shadow-[0_0_10px_rgba(245,158,11,0.5)]")} />
      {showWord && (
        <span
          className={cn(
            "font-bold tracking-tight",
            word
          )}
          style={{
            letterSpacing: "-0.02em",
            background: "linear-gradient(135deg, #FFFBEB 0%, #FCD34D 50%, #F59E0B 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          Lumina
        </span>
      )}
    </div>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-foreground/10 hover:text-foreground",
        className
      )}
    >
      <span className="text-base">{isDark ? "☀" : "☾"}</span>
    </button>
  );
}
