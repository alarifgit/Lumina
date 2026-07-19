import { randomUUID } from "crypto";
import type { ScanManifestKind, ScanResult } from "@/lib/types";

export type ScanJobStatus = "queued" | "running" | "complete" | "failed";

export interface ScanJob {
  id: string;
  scope: string;
  reportPath: string;
  status: ScanJobStatus;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  result: ScanResult | null;
  error: string | null;
}

const scanJobGlobal = globalThis as typeof globalThis & {
  __luminaScanJobs?: Map<string, ScanJob>;
  __luminaActiveScanJobs?: Map<string, string>;
};

const jobs = scanJobGlobal.__luminaScanJobs ?? new Map<string, ScanJob>();
const activeJobs = scanJobGlobal.__luminaActiveScanJobs ?? new Map<string, string>();
scanJobGlobal.__luminaScanJobs = jobs;
scanJobGlobal.__luminaActiveScanJobs = activeJobs;

const MAX_RETAINED_JOBS = 24;

function pruneFinishedJobs() {
  const finished = [...jobs.values()]
    .filter((job) => job.status === "complete" || job.status === "failed")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const job of finished.slice(MAX_RETAINED_JOBS)) jobs.delete(job.id);
}

/**
 * Run a scan independently of the request that queued it. Lumina is a
 * long-lived self-hosted Node process, so detaching the work prevents a slow
 * NAS scan from being cancelled when the browser/request stream closes.
 */
export function enqueueScanJob(
  scope: string,
  reportPath: string,
  run: () => Promise<ScanResult>
) {
  const activeId = activeJobs.get(scope);
  const existing = activeId ? jobs.get(activeId) : null;
  if (existing && (existing.status === "queued" || existing.status === "running")) {
    return existing;
  }

  const job: ScanJob = {
    id: randomUUID(),
    scope,
    reportPath,
    status: "queued",
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
  };
  jobs.set(job.id, job);
  activeJobs.set(scope, job.id);
  pruneFinishedJobs();
  console.log(`[Lumina Scan] Queued ${scope} job ${job.id}`);

  setImmediate(async () => {
    job.status = "running";
    job.startedAt = new Date();
    console.log(`[Lumina Scan] Started ${scope} job ${job.id}`);
    try {
      job.result = await run();
      job.status = "complete";
      console.log(
        `[Lumina Scan] Completed ${scope} job ${job.id}: ${job.result.added} added, ${job.result.updated} updated, ${job.result.scanned} scanned`
      );
    } catch (error) {
      job.error = (error as Error).message;
      job.status = "failed";
      console.error(`[Lumina Scan] Failed ${scope} job ${job.id}:`, job.error);
    } finally {
      job.completedAt = new Date();
      if (activeJobs.get(scope) === job.id) activeJobs.delete(scope);
    }
  });

  return job;
}

export function getScanJob(jobId: string) {
  return jobs.get(jobId) ?? null;
}

function manifestCounts(result: ScanResult) {
  return result.manifest.entries.reduce<Partial<Record<ScanManifestKind, number>>>((counts, entry) => {
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
    return counts;
  }, {});
}

export function serializeScanJob(job: ScanJob, includeManifest = false) {
  const reportUrl = `${job.reportPath}?jobId=${encodeURIComponent(job.id)}&includeManifest=1`;
  const result = job.result
    ? includeManifest
      ? { ...job.result, reportUrl }
      : {
          ...job.result,
          reportUrl,
          manifest: {
            ...job.result.manifest,
            entries: [],
            entryCount: job.result.manifest.entries.length,
            counts: manifestCounts(job.result),
            entriesTruncated: job.result.manifest.entries.length > 0,
          },
        }
    : null;
  return {
    jobId: job.id,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    result,
    error: job.error,
  };
}

/** Test-only reset for the isolated job coordinator suite. */
export function clearScanJobsForTests() {
  jobs.clear();
  activeJobs.clear();
}
