"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  HomeData,
  LibraryStats,
  LibraryConfigInfo,
  LibrarySectionInfo,
  MediaDetail,
  MediaSummary,
  MediaType,
  PlexSyncDirection,
  PlexSyncResult,
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

export function useLibraryConfig() {
  return useQuery<LibraryConfigInfo>({
    queryKey: ["library-config"],
    queryFn: () => fetchJson<LibraryConfigInfo>("/api/library/config"),
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

export interface CodecInfo {
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
  browserCompatible: boolean;
  reason: string | null;
  directPlayable?: boolean;
  directPlayReason?: string | null;
}

/** Probe a media file's codecs (via ffprobe) to decide if transcoding is needed. */
export function useProbe(kind: "media" | "episode", id: string | null, enabled: boolean) {
  return useQuery<CodecInfo>({
    queryKey: ["probe", kind, id],
    queryFn: () => fetchJson<CodecInfo>(`/api/${kind === "media" ? "media" : "episodes"}/${id}/probe`),
    enabled: !!id && enabled,
    staleTime: Infinity, // codec info doesn't change
  });
}

export interface BrowseParams {
  type?: MediaType;
  genre?: string | null;
  category?: string | null;
  sectionId?: string | null;
  sort?: string;
  page: number;
  pageSize?: number;
  q?: string;
  enabled?: boolean;
}

interface BrowseResult {
  items: MediaSummary[];
  total: number;
  page: number;
  pageSize: number;
  genres: string[];
}

export function useBrowse(params: BrowseParams) {
  const qs = new URLSearchParams();
  if (params.type) qs.set("type", params.type);
  if (params.genre) qs.set("genre", params.genre);
  if (params.category) qs.set("category", params.category);
  if (params.sectionId) qs.set("sectionId", params.sectionId);
  if (params.q) qs.set("q", params.q);
  if (params.sort) qs.set("sort", params.sort);
  qs.set("page", String(params.page));
  qs.set("pageSize", String(params.pageSize ?? 24));
  const key = `${qs.toString()}`;
  return useQuery<BrowseResult>({
    queryKey: ["browse", key],
    queryFn: () => fetchJson<BrowseResult>(`/api/library/browse?${qs}`),
    enabled: params.enabled ?? true,
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
    if (params.category) qs.set("category", params.category);
    if (params.sectionId) qs.set("sectionId", params.sectionId);
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
      params.category ?? "all",
      params.sectionId ?? "all",
      params.sort ?? "popular",
      params.q ?? "",
    ],
    queryFn: ({ pageParam }) =>
      fetchJson<BrowseResult>(`/api/library/browse?${build(pageParam as number)}`),
    initialPageParam: 1,
    getNextPageParam: (last: BrowseResult) =>
      last.items.length < last.pageSize ? undefined : last.page + 1,
    enabled: params.enabled ?? true,
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
      qc.invalidateQueries({ queryKey: ["browse"], exact: false });
      qc.invalidateQueries({ queryKey: ["browse-infinite"], exact: false });
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
      qc.invalidateQueries({ queryKey: ["media"], exact: false });
      qc.invalidateQueries({ queryKey: ["browse"], exact: false });
      qc.invalidateQueries({ queryKey: ["browse-infinite"], exact: false });
    },
  });
}

export function useDismissContinueWatching() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { mediaId: string; episodeId?: string | null; duration?: number }) =>
      fetchJson<{ ok: boolean }>("/api/progress/dismiss", post(body)),
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
      qc.invalidateQueries({ queryKey: ["browse-infinite"], exact: false });
    },
  });
}

export function useSaveTmdbKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tmdbKey: string) =>
      fetchJson<{ ok: boolean }>("/api/library/config", post({ tmdbKey })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["library-config"] });
    },
  });
}

export function useSaveLibraryConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      tmdbKey?: string;
      plexUrl?: string;
      plexToken?: string;
      plexSyncDirection?: PlexSyncDirection;
    }) => fetchJson<{ ok: boolean; config: LibraryConfigInfo }>("/api/library/config", post(body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["library-config"] });
    },
  });
}

export function useTestPlexConnection() {
  return useMutation({
    mutationFn: (body: { url?: string; token?: string }) =>
      fetchJson<PlexSyncResult>("/api/plex/test", post(body)),
  });
}

export function usePlexSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      url?: string;
      token?: string;
      direction: PlexSyncDirection;
      apply?: boolean;
      sectionId?: string | null;
    }) => fetchJson<PlexSyncResult>("/api/plex/sync", post(body)),
    onSuccess: (_data, variables) => {
      if (!variables.apply) return;
      qc.invalidateQueries({ queryKey: ["progress"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      qc.invalidateQueries({ queryKey: ["media"], exact: false });
      qc.invalidateQueries({ queryKey: ["browse"], exact: false });
      qc.invalidateQueries({ queryKey: ["browse-infinite"], exact: false });
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
      qc.invalidateQueries({ queryKey: ["progress"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["browse"], exact: false });
      qc.invalidateQueries({ queryKey: ["browse-infinite"], exact: false });
      qc.invalidateQueries({ queryKey: ["search"], exact: false });
      qc.invalidateQueries({ queryKey: ["sections"] });
    },
  });
}

export function useRefreshMetadata() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mediaId: string) =>
      fetchJson<{ ok: boolean; media: MediaDetail }>("/api/metadata/refresh", post({ mediaId })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["media"], exact: false });
      qc.invalidateQueries({ queryKey: ["home"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["progress"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["browse"], exact: false });
      qc.invalidateQueries({ queryKey: ["browse-infinite"], exact: false });
      qc.invalidateQueries({ queryKey: ["search"], exact: false });
      qc.invalidateQueries({ queryKey: ["sections"] });
    },
  });
}

// ── Library sections ──────────────────────────────────────────────

export function useSections() {
  return useQuery<LibrarySectionInfo[]>({
    queryKey: ["sections"],
    queryFn: () => fetchJson<LibrarySectionInfo[]>("/api/sections"),
  });
}

export function useCreateSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      type: MediaType;
      category?: string;
      mediaDir: string;
      tmdbKey?: string;
      autoMatch?: boolean;
    }) => fetchJson<LibrarySectionInfo>("/api/sections", post(body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sections"] }),
  });
}

export function useUpdateSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      id: string;
      name?: string;
      mediaDir?: string;
      tmdbKey?: string;
      autoMatch?: boolean;
    }) => fetchJson<{ ok: boolean; id: string }>(`/api/sections/${body.id}`, { ...post(body), method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sections"] }),
  });
}

export function useDeleteSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ ok: boolean }>(`/api/sections/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sections"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

/** Scan a single section by its ID. */
export function useScanSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      sectionId: string;
      mediaDir?: string;
      tmdbKey?: string;
      autoMatch?: boolean;
    }) => fetchJson<ScanResult>("/api/sections/scan", post(body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sections"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      qc.invalidateQueries({ queryKey: ["genres"] });
      qc.invalidateQueries({ queryKey: ["browse"], exact: false });
    },
  });
}
