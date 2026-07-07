"use client";

import { create } from "zustand";
import type { MediaType } from "@/lib/types";

export type RouteKey =
  | "home"
  | "movies"
  | "tv"
  | "search"
  | "mylist"
  | "library"
  | "settings"
  | "category";

interface MediaState {
  // client-side routing (only `/` is a real route)
  route: RouteKey;
  searchQuery: string;
  genreFilter: string | null;
  librarySectionFilter: { id: string; name: string; type: MediaType } | null;
  // overlays
  selectedMediaId: string | null; // opens detail overlay
  watchMediaId: string | null; // opens fullscreen player
  watchEpisodeId: string | null;
  watchStartAt: number; // resume position in seconds
  // actions
  setRoute: (route: RouteKey) => void;
  setSearch: (query: string) => void;
  setGenreFilter: (genre: string | null) => void;
  setLibrarySectionFilter: (section: { id: string; name: string; type: MediaType } | null) => void;
  openDetail: (mediaId: string) => void;
  closeDetail: () => void;
  openWatch: (mediaId: string, episodeId?: string | null, startAt?: number) => void;
  closeWatch: () => void;
}

export const useMediaStore = create<MediaState>((set) => ({
  route: "home",
  searchQuery: "",
  genreFilter: null,
  librarySectionFilter: null,
  selectedMediaId: null,
  watchMediaId: null,
  watchEpisodeId: null,
  watchStartAt: 0,
  setRoute: (route) =>
    set((s) =>
      route === s.route
        ? { route }
        : { route, genreFilter: null, searchQuery: route === "search" ? s.searchQuery : "" }
    ),
  setSearch: (query) => set({ searchQuery: query, route: query.trim() ? "search" : "home" }),
  setGenreFilter: (genre) => set({ genreFilter: genre, route: "category" }),
  setLibrarySectionFilter: (section) => set({ librarySectionFilter: section, route: "library" }),
  openDetail: (mediaId) => set({ selectedMediaId: mediaId }),
  closeDetail: () => set({ selectedMediaId: null }),
  openWatch: (mediaId, episodeId = null, startAt = 0) =>
    set({
      selectedMediaId: null,
      watchMediaId: mediaId,
      watchEpisodeId: episodeId,
      watchStartAt: startAt,
    }),
  closeWatch: () => set({ watchMediaId: null, watchEpisodeId: null, watchStartAt: 0 }),
}));
