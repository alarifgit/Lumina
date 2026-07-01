import { db } from "@/lib/db";
import { streamFile } from "@/lib/streamer";
import { probeCodecs, spawnTranscode, registerTranscodeCleanup } from "@/lib/transcoder";
import { Readable } from "stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ep = await db.episode.findUnique({ where: { id } });
  if (!ep) return Response.json({ error: "Not found" }, { status: 404 });
  if (ep.streamUrl) return Response.redirect(ep.streamUrl, 302);
  if (!ep.filePath) return Response.json({ error: "No file" }, { status: 404 });

  const url = new URL(req.url);
  const transcode = url.searchParams.get("transcode") === "1";
  const startTime = parseFloat(url.searchParams.get("t") ?? "0") || 0;

  if (transcode) {
    const codecs = await probeCodecs(ep.filePath);
    const proc = spawnTranscode(ep.filePath, codecs, { startTime });
    // Kill ffmpeg when the client disconnects (seeking, closing player, etc.)
    registerTranscodeCleanup(proc, req.signal);
    const webStream = Readable.toWeb(proc.stdout) as ReadableStream;
    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "no-store",
        "X-Lumina-Transcode": "1",
      },
    });
  }

  return streamFile(req, ep.filePath);
}
