import type { HomeData } from "@/lib/types";

type HomeLoader = () => Promise<HomeData>;

type HomePrimeState = {
  value: HomeData | null;
  expiresAt: number;
  pending: Promise<HomeData> | null;
};

const HOME_PRIME_TTL_MS = 60_000;
const globalHomePrime = globalThis as typeof globalThis & {
  __luminaHomePrime?: HomePrimeState;
};

function state() {
  globalHomePrime.__luminaHomePrime ??= {
    value: null,
    expiresAt: 0,
    pending: null,
  };
  return globalHomePrime.__luminaHomePrime;
}

/**
 * Prepare one Home payload during server bootstrap. The value is consumed by
 * the first Home request, so normal query invalidation and watcher freshness
 * are unchanged after startup.
 */
export function primeHomeData(loader: HomeLoader, ttlMs = HOME_PRIME_TTL_MS) {
  const cache = state();
  if (cache.value && cache.expiresAt > Date.now()) return Promise.resolve(cache.value);
  if (cache.pending) return cache.pending;

  let pending: Promise<HomeData>;
  pending = loader()
    .then((value) => {
      cache.value = value;
      cache.expiresAt = Date.now() + Math.max(1, ttlMs);
      return value;
    })
    .finally(() => {
      if (cache.pending === pending) cache.pending = null;
    });
  cache.pending = pending;
  return pending;
}

/** Use the startup payload once, or perform a normal fresh Home query. */
export async function getHomeDataAfterPrime(loader: HomeLoader) {
  const cache = state();
  if (cache.pending) await cache.pending;
  if (cache.value && cache.expiresAt > Date.now()) {
    const value = cache.value;
    cache.value = null;
    cache.expiresAt = 0;
    return value;
  }
  cache.value = null;
  cache.expiresAt = 0;
  return loader();
}

export function resetHomePrimeForTests() {
  const cache = state();
  cache.value = null;
  cache.expiresAt = 0;
  cache.pending = null;
}
