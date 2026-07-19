import { NextResponse } from "next/server";
import { browseMedia } from "@/lib/media-queries";
import type { BrowsePreset, BrowseSort, MediaType, WatchState } from "@/lib/types";

export const dynamic = "force-dynamic";

const BROWSE_PRESETS = [
  "recently-added-movies",
  "trending",
  "popular-movies",
  "popular-tv",
  "top-rated",
  "new-releases",
] as const satisfies readonly BrowsePreset[];

const WATCH_STATES = [
  "all",
  "unwatched",
  "in-progress",
  "watched",
] as const satisfies readonly WatchState[];

const BROWSE_SORTS = ["popular", "rating", "year", "title"] as const satisfies readonly BrowseSort[];

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = (searchParams.get("type") as MediaType | null) ?? undefined;
    const genre = searchParams.get("genre") || undefined;
    const category = searchParams.get("category") || undefined;
    const sectionId = searchParams.get("sectionId") || undefined;
    const q = searchParams.get("q") || undefined;
    const sortParam = searchParams.get("sort");
    const sort = BROWSE_SORTS.find((value) => value === sortParam);
    const presetParam = searchParams.get("preset");
    const watchStateParam = searchParams.get("watchState");
    const preset = BROWSE_PRESETS.find((value) => value === presetParam);
    const watchState = WATCH_STATES.find((value) => value === watchStateParam);
    const availabilityParam = searchParams.get("availability");
    const metadataParam = searchParams.get("metadata");
    const availability = ["available", "unavailable", "all"].includes(availabilityParam ?? "")
      ? availabilityParam as "available" | "unavailable" | "all"
      : undefined;
    const metadata = ["matched", "unmatched", "all"].includes(metadataParam ?? "")
      ? metadataParam as "matched" | "unmatched" | "all"
      : undefined;
    const page = searchParams.get("page") ? parseInt(searchParams.get("page")!, 10) : 1;
    const pageSize = searchParams.get("pageSize")
      ? parseInt(searchParams.get("pageSize")!, 10)
      : 24;
    const data = await browseMedia({
      type,
      genre,
      category,
      preset,
      watchState,
      sectionId,
      q,
      sort,
      page,
      pageSize,
      availability,
      metadata,
    });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
