// Shared types for the Lumina media frontend.
// These mirror the Prisma models but are flattened/serialised for the API layer.

export type MediaType = "MOVIE" | "TV";

export type BrowsePreset =
  | "recently-added-movies"
  | "trending"
  | "popular-movies"
  | "popular-tv"
  | "top-rated"
  | "new-releases";

export type BrowseSort = "popular" | "rating" | "year" | "title";

export type WatchState = "all" | "unwatched" | "in-progress" | "watched";

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
  /** Present on Library Management results. */
  available?: boolean;
  /** Present on Library Management results; TMDB identity is the match source of truth. */
  metadataMatched?: boolean;
  /** Present on Library Management results for path-level diagnosis. */
  sourcePath?: string | null;
  // Continue-watching context
  progressPercent?: number;
  progressPosition?: number;
  progressDuration?: number;
  progressEpisodeId?: string | null;
  progressSeason?: number | null;
  progressEpisode?: number | null;
  progressUpdatedAt?: string | null;
  /** Optional shelf-only episode context. This must never drive playback. */
  contextEpisodeId?: string | null;
  contextSeason?: number | null;
  contextEpisode?: number | null;
  contextEpisodeTitle?: string | null;
}

export interface SearchEpisodeResult {
  type: "EPISODE";
  id: string;
  mediaId: string;
  showTitle: string;
  title: string;
  seasonNumber: number;
  episodeNumber: number;
  stillUrl: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string | null;
  airDate: string | null;
  year: number | null;
  runtime: number | null;
  progressPercent?: number;
  progressPosition?: number;
  progressDuration?: number;
  completed: boolean;
}

export interface SearchResultGroup<T> {
  items: T[];
  /** Total matches before the per-group display limit is applied. */
  total: number;
}

export interface SearchResults {
  query: string;
  groups: {
    movies: SearchResultGroup<MediaSummary>;
    shows: SearchResultGroup<MediaSummary>;
    episodes: SearchResultGroup<SearchEpisodeResult>;
  };
  /** Sum of the independent movie, show, and episode match totals. */
  total: number;
}

export interface Subtitle {
  id: string;
  language: string;
  label: string;
  format: string;
  isDefault: boolean;
  url: string;
  source: "sidecar" | "embedded";
  delivery: "track" | "burn-in";
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
  playbackDecision?: import("./playback-selection").PlaybackDecision;
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
  tmdbKeyConfigured: boolean;
  transcodeAvailable?: boolean;
  transcodeHardware?: boolean;
  transcodeEncoder?: string;
  transcodeEncoderKey?: string;
  transcodeReason?: string | null;
}

export interface LibraryConfigInfo {
  tmdbKeyConfigured: boolean;
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
  complete: boolean;
  manifest: ScanManifest;
  /** Lazy full-manifest URL returned by background scan jobs. */
  reportUrl?: string;
}

export type ScanManifestKind =
  | "discovered"
  | "ignored"
  | "unsupported"
  | "traversal-error"
  | "parser-result"
  | "identity-collision"
  | "proposed-unavailable";

export interface ScanManifestEntry {
  kind: ScanManifestKind;
  path: string;
  reason?: string;
  mediaType?: MediaType;
  title?: string;
  year?: number | null;
  season?: number;
  episode?: number;
  rowId?: string;
}

export interface ScanManifest {
  complete: boolean;
  reconciliationApplied: boolean;
  entries: ScanManifestEntry[];
  /** Present on compact job responses so large reports do not block the scan request. */
  entryCount?: number;
  counts?: Partial<Record<ScanManifestKind, number>>;
  entriesTruncated?: boolean;
}

export interface ScanJobInfo {
  jobId: string;
  status: "queued" | "running" | "complete" | "failed";
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: ScanResult | null;
  error: string | null;
}

export interface LibrarySectionInfo {
  id: string;
  name: string;
  type: MediaType;
  category: string;
  mediaDir: string;
  tmdbKeyConfigured: boolean;
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
  /** Total change + unmatched rows that merit preview attention. */
  attentionTotal: number;
  /** Number of attention rows retained in this response. */
  detailReturned: number;
  /** True when attention detail exceeded the bounded response limit. */
  detailTruncated: boolean;
  errors: string[];
  items: PlexSyncItem[];
}
