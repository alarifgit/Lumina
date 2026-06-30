import { NextResponse } from "next/server";
import { scanLibrary } from "@/lib/scanner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      mediaDir?: string;
      tmdbKey?: string;
      autoMatch?: boolean;
    };
    const result = await scanLibrary({
      mediaDir: body.mediaDir,
      tmdbKey: body.tmdbKey,
      autoMatch: body.autoMatch,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        error: (e as Error).message,
        scanned: 0,
        added: 0,
        updated: 0,
        skipped: 0,
        errors: [(e as Error).message],
        durationMs: 0,
      },
      { status: 500 }
    );
  }
}
