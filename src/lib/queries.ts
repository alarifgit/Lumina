"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  HomeData,
  LibraryStats,
  MediaDetail,
  MediaSummary,
  MediaType,
  SaveProgressPayload,
  ScanResult,
} from "@/lib/types";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
  }
  return res.json() as Promise<T>;
}

const post = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function useHome() {
  return useQuery<HomeData>({
    queryKey: ["home"],
    queryFn: () => fetchJson<HomeData>("/api/library/home"),
  });
}

export function useStats() {
  return useQuery<LibraryStats>({
    queryKey: ["stats"],
    queryFn: () => fetchJson<LibraryStats>("/api/library/stats"),
  });
}

export function useGenres() {
  return useQuery<string[]>({
    queryKey: ["genres"],
    queryFn: () => fetchJson<string[]>("/api/library/genres"),
  });
}

export function useMediaDetail(id: string | null, season?: number) {
  return useQuery<MediaDetail>({
    queryKey: ["media", id, season],
    queryFn: () =>
      fetchJson<MediaDetail>(
        `/api/media/${id}${season != null ? `?season=${season}` : ""}`
      ),
    enabled: !!id,
  });
}

export interface BrowseParams {
  type?: MediaType;
  genre?: string | null;
  sort?: string;
  page: number;
  pageSize?: number;
  q?: string;
}

export function useBrowse(params: BrowseParams) {
  const qs = new URLSearchParams();
  if (params.type) qs.set("type", params.type);
  if (params.genre) qs.set("genre", params.genre);
  if (params.q) qs.set("q", params.q);
  if (params.sort) qs.set("sort", params.sort);
  qs.set("page", String(params.page));
  qs.set("pageSize", String(params.pageSize ?? 24));
  const key = `${qs.toString()}`;
  return useQuery<{
    items: MediaSummary[];
    total: number;
    page: number;
    pageSize: number;
    genres: string[];
  }>({
    queryKey: ["browse", key],
    queryFn: () => fetchJson(`/api/library/browse?${qs}`),
  });
}

export function useSearch(q: string) {
  return useQuery<{ items: MediaSummary[]; query: string }>({
    queryKey: ["search", q],
    queryFn: () => fetchJson(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
  });
}

export function useBrowseInfinite(params: Omit<BrowseParams, "page">) {
  const build = (page: number) => {
    const qs = new URLSearchParams();
    if (params.type) qs.set("type", params.type);
    if (params.genre) qs.set("genre", params.genre);
    if (params.q) qs.set("q", params.q);
    if (params.sort) qs.set("sort", params.sort);
    qs.set("page", String(page));
    qs.set("pageSize", String(params.pageSize ?? 24));
    return qs.toString();
  };
  return useInfiniteQuery({
    queryKey: [
      "browse-infinite",
      params.type ?? "all",
      params.genre ?? "all",
      params.sort ?? "popular",
      params.q ?? "",
    ],
    queryFn: ({ pageParam }) =>
      fetchJson(`/api/library/browse?${build(pageParam as number)}`),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.items.length < last.pageSize ? undefined : last.page + 1,
  });
}

export function useMyList() {
  return useQuery<{ items: MediaSummary[] }>({
    queryKey: ["collections"],
    queryFn: () => fetchJson("/api/collections"),
  });
}

export function useContinueWatching() {
  return useQuery<{ items: MediaSummary[] }>({
    queryKey: ["progress"],
    queryFn: () => fetchJson("/api/progress"),
  });
}

export function useToggleMyList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mediaId: string) =>
      fetchJson<{ ok: boolean; inMyList: boolean }>("/api/collections/toggle", post({ mediaId })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      qc.invalidateQueries({ queryKey: ["media"], exact: false });
    },
  });
}

export function useSaveProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: SaveProgressPayload) =>
      fetchJson<{ ok: boolean }>("/api/progress", post(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["progress"] });
      qc.invalidateQueries({ queryKey: ["home"] });
    },
  });
}

export function useScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { mediaDir?: string; tmdbKey?: string; autoMatch?: boolean }) =>
      fetchJson<ScanResult>("/api/library/scan", post(body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      qc.invalidateQueries({ queryKey: ["genres"] });
      qc.invalidateQueries({ queryKey: ["browse"], exact: false });
    },
  });
}

export function useMetadataSearch() {
  return useMutation({
    mutationFn: (body: { title: string; type: "MOVIE" | "TV"; year?: number }) =>
      fetchJson<{
        results: { tmdbId: number; title: string; year: number | null; overview: string | null; posterUrl: string | null; type: string }[];
      }>("/api/metadata/search", post(body)),
  });
}

export function useApplyMetadata() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { mediaId: string; tmdbId: number; type: "MOVIE" | "TV" }) =>
      fetchJson<{ ok: boolean; media: MediaDetail }>("/api/metadata/apply", post(body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["media"], exact: false });
      qc.invalidateQueries({ queryKey: ["home"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
