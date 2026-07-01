import { db } from "@/lib/db";
import { streamFile } from "@/lib/streamer";
import { probeCodecs, spawnTranscode } from "@/lib/transcoder";
import { Readable } from "stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const media = await db.media.findUnique({ where: { id } });
  if (!media) return Response.json({ error: "Not found" }, { status: 404 });
  // If a remote stream URL is set, redirect to it (used for demo content).
  if (media.streamUrl) return Response.redirect(media.streamUrl, 302);
  if (!media.filePath) return Response.json({ error: "No file" }, { status: 404 });

  const url = new URL(req.url);
  const transcode = url.searchParams.get("transcode") === "1";
  const startTime = parseFloat(url.searchParams.get("t") ?? "0") || 0;

  if (transcode) {
    const codecs = await probeCodecs(media.filePath);
    const proc = spawnTranscode(media.filePath, codecs, { startTime });
    const webStream = Readable.toWeb(proc.stdout) as ReadableStream;
    // If ffmpeg dies early, the stream ends — the player will show an error.
    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "no-store",
        "X-Lumina-Transcode": "1",
      },
    });
  }

  return streamFile(req, media.filePath);
}
