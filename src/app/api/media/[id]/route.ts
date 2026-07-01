import { NextResponse } from "next/server";
import { getMediaDetail } from "@/lib/media-queries";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const seasonParam = url.searchParams.get("season");
    const season = seasonParam ? parseInt(seasonParam, 10) : undefined;
    const media = await getMediaDetail(id, season);
    if (!media) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(media);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
