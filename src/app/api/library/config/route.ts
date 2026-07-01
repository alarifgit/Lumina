import { NextResponse } from "next/server";
import { saveTmdbKey } from "@/lib/media-queries";

export const dynamic = "force-dynamic";

/** Save the global TMDB API key to LibraryConfig. */
export async function POST(req: Request) {
  try {
    const { tmdbKey } = (await req.json()) as { tmdbKey?: string };
    if (tmdbKey === undefined) {
      return NextResponse.json({ error: "tmdbKey is required" }, { status: 400 });
    }
    return NextResponse.json(await saveTmdbKey(tmdbKey));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
