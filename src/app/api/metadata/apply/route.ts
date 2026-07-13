import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
    const result = await applyTmdbMetadata(mediaId, tmdbId, type);
    const media = await getMediaDetail(result.mediaId);
    return NextResponse.json({ ok: true, media });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "That TMDB title is already attached to another library item. Rescan the library, then try the match again." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
