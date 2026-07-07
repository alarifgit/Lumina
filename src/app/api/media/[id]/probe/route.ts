import { db } from "@/lib/db";
import { probeCodecs } from "@/lib/transcoder";
import type { CodecInfo } from "@/lib/transcoder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const media = await db.media.findUnique({ where: { id } });
  if (!media) return Response.json({ error: "Not found" }, { status: 404 });

  // Remote/demo stream — assume compatible
  if (media.streamUrl || !media.filePath) {
    const info: CodecInfo = {
      videoCodec: null,
      audioCodec: null,
      container: null,
      browserCompatible: true,
      reason: null,
      directPlayable: true,
      directPlayReason: null,
    };
    return Response.json(info);
  }

  const info = await probeCodecs(media.filePath);
  return Response.json(info);
}
