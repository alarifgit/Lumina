import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMediaDetail } from "@/lib/media-queries";
import { applyTmdbMetadata } from "@/lib/tmdb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { mediaId } = (await req.json()) as { mediaId?: string };
    if (!mediaId) {
      return NextResponse.json({ error: "mediaId required" }, { status: 400 });
    }

    const current = await db.media.findUnique({
      where: { id: mediaId },
      select: { tmdbId: true, type: true },
    });
    if (!current) {
      return NextResponse.json({ error: "Media item not found" }, { status: 404 });
    }
    if (!current.tmdbId) {
      return NextResponse.json(
        { error: "This item has no saved TMDB match. Use Fix match first." },
        { status: 409 }
      );
    }
    if (current.type !== "MOVIE" && current.type !== "TV") {
      return NextResponse.json({ error: "Unsupported media type" }, { status: 400 });
    }

    const result = await applyTmdbMetadata(mediaId, current.tmdbId, current.type);
    const media = await getMediaDetail(result.mediaId);
    return NextResponse.json({ ok: true, media });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
