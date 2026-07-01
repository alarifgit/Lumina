import { NextResponse } from "next/server";
import { toggleMyList } from "@/lib/media-queries";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { mediaId } = (await req.json()) as { mediaId?: string };
    if (!mediaId)
      return NextResponse.json({ error: "mediaId required" }, { status: 400 });
    return NextResponse.json(await toggleMyList(mediaId));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
