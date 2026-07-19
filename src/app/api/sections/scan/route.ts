import { NextResponse } from "next/server";
import { getLastSectionScanResult, scanSection } from "@/lib/scanner";
import { enqueueScanJob, getScanJob, serializeScanJob } from "@/lib/scan-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  if (jobId) {
    const job = getScanJob(jobId);
    if (!job || job.reportPath !== "/api/sections/scan") {
      return NextResponse.json({ error: "Scan job not found" }, { status: 404 });
    }
    return NextResponse.json(serializeScanJob(job, url.searchParams.get("includeManifest") === "1"));
  }
  const sectionId = url.searchParams.get("sectionId");
  if (!sectionId) {
    return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
  }
  const result = getLastSectionScanResult(sectionId);
  if (!result) {
    return NextResponse.json(
      { error: "No scan report is retained for this section in the current server session." },
      { status: 404 }
    );
  }
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      sectionId?: string;
      mediaDir?: string;
      tmdbKey?: string;
      autoMatch?: boolean;
    };
    if (!body?.sectionId) {
      return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    }
    const job = enqueueScanJob(
      `section:${body.sectionId}`,
      "/api/sections/scan",
      () => scanSection({
        sectionId: body.sectionId!,
        mediaDir: body.mediaDir,
        tmdbKey: body.tmdbKey,
        autoMatch: body.autoMatch,
      })
    );
    return NextResponse.json(serializeScanJob(job), { status: 202 });
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
        complete: false,
        manifest: { complete: false, reconciliationApplied: false, entries: [] },
      },
      { status: 500 }
    );
  }
}
