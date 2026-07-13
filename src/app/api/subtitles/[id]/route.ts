import { NextResponse } from "next/server";
import { getSubtitle } from "@/lib/media-queries";
import { readSubtitleAsVtt } from "@/lib/subtitles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sub = await getSubtitle(id);
    if (!sub) {
      return NextResponse.json({ error: "Subtitle not found" }, { status: 404 });
    }
    // Remote/external subtitle — redirect to it
    if (sub.streamUrl) {
      // Relative URLs (e.g. "/subtitles/x.vtt") need to be made absolute for NextResponse.redirect
      if (sub.streamUrl.startsWith("http://") || sub.streamUrl.startsWith("https://")) {
        return NextResponse.redirect(sub.streamUrl, 302);
      }
      const origin = new URL(req.url).origin;
      return NextResponse.redirect(origin + sub.streamUrl, 302);
    }
    if (!sub.filePath) {
      return NextResponse.json({ error: "No subtitle file" }, { status: 404 });
    }
    // Local subtitle — serve as WebVTT (convert SRT/ASS on the fly)
    const vtt = await readSubtitleAsVtt(sub.filePath, sub.streamIndex);
    return new NextResponse(vtt, {
      status: 200,
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
