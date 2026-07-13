"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

const BRAND_ROOT = "/brand/lumina/codex-logo-pack/lumina_codex_logo_pack";
const EMBLEM_MINIMAL = `${BRAND_ROOT}/transparent/lumina-small-icon-gold-transparent-512.png`;
const EMBLEM_RADIANT = `${BRAND_ROOT}/transparent/lumina-emblem-gold-transparent-512.png`;

/** Compact brand mark used in the navbar. */
export function Logo({
  className,
  showWord = true,
  size = "md",
}: {
  className?: string;
  showWord?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const emblemPx = size === "sm" ? 30 : size === "lg" ? 54 : 40;

  if (showWord) {
    return (
      <span
        aria-label="Lumina"
        className={cn(
          "select-none font-sans font-semibold leading-none tracking-[-0.045em] text-white",
          size === "sm" && "text-xl",
          size === "md" && "text-2xl",
          size === "lg" && "text-[1.75rem]",
          className
        )}
      >
        Lumina<span className="text-primary">.</span>
      </span>
    );
  }

  return (
    <Image
      src={EMBLEM_MINIMAL}
      alt="Lumina"
      width={emblemPx}
      height={emblemPx}
      className={cn(
        "select-none object-contain drop-shadow-[0_0_14px_rgba(245,182,42,0.28)]",
        className
      )}
      priority
    />
  );
}

/** Full wordmark — for brand-led areas (footer, empty states, about). */
export function LogoLockup({
  className,
  width = 220,
}: {
  className?: string;
  width?: number;
}) {
  return (
    <span
      aria-label="Lumina"
      className={cn("inline-block font-sans text-5xl font-semibold leading-none tracking-[-0.055em] text-white", className)}
      style={{ fontSize: `clamp(2.5rem, ${Math.max(3, width / 42)}vw, 5rem)` }}
    >
      Lumina<span className="text-primary">.</span>
    </span>
  );
}

export function LogoEmblem({
  className,
  detailed = false,
  size = 96,
}: {
  className?: string;
  detailed?: boolean;
  size?: number;
}) {
  return (
    <Image
      src={detailed ? EMBLEM_RADIANT : EMBLEM_MINIMAL}
      alt="Lumina emblem"
      width={size}
      height={size}
      className={cn(
        "object-contain drop-shadow-[0_0_18px_rgba(245,182,42,0.2)]",
        className
      )}
      priority
    />
  );
}
