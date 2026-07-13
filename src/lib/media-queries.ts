import { db } from "@/lib/db";
import { getTranscodeStatus } from "@/lib/transcoder";
import { Prisma } from "@prisma/client";
import type {
  MediaSummary,
  MediaDetail,
  Episode,
  Season,
  HomeData,
  ContentRow,
  LibraryStats,
  LibrarySectionInfo,
  MediaType,
  Subtitle,
  PlexSyncDirection,
} from "@/lib/types";

type SubtitleRow = {
  id: string;
  language: string;
  label: string;
  format: string;
  isDefault: boolean;
  streamUrl: string | null;
  filePath: string | null;
};

/** Serialise subtitle rows into the client-facing shape with a serving URL. */
function serializeSubtitles(rows: SubtitleRow[]): Subtitle[] {
  return rows.map((s) => ({
    id: s.id,
    language: s.language,
    label: s.label,
    format: s.format,
    isDefault: s.isDefault,
    // Remote subs use their URL directly; local subs are served (and SRT→VTT converted) by the API
    url: s.streamUrl ?? `/api/subtitles/${s.id}`,
  }));
}

const MY_LIST_SLUG = "my-list";

export async function getMyListCollection() {
  let col = await db.collection.findUnique({ where: { slug: MY_LIST_SLUG } });
  if (!col) {
    col = await db.collection.create({
      data: { name: "My List", slug: MY_LIST_SLUG },
    });
  }
  return col;
}

type MediaRow = Prisma.MediaGetPayload<{
  include: { genres: { include: { genre: true } } };
}>;

interface ProgressInfo {
  position: number;
  duration: number;
  episodeId: string | null;
  episode?: { seasonNumber: number; episodeNumber: number } | null;
  updatedAt: Date;
}

type ContinueWatchingCandidate = {
  media: MediaRow;
  progress: ProgressInfo;
  sortAt: Date;
};

function genresOf(m: MediaRow): string[] {
  return m.genres.map((g) => g.genre.name).sort();
}

export function toSummary(
  m: MediaRow,
  inMyList: boolean,
  progress?: ProgressInfo
): MediaSummary {
  const percent =
    progress && progress.duration > 0
      ? (progress.position / progress.duration) * 100
      : undefined;
  return {
    id: m.id,
    type: m.type as MediaType,
    title: m.title,
    posterUrl: m.posterUrl,
    backdropUrl: m.backdropUrl,
    year: m.year,
    rating: m.rating,
    runtime: m.runtime,
    genres: genresOf(m),
    certification: m.certification,
    overview: m.overview,
    tagline: m.tagline,
    featured: m.featured,
    trending: m.trending,
    popularity: m.popularity,
    inMyList,
    createdAt: m.createdAt?.toISOString() ?? null,
    sourceCreatedAt: m.sourceCreatedAt?.toISOString() ?? null,
    sourceModifiedAt: m.sourceModifiedAt?.toISOString() ?? null,
    ...(progress
      ? {
          progressPercent: percent,
          progressPosition: progress.position,
          progressDuration: progress.duration,
          progressEpisodeId: progress.episodeId,
          progressSeason: progress.episode?.seasonNumber ?? null,
          progressEpisode: progress.episode?.episodeNumber ?? null,
          progressUpdatedAt: progress.updatedAt.toISOString(),
        }
      : {}),
  };
}

/** Bulk-attach My List flags + latest progress to a set of media rows. */
export async function attachSummaryData(
  items: MediaRow[]
): Promise<MediaSummary[]> {
  if (items.length === 0) return [];
  const ids = items.map((m) => m.id);
  const col = await getMyListCollection();
  const myListItems = await db.collectionItem.findMany({
    where: { collectionId: col.id, mediaId: { in: ids } },
  });
  const myListSet = new Set(myListItems.map((i) => i.mediaId));
  const progressRows = await db.watchProgress.findMany({
    where: { mediaId: { in: ids } },
    orderBy: { updatedAt: "desc" },
    include: { episode: true },
  });
  const progressMap = new Map<string, ProgressInfo>();
  for (const p of progressRows) {
    if (!progressMap.has(p.mediaId)) {
      progressMap.set(p.mediaId, {
        position: p.position,
        duration: p.duration,
        episodeId: p.episodeId,
        episode: p.episode
          ? {
              seasonNumber: p.episode.seasonNumber,
              episodeNumber: p.episode.episodeNumber,
            }
          : null,
        updatedAt: p.updatedAt,
      });
    }
  }
  return items.map((m) =>
    toSummary(m, myListSet.has(m.id), progressMap.get(m.id))
  );
}

const mediaInclude = { genres: { include: { genre: true } } } as const;

export async function getFeatured(limit = 6): Promise<MediaSummary[]> {
  const items = await db.media.findMany({
    where: { OR: [{ featured: true }, { backdropUrl: { not: null } }] },
    orderBy: [{ featured: "desc" }, { popularity: "desc" }],
    take: limit,
    include: mediaInclude,
  });
  return attachSummaryData(items);
}

export async function getTrending(limit = 20): Promise<MediaSummary[]> {
  const items = await db.media.findMany({
    orderBy: [{ trending: "desc" }, { popularity: "desc" }],
    take: limit,
    include: mediaInclude,
  });
  return attachSummaryData(items);
}

export async function getPopularMovies(limit = 20): Promise<MediaSummary[]> {
  const items = await db.media.findMany({
    where: { type: "MOVIE" },
    orderBy: { popularity: "desc" },
    take: limit,
    include: mediaInclude,
  });
  return attachSummaryData(items);
}

export async function getPopularTV(limit = 20): Promise<MediaSummary[]> {
  const items = await db.media.findMany({
    where: { type: "TV" },
    orderBy: { popularity: "desc" },
    take: limit,
    include: mediaInclude,
  });
  return attachSummaryData(items);
}

export async function getTopRated(limit = 20): Promise<MediaSummary[]> {
  const items = await db.media.findMany({
    where: { rating: { not: null } },
    orderBy: { rating: "desc" },
    take: limit,
    include: mediaInclude,
  });
  return attachSummaryData(items);
}

export async function getNewReleases(limit = 20): Promise<MediaSummary[]> {
  const items = await db.media.findMany({
    where: { year: { not: null } },
    orderBy: { year: "desc" },
    take: limit,
    include: mediaInclude,
  });
  return attachSummaryData(items);
}

export async function getByGenre(
  genre: string,
  limit = 20
): Promise<MediaSummary[]> {
  const items = await db.media.findMany({
    where: { genres: { some: { genre: { name: genre } } } },
    orderBy: { popularity: "desc" },
    take: limit,
    include: mediaInclude,
  });
  return attachSummaryData(items);
}

/**
 * Recently added MOVIES — newest by filesystem timestamp, falling back to
 * row creation time until the next scan backfills source timestamps.
 */
export async function getRecentlyAddedMovies(limit = 20): Promise<MediaSummary[]> {
  const items = await db.media.findMany({
    where: { type: "MOVIE" },
    orderBy: [{ sourceModifiedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: mediaInclude,
  });
  return attachSummaryData(items);
}

/**
 * Recently added EPISODES — newest episodes by filesystem timestamp, collapsed to
 * their parent show so we don't show the same show 5 times. Each returned
 * summary carries the latest episode's id/season/episode for "resume" context.
 */
export async function getRecentlyAddedEpisodes(limit = 20): Promise<MediaSummary[]> {
  // Fetch the newest episodes, grouped by show
  const episodes = await db.episode.findMany({
    orderBy: [{ sourceModifiedAt: "desc" }, { createdAt: "desc" }],
    take: limit * 5, // over-fetch to dedupe by show
    include: { media: { include: mediaInclude } },
  });
  const seen = new Set<string>();
  const picked: typeof episodes = [];
  for (const ep of episodes) {
    if (!seen.has(ep.mediaId)) {
      seen.add(ep.mediaId);
      picked.push(ep);
    }
    if (picked.length >= limit) break;
  }
  if (picked.length === 0) return [];
  const col = await getMyListCollection();
  const myListItems = await db.collectionItem.findMany({
    where: { collectionId: col.id, mediaId: { in: picked.map((e) => e.mediaId) } },
  });
  const myListSet = new Set(myListItems.map((i) => i.mediaId));
  return picked.map((ep) =>
    toSummary(ep.media, myListSet.has(ep.mediaId), {
      position: 0,
      duration: 0,
      episodeId: ep.id,
      episode: { seasonNumber: ep.seasonNumber, episodeNumber: ep.episodeNumber },
      updatedAt: ep.sourceModifiedAt ?? ep.createdAt,
    })
  );
}

export async function getTopGenres(limit = 5): Promise<string[]> {
  const grouped = await db.mediaGenre.groupBy({
    by: ["genreId"],
    _count: { mediaId: true },
    orderBy: { _count: { mediaId: "desc" } },
    take: limit,
  });
  const genres = await db.genre.findMany({
    where: { id: { in: grouped.map((g) => g.genreId) } },
  });
  const nameById = new Map(genres.map((g) => [g.id, g.name]));
  return grouped
    .map((g) => nameById.get(g.genreId))
    .filter((n): n is string => !!n);
}

export async function getContinueWatching(
  limit = 12
): Promise<MediaSummary[]> {
  const maxNextEpisodeAgeDays = Number(process.env.LUMINA_CONTINUE_NEXT_EPISODE_DAYS ?? 730);
  const maxNextEpisodeAgeMs = Math.max(1, maxNextEpisodeAgeDays) * 24 * 60 * 60 * 1000;

  const inProgressRows = await db.watchProgress.findMany({
    where: { completed: false, hiddenFromContinueWatching: false },
    orderBy: { updatedAt: "desc" },
    take: limit * 3,
    include: { media: { include: mediaInclude }, episode: true },
  });
  const seen = new Set<string>();
  const candidates: ContinueWatchingCandidate[] = [];

  for (const r of inProgressRows) {
    if (!seen.has(r.mediaId)) {
      seen.add(r.mediaId);
      candidates.push({
        media: r.media,
        progress: {
          position: r.position,
          duration: r.duration,
          episodeId: r.episodeId,
          episode: r.episode
            ? {
                seasonNumber: r.episode.seasonNumber,
                episodeNumber: r.episode.episodeNumber,
              }
            : null,
          updatedAt: r.updatedAt,
        },
        sortAt: r.updatedAt,
      });
    }
    if (candidates.length >= limit) break;
  }

  if (candidates.length < limit) {
    const dismissedRows = await db.watchProgress.findMany({
      where: { hiddenFromContinueWatching: true },
      select: { mediaId: true },
      distinct: ["mediaId"],
    });
    const dismissedMediaIds = new Set(dismissedRows.map((row) => row.mediaId));
    const watchedEpisodeRows = await db.watchProgress.findMany({
      where: {
        completed: true,
        episodeId: { not: null },
        media: { type: "TV", id: { notIn: [...seen] } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit * 6,
      include: {
        episode: true,
        media: {
          include: {
            genres: { include: { genre: true } },
            episodes: {
              orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
              include: { progress: { where: { completed: true } } },
            },
          },
        },
      },
    });

    for (const watched of watchedEpisodeRows) {
      if (
        !watched.episode ||
        seen.has(watched.mediaId) ||
        dismissedMediaIds.has(watched.mediaId)
      ) continue;
      const show = watched.media;

      const latestIndex = show.episodes.findIndex((ep) => ep.id === watched.episodeId);
      if (latestIndex < 0) continue;

      const watchedIds = new Set(
        show.episodes
          .filter((ep) => ep.progress.some((p) => p.completed))
          .map((ep) => ep.id)
      );
      const nextEpisode = show.episodes
        .slice(latestIndex + 1)
        .find((ep) => !watchedIds.has(ep.id) && (ep.filePath || ep.streamUrl));
      if (!nextEpisode) continue;

      const now = Date.now();
      if (nextEpisode.airDate && nextEpisode.airDate.getTime() > now) continue;

      const previousAirDate = watched.episode.airDate;
      const nextEpisodeAge =
        previousAirDate && nextEpisode.airDate
          ? nextEpisode.airDate.getTime() - previousAirDate.getTime()
          : now - watched.updatedAt.getTime();
      if (nextEpisodeAge > maxNextEpisodeAgeMs) continue;

      seen.add(show.id);
      candidates.push({
        media: show,
        progress: {
          position: 0,
          duration: (nextEpisode.runtime ?? show.runtime ?? 0) * 60,
          episodeId: nextEpisode.id,
          episode: {
            seasonNumber: nextEpisode.seasonNumber,
            episodeNumber: nextEpisode.episodeNumber,
          },
          updatedAt: nextEpisode.airDate ?? nextEpisode.sourceModifiedAt ?? nextEpisode.createdAt,
        },
        sortAt: nextEpisode.airDate ?? nextEpisode.sourceModifiedAt ?? nextEpisode.createdAt,
      });

      if (candidates.length >= limit) break;
    }
  }

  if (candidates.length === 0) return [];
  candidates.sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime());
  const latest = candidates.slice(0, limit);

  const col = await getMyListCollection();
  const myListItems = await db.collectionItem.findMany({
    where: { collectionId: col.id, mediaId: { in: latest.map((r) => r.media.id) } },
  });
  const myListSet = new Set(myListItems.map((i) => i.mediaId));
  return latest.map((r) => toSummary(r.media, myListSet.has(r.media.id), r.progress));
}

export async function getHomeData(): Promise<HomeData> {
  const [featured, continueWatching, recentlyAddedEpisodes, recentlyAddedMovies, trending, popularMovies, popularTV, topRated, newReleases] =
    await Promise.all([
      getFeatured(6),
      getContinueWatching(12),
      getRecentlyAddedEpisodes(20),
      getRecentlyAddedMovies(20),
      getTrending(20),
      getPopularMovies(20),
      getPopularTV(20),
      getTopRated(20),
      getNewReleases(20),
    ]);

  const rows: ContentRow[] = [
    { key: "recently-added-episodes", title: "Recently Added Episodes", items: recentlyAddedEpisodes },
    { key: "recently-added-movies", title: "Recently Added Movies", items: recentlyAddedMovies },
    { key: "trending", title: "Trending Now", items: trending },
    { key: "popular-movies", title: "Popular Movies", items: popularMovies },
    { key: "popular-tv", title: "Popular Series", items: popularTV },
    { key: "top-rated", title: "Top Rated", items: topRated },
    { key: "new-releases", title: "New Releases", items: newReleases },
  ];

  return { featured, continueWatching, rows };
}

export async function getMediaDetail(
  id: string,
  season?: number
): Promise<MediaDetail | null> {
  const media = await db.media.findUnique({
    where: { id },
    include: {
      genres: { include: { genre: true } },
      subtitles: true,
      episodes: {
        orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
        include: { subtitles: true },
      },
    },
  });
  if (!media) return null;

  const col = await getMyListCollection();
  const inMyListItem = await db.collectionItem.findUnique({
    where: { collectionId_mediaId: { collectionId: col.id, mediaId: id } },
  });
  const inMyList = !!inMyListItem;

  const progressRows = await db.watchProgress.findMany({
    where: { mediaId: id },
    orderBy: { updatedAt: "desc" },
    include: { episode: true },
  });
  const latestProgress = progressRows[0];

  const playableEpisodeRows = media.episodes.filter((e) => e.filePath || e.streamUrl);
  const episodeRowsForDisplay = media.type === "TV" ? playableEpisodeRows : media.episodes;

  const seasonNumbers = [...new Set(episodeRowsForDisplay.map((e) => e.seasonNumber))].sort(
    (a, b) => a - b
  );
  const seasons: Season[] = seasonNumbers.map((s) => ({
    seasonNumber: s,
    name: s === 0 ? "Specials" : `Season ${s}`,
    episodeCount: episodeRowsForDisplay.filter((e) => e.seasonNumber === s).length,
    airDate:
      episodeRowsForDisplay.find((e) => e.seasonNumber === s && e.airDate)?.airDate?.toISOString() ??
      null,
    overview: null,
  }));

  const targetSeason = season ?? seasons[0]?.seasonNumber ?? 1;
  const seasonEpisodes = episodeRowsForDisplay.filter((e) => e.seasonNumber === targetSeason);

  const epProgressMap = new Map(
    progressRows.filter((p) => p.episodeId).map((p) => [p.episodeId!, p])
  );
  const serializeEpisode = (e: typeof media.episodes[number]): Episode => {
    const p = epProgressMap.get(e.id);
    return {
      id: e.id,
      seasonNumber: e.seasonNumber,
      episodeNumber: e.episodeNumber,
      title: e.title,
      overview: e.overview,
      stillUrl: e.stillUrl,
      airDate: e.airDate?.toISOString() ?? null,
      runtime: e.runtime,
      streamUrl: e.streamUrl,
      filePath: e.filePath,
      subtitles: serializeSubtitles(e.subtitles),
      ...(p
        ? {
            progressPercent:
              p.duration > 0 ? (p.position / p.duration) * 100 : 0,
            progressPosition: p.position,
            progressDuration: p.duration,
            completed: p.completed,
          }
        : {}),
    };
  };
  const episodes: Episode[] = seasonEpisodes.map(serializeEpisode);
  const playableEpisodes = playableEpisodeRows.map(serializeEpisode);

  let nextEpisode: Episode | null = null;
  if (media.type === "TV" && playableEpisodeRows.length) {
    const watchedIds = new Set(
      progressRows.filter((p) => p.completed).map((p) => p.episodeId)
    );
    const now = Date.now();
    const next =
      playableEpisodeRows.find((e) => !watchedIds.has(e.id) && (!e.airDate || e.airDate.getTime() <= now)) ??
      playableEpisodeRows[0];
    nextEpisode = serializeEpisode(next);
  }

  const summary = toSummary(
    media,
    inMyList,
    latestProgress
      ? {
          position: latestProgress.position,
          duration: latestProgress.duration,
          episodeId: latestProgress.episodeId,
          episode: latestProgress.episode
            ? {
                seasonNumber: latestProgress.episode.seasonNumber,
                episodeNumber: latestProgress.episode.episodeNumber,
              }
            : null,
          updatedAt: latestProgress.updatedAt,
        }
      : undefined
  );

  return {
    ...summary,
    tmdbId: media.tmdbId,
    imdbId: media.imdbId,
    voteCount: media.voteCount,
    status: media.status,
    releaseDate: media.releaseDate?.toISOString() ?? null,
    streamUrl: media.streamUrl,
    filePath: media.filePath,
    sourceCreatedAt: media.sourceCreatedAt?.toISOString() ?? null,
    sourceModifiedAt: media.sourceModifiedAt?.toISOString() ?? null,
    subtitles: serializeSubtitles(media.subtitles),
    sectionId: media.sectionId,
    category: media.category,
    seasons,
    episodes,
    playableEpisodes,
    nextEpisode,
  };
}

export async function browseMedia(params: {
  type?: MediaType;
  genre?: string;
  category?: string;
  sectionId?: string;
  q?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}) {
  const { type, genre, category, sectionId, q, sort = "popular", page = 1, pageSize = 24 } = params;
  const where: Prisma.MediaWhereInput = {};
  if (type) where.type = type;
  if (category) where.category = category;
  if (sectionId) where.sectionId = sectionId;
  if (q) where.title = { contains: q };
  if (genre) where.genres = { some: { genre: { name: genre } } };

  const orderBy: Prisma.MediaOrderByWithRelationInput =
    sort === "rating"
      ? { rating: "desc" }
      : sort === "year"
        ? { year: "desc" }
        : sort === "title"
          ? { title: "asc" }
          : { popularity: "desc" };

  const [total, items] = await Promise.all([
    db.media.count({ where }),
    db.media.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: mediaInclude,
    }),
  ]);
  const summaries = await attachSummaryData(items);
  const genres = await getAllGenres();
  return { items: summaries, total, page, pageSize, genres };
}

export async function searchMedia(q: string, limit = 30) {
  const trimmed = q.trim();
  if (!trimmed) return { items: [], query: q };
  const items = await db.media.findMany({
    where: { title: { contains: trimmed } },
    take: limit,
    orderBy: { popularity: "desc" },
    include: mediaInclude,
  });
  return { items: await attachSummaryData(items), query: q };
}

export async function getMyList(): Promise<MediaSummary[]> {
  const col = await getMyListCollection();
  const items = await db.collectionItem.findMany({
    where: { collectionId: col.id },
    orderBy: { addedAt: "desc" },
    include: { media: { include: mediaInclude } },
  });
  return attachSummaryData(items.map((i) => i.media));
}

export async function getAllGenres(): Promise<string[]> {
  const genres = await db.genre.findMany({ orderBy: { name: "asc" } });
  return genres.map((g) => g.name);
}

async function getLibraryConfigForStats() {
  try {
    return await db.libraryConfig.findUnique({ where: { id: "default" } });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2022"
    ) {
      return null;
    }
    throw error;
  }
}

export async function getLibraryConfig() {
  const config = await db.libraryConfig.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
  return {
    tmdbKey: config.tmdbKey ?? process.env.TMDB_API_KEY ?? "",
    plexUrl: config.plexUrl ?? process.env.PLEX_URL ?? process.env.LUMINA_PLEX_URL ?? "",
    plexTokenSaved: !!(config.plexToken || process.env.PLEX_TOKEN || process.env.LUMINA_PLEX_TOKEN),
    plexSyncDirection: (config.plexSyncDirection || "pull") as PlexSyncDirection,
  };
}

export async function getStats(): Promise<LibraryStats> {
  const [mediaCount, movieCount, tvCount, episodeCount, genreCount, config, movieRuntime, epRuntime] =
    await Promise.all([
      db.media.count(),
      db.media.count({ where: { type: "MOVIE" } }),
      db.media.count({ where: { type: "TV" } }),
      db.episode.count(),
      db.genre.count(),
      getLibraryConfigForStats(),
      db.media.aggregate({ where: { type: "MOVIE" }, _sum: { runtime: true } }),
      db.episode.aggregate({ _sum: { runtime: true } }),
    ]);
  const totalMinutes = (movieRuntime._sum.runtime ?? 0) + (epRuntime._sum.runtime ?? 0);
  return {
    mediaCount,
    movieCount,
    tvCount,
    episodeCount,
    genreCount,
    totalRuntimeHours: Math.round(totalMinutes / 60),
    lastScan: config?.lastScan?.toISOString() ?? null,
    scanCount: config?.scanCount ?? 0,
    mediaDir: config?.mediaDir ?? "/media",
    tmdbKey: config?.tmdbKey ?? null,
    ...getTranscodeStatus(),
  };
}

/** Persist the global TMDB API key to LibraryConfig (used by scans + metadata fetches). */
export async function saveTmdbKey(key: string): Promise<{ ok: true }> {
  await db.libraryConfig.upsert({
    where: { id: "default" },
    update: { tmdbKey: key || null },
    create: { id: "default", tmdbKey: key || null },
  });
  return { ok: true };
}

export async function saveLibraryConfig(input: {
  tmdbKey?: string;
  plexUrl?: string;
  plexToken?: string;
  plexSyncDirection?: PlexSyncDirection;
}) {
  const data: {
    tmdbKey?: string | null;
    plexUrl?: string | null;
    plexToken?: string | null;
    plexSyncDirection?: string;
  } = {};

  if (input.tmdbKey !== undefined) data.tmdbKey = input.tmdbKey.trim() || null;
  if (input.plexUrl !== undefined) data.plexUrl = input.plexUrl.trim().replace(/\/+$/, "") || null;
  if (input.plexToken !== undefined) data.plexToken = input.plexToken.trim() || null;
  if (input.plexSyncDirection) data.plexSyncDirection = input.plexSyncDirection;

  await db.libraryConfig.upsert({
    where: { id: "default" },
    update: data,
    create: { id: "default", ...data },
  });
  return { ok: true, config: await getLibraryConfig() };
}

export async function saveProgress(payload: {
  mediaId: string;
  episodeId?: string | null;
  position: number;
  duration: number;
  completed?: boolean;
}) {
  const { mediaId, episodeId = null, position, duration, completed = false } = payload;
  const where = episodeId ? { mediaId, episodeId } : { mediaId, episodeId: null };
  await db.watchProgress.updateMany({
    where: { mediaId, hiddenFromContinueWatching: true },
    data: { hiddenFromContinueWatching: false },
  });
  const existing = await db.watchProgress.findFirst({ where });
  if (existing) {
    await db.watchProgress.update({
      where: { id: existing.id },
      data: {
        position,
        duration,
        completed,
        hiddenFromContinueWatching: false,
        updatedAt: new Date(),
      },
    });
  } else {
    await db.watchProgress.create({
      data: { mediaId, episodeId, position, duration, completed },
    });
  }
  return { ok: true };
}

export async function dismissContinueWatching(input: {
  mediaId: string;
  episodeId?: string | null;
  duration?: number;
}) {
  const { mediaId, episodeId = null, duration = 0 } = input;
  const media = await db.media.findUnique({ where: { id: mediaId }, select: { id: true } });
  if (!media) throw new Error("Media item not found");

  const hidden = await db.watchProgress.updateMany({
    where: { mediaId, completed: false },
    data: { hiddenFromContinueWatching: true },
  });
  if (hidden.count === 0) {
    await db.watchProgress.create({
      data: {
        mediaId,
        episodeId,
        position: 0,
        duration: Math.max(0, duration),
        completed: false,
        hiddenFromContinueWatching: true,
      },
    });
  }
  return { ok: true };
}

export async function toggleMyList(mediaId: string) {
  const col = await getMyListCollection();
  const existing = await db.collectionItem.findUnique({
    where: { collectionId_mediaId: { collectionId: col.id, mediaId } },
  });
  if (existing) {
    await db.collectionItem.delete({ where: { id: existing.id } });
    return { ok: true, inMyList: false };
  }
  await db.collectionItem.create({ data: { collectionId: col.id, mediaId } });
  return { ok: true, inMyList: true };
}

// ── Library sections ──────────────────────────────────────────────

export async function getSections(): Promise<LibrarySectionInfo[]> {
  const sections = await db.librarySection.findMany({
    orderBy: [{ type: "asc" }, { category: "asc" }, { name: "asc" }],
    include: { _count: { select: { media: true } } },
  });
  return sections.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type as MediaType,
    category: s.category,
    mediaDir: s.mediaDir,
    tmdbKey: s.tmdbKey,
    autoMatch: s.autoMatch,
    lastScan: s.lastScan?.toISOString() ?? null,
    scanCount: s.scanCount,
    mediaCount: s._count.media,
  }));
}

export async function createSection(input: {
  name: string;
  type: MediaType;
  category?: string;
  mediaDir: string;
  tmdbKey?: string;
  autoMatch?: boolean;
}): Promise<LibrarySectionInfo> {
  const s = await db.librarySection.create({
    data: {
      name: input.name,
      type: input.type,
      category: input.category ?? "default",
      mediaDir: input.mediaDir,
      tmdbKey: input.tmdbKey,
      autoMatch: input.autoMatch ?? true,
    },
  });
  return {
    id: s.id,
    name: s.name,
    type: s.type as MediaType,
    category: s.category,
    mediaDir: s.mediaDir,
    tmdbKey: s.tmdbKey,
    autoMatch: s.autoMatch,
    lastScan: s.lastScan?.toISOString() ?? null,
    scanCount: s.scanCount,
    mediaCount: 0,
  };
}

export async function updateSection(
  id: string,
  input: Partial<{
    name: string;
    mediaDir: string;
    tmdbKey: string;
    autoMatch: boolean;
  }>
) {
  const s = await db.librarySection.update({ where: { id }, data: input });
  return { ok: true, id: s.id };
}

export async function deleteSection(id: string) {
  // Detach media (set sectionId null, keep category for display continuity) then delete section
  await db.media.updateMany({ where: { sectionId: id }, data: { sectionId: null } });
  await db.librarySection.delete({ where: { id } });
  return { ok: true };
}

/** Get a single subtitle record (for the serving endpoint). */
export async function getSubtitle(id: string) {
  return db.subtitle.findUnique({ where: { id } });
}
