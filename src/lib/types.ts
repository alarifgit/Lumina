// Shared types for the Lumina media frontend.
// These mirror the Prisma models but are flattened/serialised for the API layer.

export type MediaType = "MOVIE" | "TV";

export interface Genre {
  id: number;
  name: string;
}

/** Lightweight media item used in rows / grids / search results. */
export interface MediaSummary {
  id: string;
  type: MediaType;
  title: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  year: number | null;
  rating: number | null;
  runtime: number | null;
  genres: string[];
  certification: string | null;
  overview: string | null;
  tagline: string | null;
  featured: boolean;
  trending: boolean;
  popularity: number;
  inMyList: boolean;
  createdAt?: string | null;
  sourceCreatedAt?: string | null;
  sourceModifiedAt?: string | null;
  // Continue-watching context
  progressPercent?: number;
  progressPosition?: number;
  progressDuration?: number;
  progressEpisodeId?: string | null;
  progressSeason?: number | null;
  progressEpisode?: number | null;
  progressUpdatedAt?: string | null;
}

export interface Subtitle {
  id: string;
  language: string;
  label: string;
  format: string;
  isDefault: boolean;
  url: string;
  source?: string;
}

export interface Episode {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview: string | null;
  stillUrl: string | null;
  airDate: string | null;
  runtime: number | null;
  streamUrl: string | null;
  filePath: string | null;
  subtitles: Subtitle[];
  progressPercent?: number;
  progressPosition?: number;
  progressDuration?: number;
  completed?: boolean;
}

export interface Season {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airDate: string | null;
  overview: string | null;
}

/** Full media detail, including seasons + episodes (for TV). */
export interface MediaDetail extends MediaSummary {
  tmdbId: number | null;
  imdbId: string | null;
  voteCount: number | null;
  status: string | null;
  releaseDate: string | null;
  streamUrl: string | null;
  filePath: string | null;
  sourceCreatedAt?: string | null;
  sourceModifiedAt?: string | null;
  subtitles: Subtitle[];
  sectionId: string | null;
  category: string;
  seasons: Season[];
  episodes: Episode[]; // episodes of the currently-selected season
  playableEpisodes?: Episode[]; // all local/downloaded episodes, used by player
  nextEpisode?: Episode | null;
}

export interface ContentRow {
  key: string;
  title: string;
  items: MediaSummary[];
}

export interface HomeData {
  featured: MediaSummary[];
  rows: ContentRow[];
  continueWatching: MediaSummary[];
}

export interface SaveProgressPayload {
  mediaId: string;
  episodeId?: string | null;
  position: number;
  duration: number;
  completed?: boolean;
}

export interface LibraryStats {
  mediaCount: number;
  movieCount: number;
  tvCount: number;
  episodeCount: number;
  genreCount: number;
  totalRuntimeHours: number;
  lastScan: string | null;
  scanCount: number;
  mediaDir: string;
  tmdbKey: string | null;
  transcodeAvailable?: boolean;
  transcodeHardware?: boolean;
  transcodeEncoder?: string;
  transcodeEncoderKey?: string;
  transcodeReason?: string | null;
}

export interface LibraryConfigInfo {
  tmdbKey: string;
  plexUrl: string;
  plexTokenSaved: boolean;
  plexSyncDirection: PlexSyncDirection;
}

export interface ScanResult {
  scanned: number;
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
  durationMs: number;
  sectionId?: string;
  sectionName?: string;
}

export interface LibrarySectionInfo {
  id: string;
  name: string;
  type: MediaType;
  category: string;
  mediaDir: string;
  tmdbKey: string | null;
  autoMatch: boolean;
  lastScan: string | null;
  scanCount: number;
  mediaCount: number;
}

export type PlexSyncDirection = "pull" | "push" | "two-way";

export interface PlexSyncItem {
  type: MediaType;
  title: string;
  year: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  plexRatingKey: string | null;
  plexWatched: boolean;
  luminaWatched: boolean | null;
  match: "matched" | "unmatched";
  action:
    | "mark-lumina-watched"
    | "mark-plex-watched"
    | "already-synced"
    | "skipped"
    | "unmatched";
  reason: string;
}

export interface PlexSyncResult {
  ok: true;
  mode: "preview" | "apply" | "test";
  direction: PlexSyncDirection;
  serverName?: string | null;
  sections?: number;
  scanned: number;
  matched: number;
  unmatched: number;
  alreadySynced: number;
  markedLuminaWatched: number;
  markedPlexWatched: number;
  skipped: number;
  errors: string[];
  items: PlexSyncItem[];
}
