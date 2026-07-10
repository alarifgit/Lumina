import { NextResponse } from "next/server";
import { getLibraryConfig, saveLibraryConfig } from "@/lib/media-queries";
import type { PlexSyncDirection } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getLibraryConfig());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Save global library/provider settings. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      tmdbKey?: string;
      plexUrl?: string;
      plexToken?: string;
      plexSyncDirection?: PlexSyncDirection;
    };
    return NextResponse.json(await saveLibraryConfig(body));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
