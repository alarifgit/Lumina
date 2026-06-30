import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scanSection } from "@/lib/scanner";
import type { ScanResult } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Scan ALL library sections sequentially. Returns an aggregated result. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      tmdbKey?: string;
      autoMatch?: boolean;
    };
    const sections = await db.librarySection.findMany({ orderBy: { name: "asc" } });
    if (sections.length === 0) {
      return NextResponse.json({
        scanned: 0, added: 0, updated: 0, skipped: 0,
        errors: ["No library sections configured. Add sections in the Library tab first."],
        durationMs: 0,
      });
    }
    const start = Date.now();
    const agg: ScanResult = {
      scanned: 0, added: 0, updated: 0, skipped: 0, errors: [], durationMs: 0,
    };
    for (const s of sections) {
      const r = await scanSection({
        sectionId: s.id,
        tmdbKey: body.tmdbKey,
        autoMatch: body.autoMatch,
      });
      agg.scanned += r.scanned;
      agg.added += r.added;
      agg.updated += r.updated;
      agg.skipped += r.skipped;
      agg.errors.push(...r.errors.map((e) => `[${s.name}] ${e}`));
    }
    agg.durationMs = Date.now() - start;
    return NextResponse.json(agg);
  } catch (e) {
    return NextResponse.json(
      {
        error: (e as Error).message,
        scanned: 0, added: 0, updated: 0, skipped: 0,
        errors: [(e as Error).message],
        durationMs: 0,
      },
      { status: 500 }
    );
  }
}
