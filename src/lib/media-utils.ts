// Helpers for media display + procedural poster/backdrop generation.

import type { MediaSummary, MediaType } from "./types";

/** Format a runtime in minutes -> "2h 14m" or "47m". */
export function formatRuntime(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Format seconds -> "1:23:45" or "23:45". */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatNumber(n: number | null | undefined): string {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

/** Deterministic 32-bit string hash. */
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Genre -> base hue (0-360). Warm, cinematic palette — avoids pure blue/indigo.
const GENRE_HUES: Record<string, number> = {
  Action: 14,
  Adventure: 28,
  Animation: 45,
  Comedy: 38,
  Crime: 350,
  Documentary: 160,
  Drama: 35,
  Family: 30,
  Fantasy: 280,
  History: 32,
  Horror: 0,
  Music: 50,
  Mystery: 315,
  Romance: 8,
  "Science Fiction": 190,
  Thriller: 340,
  War: 20,
  Western: 36,
  "TV Movie": 40,
  "Action & Adventure": 18,
  "Kids": 50,
  News: 200,
  Reality: 25,
  "Sci-Fi & Fantasy": 250,
  Soap: 5,
  Talk: 40,
  "War & Politics": 20,
};

/** Pick a hue for a media item from its genres (fallback to title hash). */
export function hueForMedia(title: string, genres: string[]): number {
  for (const g of genres) {
    if (GENRE_HUES[g] != null) return GENRE_HUES[g];
  }
  return 20 + (hashString(title) % 60);
}

/**
 * Build a CSS gradient string for a procedural poster/backdrop.
 * Looks like boutique minimalist poster art (Mubi/Apple TV vibes).
 */
export function posterGradient(title: string, genres: string[], variant: "poster" | "backdrop" = "poster"): string {
  const h = hueForMedia(title, genres);
  const c1 = `hsl(${h} 38% 14%)`;
  const c2 = `hsl(${(h + 24) % 360} 30% 22%)`;
  const c3 = `hsl(${(h + 340) % 360} 45% 8%)`;
  if (variant === "backdrop") {
    return `radial-gradient(120% 90% at 75% 15%, ${c2} 0%, ${c1} 38%, ${c3} 100%)`;
  }
  return `linear-gradient(155deg, ${c2} 0%, ${c1} 48%, ${c3} 100%)`;
}

/** Initials / short label used on procedural posters. */
export function posterInitials(title: string): string {
  const words = title.replace(/[^a-zA-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "•";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function progressPercent(item: {
  progressPercent?: number;
  progressPosition?: number;
  progressDuration?: number;
}): number {
  if (item.progressPercent != null) return Math.min(100, Math.max(0, item.progressPercent));
  if (item.progressPosition && item.progressDuration && item.progressDuration > 0) {
    return Math.min(100, (item.progressPosition / item.progressDuration) * 100);
  }
  return 0;
}

/**
 * Generic TV controls leave episode selection to the shared server resolver.
 * Only an explicitly resume-oriented surface may pass stored episode progress
 * through as an exact target.
 */
export function playbackRequestForSummary(
  item: Pick<MediaSummary, "type" | "progressEpisodeId" | "progressPosition">,
  intent: "show" | "resume" = "show"
): { episodeId: string | null; startAt: number } {
  if (item.type === "TV" && intent === "show") {
    return { episodeId: null, startAt: 0 };
  }
  return {
    episodeId: item.progressEpisodeId ?? null,
    startAt: item.progressPosition ?? 0,
  };
}

export function typeLabel(type: MediaType): string {
  return type === "TV" ? "TV Series" : "Movie";
}

/** Sort + group helpers for episodes. */
export function groupEpisodesBySeason<T extends { seasonNumber: number; episodeNumber: number }>(episodes: T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const e of episodes) {
    const arr = map.get(e.seasonNumber) ?? [];
    arr.push(e);
    map.set(e.seasonNumber, arr);
  }
  for (const [, arr] of map) arr.sort((a, b) => a.episodeNumber - b.episodeNumber);
  return map;
}

export function mediaHref(item: Pick<MediaSummary, "id">): string {
  return `/media/${item.id}`;
}
