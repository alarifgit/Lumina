import { NextResponse } from "next/server";
import { applyTmdbMetadata } from "@/lib/tmdb";
import { getMediaDetail } from "@/lib/media-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { mediaId, tmdbId, type } = (await req.json()) as {
      mediaId?: string;
      tmdbId?: number;
      type?: "MOVIE" | "TV";
    };
    if (!mediaId || !tmdbId || !type)
      return NextResponse.json(
        { error: "mediaId, tmdbId and type required" },
        { status: 400 }
      );
    await applyTmdbMetadata(mediaId, tmdbId, type);
    const media = await getMediaDetail(mediaId);
    return NextResponse.json({ ok: true, media });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
