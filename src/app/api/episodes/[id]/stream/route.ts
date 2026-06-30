import { db } from "@/lib/db";
import { streamFile } from "@/lib/streamer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ep = await db.episode.findUnique({ where: { id } });
  if (!ep) return Response.json({ error: "Not found" }, { status: 404 });
  if (ep.streamUrl) return Response.redirect(ep.streamUrl, 302);
  if (!ep.filePath) return Response.json({ error: "No file" }, { status: 404 });
  return streamFile(req, ep.filePath);
}
