"use client";

import { create } from "zustand";

export type RouteKey =
  | "home"
  | "movies"
  | "tv"
  | "search"
  | "mylist"
  | "library"
  | "category";

interface MediaState {
  // client-side routing (only `/` is a real route)
  route: RouteKey;
  searchQuery: string;
  genreFilter: string | null;
  // overlays
  selectedMediaId: string | null; // opens detail overlay
  watchMediaId: string | null; // opens fullscreen player
  watchEpisodeId: string | null;
  watchStartAt: number; // resume position in seconds
  // actions
  setRoute: (route: RouteKey) => void;
  setSearch: (query: string) => void;
  setGenreFilter: (genre: string | null) => void;
  openDetail: (mediaId: string) => void;
  closeDetail: () => void;
  openWatch: (mediaId: string, episodeId?: string | null, startAt?: number) => void;
  closeWatch: () => void;
}

export const useMediaStore = create<MediaState>((set) => ({
  route: "home",
  searchQuery: "",
  genreFilter: null,
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
  openDetail: (mediaId) => set({ selectedMediaId: mediaId }),
  closeDetail: () => set({ selectedMediaId: null }),
  openWatch: (mediaId, episodeId = null, startAt = 0) =>
    set({ watchMediaId: mediaId, watchEpisodeId: episodeId, watchStartAt: startAt }),
  closeWatch: () => set({ watchMediaId: null, watchEpisodeId: null, watchStartAt: 0 }),
}));
