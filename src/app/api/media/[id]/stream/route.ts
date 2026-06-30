import { db } from "@/lib/db";
import { streamFile } from "@/lib/streamer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  return streamFile(req, media.filePath);
}
