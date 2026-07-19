import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  clearScanJobsForTests,
  enqueueScanJob,
  getScanJob,
  serializeScanJob,
} from "@/lib/scan-jobs";
import type { ScanResult } from "@/lib/types";

const result: ScanResult = {
  scanned: 1,
  added: 1,
  updated: 0,
  skipped: 0,
  errors: [],
  durationMs: 12,
  complete: true,
  manifest: {
    complete: true,
    reconciliationApplied: true,
    entries: [{ kind: "discovered", path: "/media/Movie.mkv", mediaType: "MOVIE" }],
  },
};

async function waitForJob(jobId: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const job = getScanJob(jobId);
    if (job?.status === "complete" || job?.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("Scan job did not finish in the fixture timeout.");
}

beforeEach(clearScanJobsForTests);

test("scan jobs detach work and expose compact then full reports", async () => {
  const job = enqueueScanJob("section:movies", "/api/sections/scan", async () => result);
  assert.match(job.status, /queued|running/);
  const finished = await waitForJob(job.id);
  assert.equal(finished.status, "complete");

  const compact = serializeScanJob(finished, false);
  assert.equal(compact.result?.manifest.entries.length, 0);
  assert.equal(compact.result?.manifest.entryCount, 1);
  assert.equal(compact.result?.manifest.counts?.discovered, 1);
  assert.match(compact.result?.reportUrl ?? "", /includeManifest=1/);

  const full = serializeScanJob(finished, true);
  assert.equal(full.result?.manifest.entries.length, 1);
});

test("duplicate clicks attach to the active job for the same scope", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const first = enqueueScanJob("section:tv", "/api/sections/scan", async () => {
    await blocked;
    return result;
  });
  const second = enqueueScanJob("section:tv", "/api/sections/scan", async () => result);
  assert.equal(second.id, first.id);
  release();
  assert.equal((await waitForJob(first.id)).status, "complete");
});

