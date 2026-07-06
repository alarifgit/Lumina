"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

const BRAND_ROOT = "/brand/lumina/codex-logo-pack/lumina_codex_logo_pack";
const WORDMARK_GOLD = `${BRAND_ROOT}/transparent/lumina-primary-wordmark-gold-transparent.png`;
const WORDMARK_COMPACT = `${BRAND_ROOT}/transparent/lumina-wordmark-white-transparent.png`;
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
    const width = size === "sm" ? 118 : size === "lg" ? 176 : 148;
    const height = size === "sm" ? 36 : size === "lg" ? 54 : 44;
    return (
      <img
        src={size === "sm" ? WORDMARK_COMPACT : WORDMARK_GOLD}
        alt="Lumina"
        width={width}
        height={height}
        className={cn(
          "select-none object-contain object-left drop-shadow-[0_0_18px_rgba(238,209,132,0.18)]",
          className
        )}
        style={{ width, height: "auto" }}
      />
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
    <img
      src={WORDMARK_GOLD}
      alt="Lumina"
      width={width}
      height={Math.round(width * 0.3)}
      className={cn("object-contain drop-shadow-[0_0_24px_rgba(238,209,132,0.2)]", className)}
      style={{ width, height: "auto" }}
    />
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
