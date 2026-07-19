import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scanSection } from "@/lib/scanner";
import { enqueueScanJob, getScanJob, serializeScanJob } from "@/lib/scan-jobs";
import type { ScanResult } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

async function scanAllSections(body: { tmdbKey?: string; autoMatch?: boolean }) {
    const sections = await db.librarySection.findMany({ orderBy: { name: "asc" } });
    if (sections.length === 0) {
      return {
        scanned: 0, added: 0, updated: 0, skipped: 0,
        errors: ["No library sections configured. Add sections in the Library tab first."],
        durationMs: 0,
        complete: false,
        manifest: { complete: false, reconciliationApplied: false, entries: [] },
      } satisfies ScanResult;
    }
    const start = Date.now();
    const agg: ScanResult = {
      scanned: 0, added: 0, updated: 0, skipped: 0, errors: [], durationMs: 0,
      complete: true,
      manifest: { complete: true, reconciliationApplied: true, entries: [] },
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
      agg.complete = agg.complete && r.complete;
      agg.manifest.complete = agg.manifest.complete && r.manifest.complete;
      agg.manifest.reconciliationApplied = agg.manifest.reconciliationApplied && r.manifest.reconciliationApplied;
      agg.manifest.entries.push(...r.manifest.entries);
    }
    agg.durationMs = Date.now() - start;
    return agg;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  const job = getScanJob(jobId);
  if (!job || job.reportPath !== "/api/library/scan") {
    return NextResponse.json({ error: "Scan job not found" }, { status: 404 });
  }
  return NextResponse.json(serializeScanJob(job, url.searchParams.get("includeManifest") === "1"));
}

/** Queue an all-library scan and return immediately; GET polls its status. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      tmdbKey?: string;
      autoMatch?: boolean;
    };
    const job = enqueueScanJob("all", "/api/library/scan", () => scanAllSections(body));
    return NextResponse.json(serializeScanJob(job), { status: 202 });
  } catch (e) {
    return NextResponse.json(
      {
        error: (e as Error).message,
        scanned: 0, added: 0, updated: 0, skipped: 0,
        errors: [(e as Error).message],
        durationMs: 0,
        complete: false,
        manifest: { complete: false, reconciliationApplied: false, entries: [] },
      },
      { status: 500 }
    );
  }
}
