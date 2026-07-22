import { NextResponse } from "next/server";
import {
  getPlaybackDecisionAudit,
  UnsupportedPlaybackAuditError,
} from "@/lib/playback-diagnostics";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const episodeId = new URL(req.url).searchParams.get("episodeId")?.trim() || undefined;
    if (episodeId && episodeId.length > 128) {
      return NextResponse.json({ error: "Invalid episode id" }, { status: 400 });
    }
    const result = await getPlaybackDecisionAudit(id, episodeId);
    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof UnsupportedPlaybackAuditError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Unable to resolve playback decision" },
      { status: 500 }
    );
  }
}
