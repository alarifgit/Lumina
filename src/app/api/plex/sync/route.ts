import { NextResponse } from "next/server";
import { syncPlexWatched, type PlexSyncDirection } from "@/lib/plex-sync";

export const dynamic = "force-dynamic";

function directionOf(value: unknown): PlexSyncDirection {
  return value === "push" || value === "two-way" ? value : "pull";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await syncPlexWatched({
      url: typeof body?.url === "string" ? body.url : undefined,
      token: typeof body?.token === "string" ? body.token : undefined,
      direction: directionOf(body?.direction),
      apply: body?.apply === true,
      sectionId: typeof body?.sectionId === "string" && body.sectionId ? body.sectionId : null,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
