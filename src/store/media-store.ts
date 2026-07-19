"use client";

import { create } from "zustand";
import type { BrowsePreset, BrowseSort, MediaType, WatchState } from "@/lib/types";

export type RouteKey =
  | "home"
  | "movies"
  | "tv"
  | "browse"
  | "search"
  | "mylist"
  | "library"
  | "settings"
  | "category";

export interface BrowseTarget {
  scope: string;
  title: string;
  eyebrow?: string;
  type?: MediaType;
  preset?: BrowsePreset;
}

export interface BrowsePreferences {
  genre: string | null;
  sort: BrowseSort | null;
  watchState: WatchState;
}

interface MediaState {
  // client-side routing (only `/` is a real route)
  route: RouteKey;
  searchQuery: string;
  searchReturnRoute: Exclude<RouteKey, "search">;
  genreFilter: string | null;
  browseTarget: BrowseTarget | null;
  browsePreferences: Record<string, BrowsePreferences>;
  scrollPositions: Record<string, number>;
  librarySectionFilter: { id: string; name: string; type: MediaType } | null;
  // overlays
  selectedMediaId: string | null; // opens detail overlay
  watchMediaId: string | null; // opens fullscreen player
  watchEpisodeId: string | null;
  watchStartAt: number; // resume position in seconds
  // actions
  setRoute: (route: RouteKey) => void;
  openSearch: () => void;
  closeSearch: () => void;
  setSearchQuery: (query: string) => void;
  openBrowse: (target: BrowseTarget) => void;
  updateBrowsePreferences: (scope: string, updates: Partial<BrowsePreferences>) => void;
  setScrollPosition: (viewKey: string, position: number) => void;
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
  searchReturnRoute: "home",
  genreFilter: null,
  browseTarget: null,
  browsePreferences: {},
  scrollPositions: {},
  librarySectionFilter: null,
  selectedMediaId: null,
  watchMediaId: null,
  watchEpisodeId: null,
  watchStartAt: 0,
  setRoute: (route) =>
    set((s) =>
      route === s.route
        ? { route }
        : {
            route,
            genreFilter: null,
            searchQuery: route === "search" ? s.searchQuery : "",
            ...(route === "search" && s.route !== "search"
              ? { searchReturnRoute: s.route as Exclude<RouteKey, "search"> }
              : {}),
          }
    ),
  openSearch: () =>
    set((s) => ({
      route: "search",
      searchReturnRoute:
        s.route === "search" ? s.searchReturnRoute : (s.route as Exclude<RouteKey, "search">),
    })),
  closeSearch: () =>
    set((s) => ({ route: s.searchReturnRoute, searchQuery: "" })),
  setSearchQuery: (query) => set({ searchQuery: query }),
  openBrowse: (target) =>
    set({ route: "browse", browseTarget: target, genreFilter: null, searchQuery: "" }),
  updateBrowsePreferences: (scope, updates) =>
    set((s) => {
      const existing = s.browsePreferences[scope] ?? {
        genre: null,
        sort: null,
        watchState: "all",
      };
      return {
        browsePreferences: {
          ...s.browsePreferences,
          [scope]: {
            ...existing,
            ...updates,
          },
        },
        scrollPositions: {
          ...s.scrollPositions,
          [`browse:${scope}`]: 0,
        },
      };
    }),
  setScrollPosition: (viewKey, position) =>
    set((s) => {
      const nextPosition = Math.max(0, position);
      if (s.scrollPositions[viewKey] === nextPosition) return s;
      return {
        scrollPositions: { ...s.scrollPositions, [viewKey]: nextPosition },
      };
    }),
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
