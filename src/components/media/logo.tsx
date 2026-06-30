"use client";

import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";

/** Luminous aperture mark — the Lumina brand icon (pure SVG, themeable). */
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
        <radialGradient id="lumina-gold" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#FFF1D0" />
          <stop offset="45%" stopColor="#F5B642" />
          <stop offset="100%" stopColor="#B45309" />
        </radialGradient>
        <radialGradient id="lumina-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFBEB" />
          <stop offset="100%" stopColor="#FDE68A" />
        </radialGradient>
      </defs>
      {Array.from({ length: 12 }).map((_, i) => {
        const a = i * 30;
        return (
          <rect
            key={i}
            x="22.5"
            y="1.5"
            width="3"
            height="10"
            rx="1.5"
            fill="url(#lumina-gold)"
            transform={`rotate(${a} 24 24)`}
            opacity={i % 2 === 0 ? 0.95 : 0.7}
          />
        );
      })}
      <circle cx="24" cy="24" r="10" fill="url(#lumina-gold)" />
      <circle cx="24" cy="24" r="10" fill="none" stroke="#FDE68A" strokeOpacity="0.4" strokeWidth="0.75" />
      <circle cx="24" cy="24" r="4" fill="url(#lumina-core)" />
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
      <LogoMark className={cn(dim, "drop-shadow-[0_0_8px_rgba(245,182,66,0.45)]")} />
      {showWord && (
        <span
          className={cn(
            "font-semibold tracking-tight",
            word
          )}
          style={{ letterSpacing: "-0.02em" }}
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
