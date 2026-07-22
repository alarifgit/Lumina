import { NextResponse } from "next/server";
import {
  dismissContinueWatching,
  InvalidProgressTargetError,
} from "@/lib/media-queries";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      mediaId?: string;
      episodeId?: string | null;
      duration?: number;
    };
    if (!body.mediaId) {
      return NextResponse.json({ error: "mediaId required" }, { status: 400 });
    }
    const result = await dismissContinueWatching({
      mediaId: body.mediaId,
      episodeId: body.episodeId,
      duration: typeof body.duration === "number" ? body.duration : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InvalidProgressTargetError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
