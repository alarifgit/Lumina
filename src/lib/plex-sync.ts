import { db } from "@/lib/db";

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
  ratingKey?: string | number;
  title?: string;
  grandparentTitle?: string;
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

function externalIds(item: PlexMetadata) {
  const ids = new Map<string, string>();
  for (const raw of [item.guid, item.grandparentGuid, ...asArray(item.Guid).map((g) => g.id)]) {
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

function parsePlexXml(text: string) {
  const container = parseXmlAttrs(text.match(/<MediaContainer\b([^>]*)>/)?.[1] ?? "");
  const directories = [...text.matchAll(/<Directory\b([^>]*)\/?>/g)].map((match) =>
    parseXmlAttrs(match[1])
  );
  const videos = [...text.matchAll(/<Video\b([^>]*)(?:\/>|>([\s\S]*?)<\/Video>)/g)].map(
    (match) => {
      const item = parseXmlAttrs(match[1]) as PlexMetadata;
      const guidBlock = match[2] ?? "";
      const guids = [...guidBlock.matchAll(/<Guid\b([^>]*)\/?>/g)].map((guidMatch) =>
        parseXmlAttrs(guidMatch[1])
      );
      if (guids.length) item.Guid = guids;
      return item;
    }
  );
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

async function plexSectionItems(creds: { url: string; token: string }, section: PlexSection) {
  const type = section.type === "show" ? "4" : "1";
  const data = await plexGet<{ MediaContainer?: { Metadata?: PlexMetadata[] | PlexMetadata } }>(
    creds,
    `/library/sections/${section.key}/all`,
    { type, includeGuids: "1" }
  );
  return asArray(data.MediaContainer?.Metadata);
}

async function loadPlexLibrary(creds: { url: string; token: string }) {
  const sections = await plexSections(creds);
  const supported = sections.filter((s) => s.type === "movie" || s.type === "show");
  const items: PlexMetadata[] = [];
  const errors: string[] = [];

  for (const section of supported) {
    try {
      items.push(...(await plexSectionItems(creds, section)));
    } catch (error) {
      errors.push(`${section.title ?? section.key}: ${(error as Error).message}`);
    }
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
    byTmdb: Map<number, MediaWithProgress>;
    byImdb: Map<string, MediaWithProgress>;
    byTitleYear: Map<string, MediaWithProgress>;
    byTitle: Map<string, MediaWithProgress>;
  }
) {
  const ids = externalIds(item);
  const year = numberValue(item.year);
  const byTmdb = ids.tmdbId ? maps.byTmdb.get(ids.tmdbId) : undefined;
  if (byTmdb) return byTmdb;
  const byImdb = ids.imdbId ? maps.byImdb.get(ids.imdbId) : undefined;
  if (byImdb) return byImdb;
  return maps.byTitleYear.get(keyFor(item.title, year)) ?? maps.byTitle.get(keyFor(item.title));
}

function findShow(
  item: PlexMetadata,
  maps: {
    byTmdb: Map<number, ShowWithEpisodes>;
    byImdb: Map<string, ShowWithEpisodes>;
    byTitleYear: Map<string, ShowWithEpisodes>;
    byTitle: Map<string, ShowWithEpisodes>;
  }
) {
  const ids = externalIds(item);
  const year = numberValue(item.parentYear ?? item.year);
  const title = item.grandparentTitle ?? item.title;
  const byTmdb = ids.tmdbId ? maps.byTmdb.get(ids.tmdbId) : undefined;
  if (byTmdb) return byTmdb;
  const byImdb = ids.imdbId ? maps.byImdb.get(ids.imdbId) : undefined;
  if (byImdb) return byImdb;
  return maps.byTitleYear.get(keyFor(title, year)) ?? maps.byTitle.get(keyFor(title));
}

function buildMaps(library: Awaited<ReturnType<typeof loadLuminaLibrary>>) {
  const movieMaps = {
    byTmdb: new Map<number, MediaWithProgress>(),
    byImdb: new Map<string, MediaWithProgress>(),
    byTitleYear: new Map<string, MediaWithProgress>(),
    byTitle: new Map<string, MediaWithProgress>(),
  };
  for (const movie of library.movies) {
    if (movie.tmdbId) movieMaps.byTmdb.set(movie.tmdbId, movie);
    if (movie.imdbId) movieMaps.byImdb.set(movie.imdbId, movie);
    movieMaps.byTitleYear.set(keyFor(movie.title, movie.year), movie);
    movieMaps.byTitle.set(keyFor(movie.title), movie);
  }

  const showMaps = {
    byTmdb: new Map<number, ShowWithEpisodes>(),
    byImdb: new Map<string, ShowWithEpisodes>(),
    byTitleYear: new Map<string, ShowWithEpisodes>(),
    byTitle: new Map<string, ShowWithEpisodes>(),
  };
  for (const show of library.shows) {
    if (show.tmdbId) showMaps.byTmdb.set(show.tmdbId, show);
    if (show.imdbId) showMaps.byImdb.set(show.imdbId, show);
    showMaps.byTitleYear.set(keyFor(show.title, show.year), show);
    showMaps.byTitle.set(keyFor(show.title), show);
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
    errors: [],
    items: [],
  };
}

export async function syncPlexWatched(input: PlexSyncRequest): Promise<PlexSyncResult> {
  const creds = await credentials(input);
  const config = await db.libraryConfig.findUnique({ where: { id: "default" } }).catch(() => null);
  const direction = input.direction ?? (config?.plexSyncDirection as PlexSyncDirection | undefined) ?? "pull";
  const apply = input.apply ?? false;
  const [serverName, plex, lumina] = await Promise.all([
    plexIdentity(creds).catch(() => null),
    loadPlexLibrary(creds),
    loadLuminaLibrary(input.sectionId),
  ]);
  const { movieMaps, showMaps } = buildMaps(lumina);
  const rows: Array<
    PlexSyncItem & { luminaMediaId?: string; luminaEpisodeId?: string | null; duration: number }
  > = [];

  for (const item of plex.items) {
    const type = item.type === "episode" ? "TV" : "MOVIE";
    const plexWatched = Number(item.viewCount ?? 0) > 0 || !!item.lastViewedAt;
    const plexRatingKey = item.ratingKey != null ? String(item.ratingKey) : null;
    const duration = Math.max(1, (numberValue(item.duration) ?? 0) / 1000);

    if (type === "MOVIE") {
      const movie = findMovie(item, movieMaps);
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
        reason: movie ? "Matched movie by external id or title/year." : "No Lumina movie matched this Plex item.",
        luminaMediaId: movie?.id,
        luminaEpisodeId: null,
        duration,
      });
      continue;
    }

    const show = findShow(item, showMaps);
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
      year: numberValue(item.parentYear ?? item.year),
      seasonNumber,
      episodeNumber,
      plexRatingKey,
      plexWatched,
      luminaWatched,
      match: episode ? "matched" : "unmatched",
      action,
      reason: episode
        ? "Matched episode by show title/external id plus season/episode."
        : "No Lumina episode matched this Plex item.",
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
    errors,
    items: rows
      .filter((r) => r.action !== "skipped" || r.match === "unmatched")
      .slice(0, 80)
      .map(({ luminaMediaId: _luminaMediaId, luminaEpisodeId: _luminaEpisodeId, duration: _duration, ...row }) => row),
  };
}
