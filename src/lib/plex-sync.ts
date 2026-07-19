import { db } from "@/lib/db";
import { plexItemMatchesSectionType } from "@/lib/plex-scope";

export type PlexSyncDirection = "pull" | "push" | "two-way";

export interface PlexSyncCredentials {
  url?: string | null;
  token?: string | null;
}

export interface PlexSyncRequest extends PlexSyncCredentials {
  direction?: PlexSyncDirection;
  apply?: boolean;
  sectionId?: string | null;
}

export interface PlexSyncItem {
  type: "MOVIE" | "TV";
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
  attentionTotal: number;
  detailReturned: number;
  detailTruncated: boolean;
  errors: string[];
  items: PlexSyncItem[];
}

type PlexGuid = { id?: string };

type PlexSection = {
  key?: string | number;
  title?: string;
  type?: string;
};

type PlexMetadata = {
  type?: string;
  key?: string;
  ratingKey?: string | number;
  title?: string;
  grandparentTitle?: string;
  grandparentKey?: string;
  grandparentRatingKey?: string | number;
  year?: number | string;
  parentYear?: number | string;
  index?: number | string;
  parentIndex?: number | string;
  duration?: number | string;
  viewCount?: number | string;
  lastViewedAt?: number | string;
  guid?: string;
  grandparentGuid?: string;
  Guid?: PlexGuid[] | PlexGuid;
};

type LoadedPlexItem = {
  item: PlexMetadata;
  parentShow: PlexMetadata | null;
  parentIssue?: string;
};

type MediaWithProgress = Awaited<ReturnType<typeof loadLuminaLibrary>>["movies"][number];
type ShowWithEpisodes = Awaited<ReturnType<typeof loadLuminaLibrary>>["shows"][number];
type EpisodeWithProgress = ShowWithEpisodes["episodes"][number];

async function credentials(input: PlexSyncCredentials) {
  const config = await db.libraryConfig.findUnique({ where: { id: "default" } }).catch(() => null);
  const url = (
    input.url ||
    config?.plexUrl ||
    process.env.PLEX_URL ||
    process.env.LUMINA_PLEX_URL ||
    ""
  ).trim().replace(/\/+$/, "");
  const token = (
    input.token ||
    config?.plexToken ||
    process.env.PLEX_TOKEN ||
    process.env.LUMINA_PLEX_TOKEN ||
    ""
  ).trim();
  if (!url || !token) {
    throw new Error("Plex URL and token are required. Enter them here or set PLEX_URL and PLEX_TOKEN.");
  }
  return { url, token };
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function numberValue(value: number | string | undefined | null): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function keyFor(title: string | null | undefined, year?: number | null) {
  const base = normalize(title);
  return year ? `${base}:${year}` : base;
}

function externalIds(rawValues: Array<string | null | undefined>) {
  const ids = new Map<string, string>();
  for (const raw of rawValues) {
    if (!raw) continue;
    const match = raw.match(/^(imdb|tmdb|tvdb):\/\/(.+)$/i);
    if (match?.[1] && match[2]) ids.set(match[1].toLowerCase(), match[2]);
  }
  return {
    imdbId: ids.get("imdb") ?? null,
    tmdbId: ids.get("tmdb") ? Number(ids.get("tmdb")) : null,
    tvdbId: ids.get("tvdb") ?? null,
  };
}

function itemExternalIds(item: PlexMetadata) {
  return externalIds([item.guid, ...asArray(item.Guid).map((guid) => guid.id)]);
}

function showExternalIds(item: PlexMetadata, parentShow: PlexMetadata | null) {
  // An episode's own Guid values identify the episode, not its parent show.
  // Parent Guid values come from the section's type=2 show inventory.
  return externalIds([
    parentShow?.guid,
    ...asArray(parentShow?.Guid).map((guid) => guid.id),
    item.grandparentGuid,
  ]);
}

function titleCandidates(value: string | null | undefined) {
  const title = (value ?? "").trim();
  if (!title) return [];

  const candidates: Array<{ title: string; inferredYear: number | null }> = [
    { title, inferredYear: null },
  ];
  const suffix = title.match(/^(.*\S)\s*[\[(]((?:18|19|20|21)\d{2})[\])]\s*$/);
  if (suffix?.[1] && suffix[2]) {
    candidates.push({ title: suffix[1].trim(), inferredYear: Number(suffix[2]) });
  }
  return candidates;
}

type FallbackIdentityMap<T, K = string> = Map<K, T | null>;

function registerFallbackIdentity<T, K>(map: FallbackIdentityMap<T, K>, key: K, value: T) {
  if (!key) return;
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, value);
    return;
  }
  if (existing !== value) map.set(key, null);
}

type IdentityResolution<T> = {
  item?: T;
  method?: string;
  reason: string;
  blocking?: boolean;
};

type MapLookup<T> =
  | { status: "none" }
  | { status: "matched"; item: T }
  | { status: "ambiguous" };

function lookupIdentity<T, K>(map: FallbackIdentityMap<T, K>, key: K): MapLookup<T> {
  if (key == null || !map.has(key)) return { status: "none" };
  const item = map.get(key);
  return item ? { status: "matched", item } : { status: "ambiguous" };
}

function findByTitle<T extends { title: string }>(
  title: string | null | undefined,
  year: number | null,
  maps: { byTitleYear: FallbackIdentityMap<T>; byTitle: FallbackIdentityMap<T> }
): IdentityResolution<T> {
  const candidates = titleCandidates(title);
  for (const candidate of candidates) {
    const years = [candidate.inferredYear, year].filter(
      (candidateYear, index, values): candidateYear is number =>
        candidateYear != null && values.indexOf(candidateYear) === index
    );
    for (const candidateYear of years) {
      const key = keyFor(candidate.title, candidateYear);
      const result = lookupIdentity(maps.byTitleYear, key);
      if (result.status === "ambiguous") {
        return {
          reason: `Ambiguous Lumina title/year identity for “${candidate.title}” (${candidateYear}).`,
          blocking: true,
        };
      }
      if (result.status === "matched") {
        return {
          item: result.item,
          method: "canonical-title-year",
          reason: `Matched canonical title/year to Lumina “${result.item.title}”.`,
        };
      }
    }
  }
  for (const candidate of candidates) {
    const key = keyFor(candidate.title);
    const result = lookupIdentity(maps.byTitle, key);
    if (result.status === "ambiguous") {
      return { reason: `Ambiguous Lumina title identity for “${candidate.title}”.`, blocking: true };
    }
    if (result.status === "matched") {
      return {
        item: result.item,
        method: "canonical-title",
        reason: `Matched canonical title to Lumina “${result.item.title}”.`,
      };
    }
  }
  return { reason: `No Lumina title identity matched “${title ?? "Untitled"}”.` };
}

function exactAlias<T extends { title: string }>(
  title: string | null | undefined,
  maps: {
    byPathAlias?: FallbackIdentityMap<T>;
    bySortAlias: FallbackIdentityMap<T>;
  }
): IdentityResolution<T> {
  const key = keyFor(title);
  if (!key) return { reason: "No source alias was available." };

  if (maps.byPathAlias) {
    const pathResult = lookupIdentity(maps.byPathAlias, key);
    if (pathResult.status === "ambiguous") {
      return { reason: `Ambiguous exact local source-folder alias for “${title}”.`, blocking: true };
    }
    if (pathResult.status === "matched") {
      return {
        item: pathResult.item,
        method: "source-folder-alias",
        reason: `Matched exact local source-folder alias “${title}” to Lumina “${pathResult.item.title}”.`,
      };
    }
  }

  const sortResult = lookupIdentity(maps.bySortAlias, key);
  if (sortResult.status === "ambiguous") {
    return { reason: `Ambiguous exact local source-title alias for “${title}”.`, blocking: true };
  }
  if (sortResult.status === "matched") {
    return {
      item: sortResult.item,
      method: "source-title-alias",
      reason: `Matched exact local source-title alias “${title}” to Lumina “${sortResult.item.title}”.`,
    };
  }

  return { reason: `No exact local source alias matched “${title}”.` };
}

function externalIdentity<T extends { title: string }>(
  ids: ReturnType<typeof externalIds>,
  maps: {
    byTmdb: FallbackIdentityMap<T, number>;
    byImdb: FallbackIdentityMap<T>;
  }
): IdentityResolution<T> {
  const candidates: Array<{ source: string; result: MapLookup<T> }> = [];
  if (ids.tmdbId != null && Number.isFinite(ids.tmdbId)) {
    candidates.push({ source: `TMDB ${ids.tmdbId}`, result: lookupIdentity(maps.byTmdb, ids.tmdbId) });
  }
  if (ids.imdbId) {
    candidates.push({ source: `IMDb ${ids.imdbId}`, result: lookupIdentity(maps.byImdb, ids.imdbId) });
  }

  const ambiguous = candidates.find((candidate) => candidate.result.status === "ambiguous");
  if (ambiguous) return { reason: `Ambiguous local ${ambiguous.source} identity.`, blocking: true };

  const matches = candidates.filter(
    (candidate): candidate is { source: string; result: { status: "matched"; item: T } } =>
      candidate.result.status === "matched"
  );
  const distinct = new Set(matches.map((candidate) => candidate.result.item));
  if (distinct.size > 1) {
    return { reason: "Plex parent external IDs resolve to conflicting Lumina rows.", blocking: true };
  }
  const match = matches[0];
  if (match) {
    return {
      item: match.result.item,
      method: "external-id",
      reason: `Matched ${match.source} to Lumina “${match.result.item.title}”.`,
    };
  }
  return { reason: "No parent external ID matched a Lumina row." };
}

function reconcileStrongIdentity<T extends { title: string }>(
  external: IdentityResolution<T>,
  source: IdentityResolution<T>
): IdentityResolution<T> | null {
  if (external.item) {
    if (source.item && source.item !== external.item) {
      return {
        reason: `Identity collision: ${external.reason} ${source.reason}`,
        blocking: true,
      };
    }
    return external;
  }
  if (external.blocking) return external;
  if (source.item || source.blocking) return source;
  return null;
}

function sourceBasename(filePath: string | null | undefined) {
  const parts = (filePath ?? "").split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? "";
}

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseXmlAttrs(raw: string) {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function parsePlexXmlItems(text: string, tag: "Directory" | "Video") {
  const expression = new RegExp(`<${tag}\\b([^>]*?)(?:\\s*/>|>([\\s\\S]*?)<\\/${tag}>)`, "g");
  return [...text.matchAll(expression)].map((match) => {
    const item = parseXmlAttrs(match[1]) as PlexMetadata;
    const guidBlock = match[2] ?? "";
    const guids = [...guidBlock.matchAll(/<Guid\b([^>]*)\/?>/g)].map((guidMatch) =>
      parseXmlAttrs(guidMatch[1])
    );
    if (guids.length) item.Guid = guids;
    return item;
  });
}

function parsePlexXml(text: string) {
  const container = parseXmlAttrs(text.match(/<MediaContainer\b([^>]*)>/)?.[1] ?? "");
  const directories = parsePlexXmlItems(text, "Directory");
  const videos = parsePlexXmlItems(text, "Video");
  return {
    MediaContainer: {
      ...container,
      ...(directories.length ? { Directory: directories } : {}),
      ...(videos.length ? { Metadata: videos } : {}),
    },
  };
}

async function plexGet<T>(
  creds: { url: string; token: string },
  path: string,
  params: Record<string, string> = {}
): Promise<T> {
  const url = new URL(path, `${creds.url}/`);
  url.searchParams.set("X-Plex-Token", creds.token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Plex-Product": "Lumina",
      "X-Plex-Client-Identifier": "lumina-plex-sync",
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Plex HTTP ${res.status}: ${text.slice(0, 160)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    if (text.trim().startsWith("<")) return parsePlexXml(text) as T;
    throw new Error("Plex did not return JSON or XML. Check that the URL points at the Plex server root.");
  }
}

async function plexScrobble(creds: { url: string; token: string }, ratingKey: string) {
  await plexGet(creds, "/:/scrobble", {
    key: ratingKey,
    identifier: "com.plexapp.plugins.library",
  });
}

async function plexSections(creds: { url: string; token: string }) {
  const data = await plexGet<{ MediaContainer?: { Directory?: PlexSection[] | PlexSection } }>(
    creds,
    "/library/sections"
  );
  return asArray(data.MediaContainer?.Directory).filter((s) => s.key != null);
}

async function plexIdentity(creds: { url: string; token: string }) {
  const data = await plexGet<{ MediaContainer?: { friendlyName?: string; machineIdentifier?: string } }>(
    creds,
    "/identity"
  );
  return data.MediaContainer?.friendlyName ?? data.MediaContainer?.machineIdentifier ?? "Plex server";
}

async function plexSectionItems(
  creds: { url: string; token: string },
  section: PlexSection,
  type: "1" | "2" | "4"
) {
  const data = await plexGet<{
    MediaContainer?: {
      Metadata?: PlexMetadata[] | PlexMetadata;
      Directory?: PlexMetadata[] | PlexMetadata;
    };
  }>(
    creds,
    `/library/sections/${section.key}/all`,
    { type, includeGuids: "1" }
  );
  return asArray(data.MediaContainer?.Metadata ?? data.MediaContainer?.Directory);
}

function plexReferenceKeys(values: Array<string | number | null | undefined>) {
  const keys = new Set<string>();
  for (const raw of values) {
    if (raw == null || raw === "") continue;
    const value = String(raw).trim();
    if (!value) continue;
    keys.add(value);
    const metadataId = value.match(/\/library\/metadata\/([^/]+)/)?.[1];
    if (metadataId) keys.add(`rating:${metadataId}`);
  }
  return [...keys];
}

function parentKeys(parent: PlexMetadata) {
  return plexReferenceKeys([
    parent.ratingKey != null ? `rating:${parent.ratingKey}` : null,
    parent.ratingKey,
    parent.guid,
    parent.key,
  ]);
}

function episodeParentKeys(item: PlexMetadata) {
  return plexReferenceKeys([
    item.grandparentRatingKey != null ? `rating:${item.grandparentRatingKey}` : null,
    item.grandparentRatingKey,
    item.grandparentGuid,
    item.grandparentKey,
  ]);
}

function linkParentShows(items: PlexMetadata[], parents: PlexMetadata[]): LoadedPlexItem[] {
  const index = new Map<string, PlexMetadata | null>();
  for (const parent of parents) {
    for (const key of parentKeys(parent)) registerFallbackIdentity(index, key, parent);
  }

  return items.map((item) => {
    let parentShow: PlexMetadata | null = null;
    for (const key of episodeParentKeys(item)) {
      if (!index.has(key)) continue;
      const candidate = index.get(key);
      if (!candidate) {
        return {
          item,
          parentShow: null,
          parentIssue: "Plex parent-show identity is ambiguous.",
        };
      }
      if (parentShow && parentShow !== candidate) {
        return {
          item,
          parentShow: null,
          parentIssue: "Plex parent-show references resolve to conflicting parent rows.",
        };
      }
      parentShow = candidate;
    }
    return { item, parentShow };
  });
}

async function loadPlexLibrary(creds: { url: string; token: string }) {
  const sections = await plexSections(creds);
  const supported = sections.filter((s) => s.type === "movie" || s.type === "show");
  const items: LoadedPlexItem[] = [];
  const errors: string[] = [];

  for (const section of supported) {
    if (section.type === "movie") {
      try {
        items.push(
          ...(await plexSectionItems(creds, section, "1")).map((item) => ({
            item,
            parentShow: null,
          }))
        );
      } catch (error) {
        errors.push(`${section.title ?? section.key}: ${(error as Error).message}`);
      }
      continue;
    }

    const [episodeResult, parentResult] = await Promise.allSettled([
      plexSectionItems(creds, section, "4"),
      plexSectionItems(creds, section, "2"),
    ]);
    if (episodeResult.status === "rejected") {
      errors.push(`${section.title ?? section.key}: ${episodeResult.reason instanceof Error ? episodeResult.reason.message : String(episodeResult.reason)}`);
      continue;
    }
    if (parentResult.status === "rejected") {
      errors.push(`${section.title ?? section.key} parent shows: ${parentResult.reason instanceof Error ? parentResult.reason.message : String(parentResult.reason)}`);
      items.push(...episodeResult.value.map((item) => ({ item, parentShow: null })));
      continue;
    }
    items.push(...linkParentShows(episodeResult.value, parentResult.value));
  }

  return { sections: supported.length, items, errors };
}

async function loadLuminaLibrary(sectionId?: string | null) {
  const sectionWhere = sectionId ? { sectionId } : {};
  const [movies, shows] = await Promise.all([
    db.media.findMany({
      where: { type: "MOVIE", ...sectionWhere },
      include: { progress: true },
    }),
    db.media.findMany({
      where: { type: "TV", ...sectionWhere },
      include: {
        progress: true,
        episodes: { include: { progress: true } },
      },
    }),
  ]);
  return { movies, shows };
}

function isMediaWatched(media: MediaWithProgress) {
  return media.progress.some((p) => !p.episodeId && p.completed);
}

function isEpisodeWatched(episode: EpisodeWithProgress) {
  return episode.progress.some((p) => p.completed);
}

function findMovie(
  item: PlexMetadata,
  maps: {
    byTmdb: FallbackIdentityMap<MediaWithProgress, number>;
    byImdb: FallbackIdentityMap<MediaWithProgress>;
    bySortAlias: FallbackIdentityMap<MediaWithProgress>;
    byTitleYear: FallbackIdentityMap<MediaWithProgress>;
    byTitle: FallbackIdentityMap<MediaWithProgress>;
  }
): IdentityResolution<MediaWithProgress> {
  const ids = itemExternalIds(item);
  const year = numberValue(item.year);
  const strong = reconcileStrongIdentity(
    externalIdentity(ids, maps),
    exactAlias(item.title, maps)
  );
  if (strong) return strong;
  return findByTitle(item.title, year, maps);
}

function findShow(
  item: PlexMetadata,
  parentShow: PlexMetadata | null,
  parentIssue: string | undefined,
  maps: {
    byTmdb: FallbackIdentityMap<ShowWithEpisodes, number>;
    byImdb: FallbackIdentityMap<ShowWithEpisodes>;
    byPathAlias: FallbackIdentityMap<ShowWithEpisodes>;
    bySortAlias: FallbackIdentityMap<ShowWithEpisodes>;
    byTitleYear: FallbackIdentityMap<ShowWithEpisodes>;
    byTitle: FallbackIdentityMap<ShowWithEpisodes>;
  }
): IdentityResolution<ShowWithEpisodes> {
  if (parentIssue) return { reason: parentIssue };

  const ids = showExternalIds(item, parentShow);
  const sourceTitle = item.grandparentTitle ?? parentShow?.title ?? item.title;
  const strong = reconcileStrongIdentity(
    externalIdentity(ids, maps),
    exactAlias(sourceTitle, maps)
  );
  if (strong) return strong;

  // Only a type=2 parent show (or an explicit parentYear) can provide the
  // series premiere year. item.year on a type=4 row is the episode air year.
  const year = numberValue(parentShow?.year ?? item.parentYear);
  const title = parentShow?.title ?? item.grandparentTitle ?? item.title;
  return findByTitle(title, year, maps);
}

function buildMaps(library: Awaited<ReturnType<typeof loadLuminaLibrary>>) {
  const movieMaps = {
    byTmdb: new Map<number, MediaWithProgress | null>(),
    byImdb: new Map<string, MediaWithProgress | null>(),
    bySortAlias: new Map<string, MediaWithProgress | null>(),
    byTitleYear: new Map<string, MediaWithProgress | null>(),
    byTitle: new Map<string, MediaWithProgress | null>(),
  };
  for (const movie of library.movies) {
    if (movie.tmdbId) registerFallbackIdentity(movieMaps.byTmdb, movie.tmdbId, movie);
    if (movie.imdbId) registerFallbackIdentity(movieMaps.byImdb, movie.imdbId, movie);
    if (movie.sortTitle) registerFallbackIdentity(movieMaps.bySortAlias, keyFor(movie.sortTitle), movie);
    if (movie.year != null) {
      registerFallbackIdentity(movieMaps.byTitleYear, keyFor(movie.title, movie.year), movie);
    }
    registerFallbackIdentity(movieMaps.byTitle, keyFor(movie.title), movie);
  }

  const showMaps = {
    byTmdb: new Map<number, ShowWithEpisodes | null>(),
    byImdb: new Map<string, ShowWithEpisodes | null>(),
    byPathAlias: new Map<string, ShowWithEpisodes | null>(),
    bySortAlias: new Map<string, ShowWithEpisodes | null>(),
    byTitleYear: new Map<string, ShowWithEpisodes | null>(),
    byTitle: new Map<string, ShowWithEpisodes | null>(),
  };
  for (const show of library.shows) {
    if (show.tmdbId) registerFallbackIdentity(showMaps.byTmdb, show.tmdbId, show);
    if (show.imdbId) registerFallbackIdentity(showMaps.byImdb, show.imdbId, show);
    const folderAlias = sourceBasename(show.filePath);
    if (folderAlias) registerFallbackIdentity(showMaps.byPathAlias, keyFor(folderAlias), show);
    if (show.sortTitle) registerFallbackIdentity(showMaps.bySortAlias, keyFor(show.sortTitle), show);
    if (show.year != null) {
      registerFallbackIdentity(showMaps.byTitleYear, keyFor(show.title, show.year), show);
    }
    registerFallbackIdentity(showMaps.byTitle, keyFor(show.title), show);
  }

  return { movieMaps, showMaps };
}

async function markLuminaWatched(target: { mediaId: string; episodeId?: string | null; duration: number }) {
  const existing = await db.watchProgress.findFirst({
    where: { mediaId: target.mediaId, episodeId: target.episodeId ?? null },
  });
  if (existing) {
    await db.watchProgress.update({
      where: { id: existing.id },
      data: {
        position: target.duration,
        duration: target.duration,
        completed: true,
        hiddenFromContinueWatching: false,
      },
    });
  } else {
    await db.watchProgress.create({
      data: {
        mediaId: target.mediaId,
        episodeId: target.episodeId ?? null,
        position: target.duration,
        duration: target.duration,
        completed: true,
      },
    });
  }
}

function actionFor(direction: PlexSyncDirection, plexWatched: boolean, luminaWatched: boolean | null) {
  if (luminaWatched == null) return "unmatched" as const;
  if (plexWatched && luminaWatched) return "already-synced" as const;
  if ((direction === "pull" || direction === "two-way") && plexWatched && !luminaWatched) {
    return "mark-lumina-watched" as const;
  }
  if ((direction === "push" || direction === "two-way") && luminaWatched && !plexWatched) {
    return "mark-plex-watched" as const;
  }
  return "skipped" as const;
}

export async function testPlexConnection(input: PlexSyncCredentials): Promise<PlexSyncResult> {
  const creds = await credentials(input);
  const [serverName, sections] = await Promise.all([plexIdentity(creds), plexSections(creds)]);
  return {
    ok: true,
    mode: "test",
    direction: "pull",
    serverName,
    sections: sections.length,
    scanned: 0,
    matched: 0,
    unmatched: 0,
    alreadySynced: 0,
    markedLuminaWatched: 0,
    markedPlexWatched: 0,
    skipped: 0,
    attentionTotal: 0,
    detailReturned: 0,
    detailTruncated: false,
    errors: [],
    items: [],
  };
}

export async function syncPlexWatched(input: PlexSyncRequest): Promise<PlexSyncResult> {
  const creds = await credentials(input);
  const config = await db.libraryConfig.findUnique({ where: { id: "default" } }).catch(() => null);
  const direction = input.direction ?? (config?.plexSyncDirection as PlexSyncDirection | undefined) ?? "pull";
  const apply = input.apply ?? false;
  const [serverName, plex, lumina, selectedSection] = await Promise.all([
    plexIdentity(creds).catch(() => null),
    loadPlexLibrary(creds),
    loadLuminaLibrary(input.sectionId),
    input.sectionId
      ? db.librarySection.findUnique({ where: { id: input.sectionId }, select: { type: true } })
      : Promise.resolve(null),
  ]);
  if (input.sectionId && !selectedSection) throw new Error("Lumina library section not found.");
  const scopedPlexItems = plex.items.filter(({ item }) =>
    plexItemMatchesSectionType(item.type, selectedSection?.type as "MOVIE" | "TV" | undefined)
  );
  const { movieMaps, showMaps } = buildMaps(lumina);
  const rows: Array<
    PlexSyncItem & { luminaMediaId?: string; luminaEpisodeId?: string | null; duration: number }
  > = [];

  for (const loaded of scopedPlexItems) {
    const { item, parentShow, parentIssue } = loaded;
    const type = item.type === "episode" ? "TV" : "MOVIE";
    const plexWatched = Number(item.viewCount ?? 0) > 0 || !!item.lastViewedAt;
    const plexRatingKey = item.ratingKey != null ? String(item.ratingKey) : null;
    const duration = Math.max(1, (numberValue(item.duration) ?? 0) / 1000);

    if (type === "MOVIE") {
      const identity = findMovie(item, movieMaps);
      const movie = identity.item;
      const luminaWatched = movie ? isMediaWatched(movie) : null;
      const action = actionFor(direction, plexWatched, luminaWatched);
      rows.push({
        type,
        title: item.title ?? "Untitled movie",
        year: numberValue(item.year),
        plexRatingKey,
        plexWatched,
        luminaWatched,
        match: movie ? "matched" : "unmatched",
        action,
        reason: movie ? identity.reason : `No Lumina movie matched this Plex item. ${identity.reason}`,
        luminaMediaId: movie?.id,
        luminaEpisodeId: null,
        duration,
      });
      continue;
    }

    const identity = findShow(item, parentShow, parentIssue, showMaps);
    const show = identity.item;
    const seasonNumber = numberValue(item.parentIndex);
    const episodeNumber = numberValue(item.index);
    const episode =
      show && seasonNumber != null && episodeNumber != null
        ? show.episodes.find((e) => e.seasonNumber === seasonNumber && e.episodeNumber === episodeNumber)
        : undefined;
    const luminaWatched = episode ? isEpisodeWatched(episode) : null;
    const action = actionFor(direction, plexWatched, luminaWatched);
    rows.push({
      type,
      title: item.grandparentTitle ?? item.title ?? "Untitled show",
      year: numberValue(parentShow?.year ?? item.parentYear),
      seasonNumber,
      episodeNumber,
      plexRatingKey,
      plexWatched,
      luminaWatched,
      match: episode ? "matched" : "unmatched",
      action,
      reason: episode
        ? `${identity.reason} Matched exact S${seasonNumber}E${episodeNumber} episode row.`
        : show
          ? `${identity.reason} It has no S${seasonNumber ?? "?"}E${episodeNumber ?? "?"} episode row.`
          : `No Lumina show matched this Plex episode. ${identity.reason}`,
      luminaMediaId: show?.id,
      luminaEpisodeId: episode?.id,
      duration,
    });
  }

  const errors = [...plex.errors];
  let markedLuminaWatched = 0;
  let markedPlexWatched = 0;

  if (apply) {
    for (const row of rows) {
      try {
        if (row.action === "mark-lumina-watched" && row.luminaMediaId) {
          await markLuminaWatched({
            mediaId: row.luminaMediaId,
            episodeId: row.luminaEpisodeId ?? null,
            duration: row.duration,
          });
          markedLuminaWatched++;
        }
        if (row.action === "mark-plex-watched" && row.plexRatingKey) {
          await plexScrobble(creds, row.plexRatingKey);
          markedPlexWatched++;
        }
      } catch (error) {
        errors.push(`${row.title}: ${(error as Error).message}`);
      }
    }
  }

  const matched = rows.filter((r) => r.match === "matched").length;
  const unmatched = rows.filter((r) => r.match === "unmatched").length;
  const alreadySynced = rows.filter((r) => r.action === "already-synced").length;
  const skipped = rows.filter((r) => r.action === "skipped").length;
  const previewLumina = rows.filter((r) => r.action === "mark-lumina-watched").length;
  const previewPlex = rows.filter((r) => r.action === "mark-plex-watched").length;
  const reportPriority = (row: (typeof rows)[number]) => {
    if (row.action === "mark-lumina-watched" || row.action === "mark-plex-watched") return 0;
    return 1;
  };
  const detailLimit = 2_000;
  const detailRows = rows
    .filter(
      (row) =>
        row.action === "unmatched" ||
        row.action === "mark-lumina-watched" ||
        row.action === "mark-plex-watched"
    )
    .sort((a, b) => reportPriority(a) - reportPriority(b) || a.title.localeCompare(b.title));
  const returnedRows = detailRows.slice(0, detailLimit);

  return {
    ok: true,
    mode: apply ? "apply" : "preview",
    direction,
    serverName,
    sections: plex.sections,
    scanned: rows.length,
    matched,
    unmatched,
    alreadySynced,
    markedLuminaWatched: apply ? markedLuminaWatched : previewLumina,
    markedPlexWatched: apply ? markedPlexWatched : previewPlex,
    skipped,
    attentionTotal: detailRows.length,
    detailReturned: returnedRows.length,
    detailTruncated: detailRows.length > returnedRows.length,
    errors,
    items: returnedRows
      .map(({ luminaMediaId: _luminaMediaId, luminaEpisodeId: _luminaEpisodeId, duration: _duration, ...row }) => row),
  };
}
