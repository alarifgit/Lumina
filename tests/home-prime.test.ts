import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { HomeData } from "@/lib/types";
import {
  getHomeDataAfterPrime,
  primeHomeData,
  resetHomePrimeForTests,
} from "@/lib/home-prime";

const payload = (title: string): HomeData => ({
  featured: [],
  continueWatching: [],
  rows: [{ key: "test", title, items: [] }],
});

beforeEach(() => resetHomePrimeForTests());

test("serves the prepared Home payload once without repeating the loader", async () => {
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return payload(`load-${calls}`);
  };

  await primeHomeData(loader);
  const first = await getHomeDataAfterPrime(loader);
  const second = await getHomeDataAfterPrime(loader);

  assert.equal(first.rows[0]?.title, "load-1");
  assert.equal(second.rows[0]?.title, "load-2");
  assert.equal(calls, 2);
});

test("deduplicates a request that arrives while startup priming is pending", async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loader = async () => {
    calls += 1;
    await gate;
    return payload("primed");
  };

  const priming = primeHomeData(loader);
  const request = getHomeDataAfterPrime(loader);
  release?.();

  assert.equal((await request).rows[0]?.title, "primed");
  await priming;
  assert.equal(calls, 1);
});

test("discards an expired prepared payload", async () => {
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return payload(`load-${calls}`);
  };

  await primeHomeData(loader, 1);
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal((await getHomeDataAfterPrime(loader)).rows[0]?.title, "load-2");
  assert.equal(calls, 2);
});
