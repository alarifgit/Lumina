import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type {
  MediaSummary,
  MediaDetail,
  Episode,
  Season,
  HomeData,
  ContentRow,
  LibraryStats,
  MediaType,
} from "@/lib/types";

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
  const rows = await db.watchProgress.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit * 3,
    include: { media: { include: mediaInclude }, episode: true },
  });
  const seen = new Set<string>();
  const latest: typeof rows = [];
  for (const r of rows) {
    if (!seen.has(r.mediaId)) {
      seen.add(r.mediaId);
      latest.push(r);
    }
    if (latest.length >= limit) break;
  }
  if (latest.length === 0) return [];
  const col = await getMyListCollection();
  const myListItems = await db.collectionItem.findMany({
    where: { collectionId: col.id, mediaId: { in: latest.map((r) => r.mediaId) } },
  });
  const myListSet = new Set(myListItems.map((i) => i.mediaId));
  return latest.map((r) =>
    toSummary(r.media, myListSet.has(r.mediaId), {
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
    })
  );
}

export async function getHomeData(): Promise<HomeData> {
  const [featured, continueWatching, trending, popularMovies, popularTV, topRated, newReleases, topGenres] =
    await Promise.all([
      getFeatured(6),
      getContinueWatching(12),
      getTrending(20),
      getPopularMovies(20),
      getPopularTV(20),
      getTopRated(20),
      getNewReleases(20),
      getTopGenres(4),
    ]);

  const rows: ContentRow[] = [
    { key: "trending", title: "Trending Now", items: trending },
    { key: "popular-movies", title: "Popular Movies", items: popularMovies },
    { key: "popular-tv", title: "Popular Series", items: popularTV },
    { key: "top-rated", title: "Top Rated", items: topRated },
    { key: "new-releases", title: "New Releases", items: newReleases },
  ];

  for (const g of topGenres) {
    const items = await getByGenre(g, 20);
    if (items.length) rows.push({ key: `genre-${g}`, title: g, items });
  }

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
      episodes: {
        orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
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

  const seasonNumbers = [...new Set(media.episodes.map((e) => e.seasonNumber))].sort(
    (a, b) => a - b
  );
  const seasons: Season[] = seasonNumbers.map((s) => ({
    seasonNumber: s,
    name: s === 0 ? "Specials" : `Season ${s}`,
    episodeCount: media.episodes.filter((e) => e.seasonNumber === s).length,
    airDate:
      media.episodes.find((e) => e.seasonNumber === s && e.airDate)?.airDate?.toISOString() ??
      null,
    overview: null,
  }));

  const targetSeason = season ?? seasons[0]?.seasonNumber ?? 1;
  const seasonEpisodes = media.episodes.filter((e) => e.seasonNumber === targetSeason);

  const epProgressMap = new Map(
    progressRows.filter((p) => p.episodeId).map((p) => [p.episodeId!, p])
  );
  const episodes: Episode[] = seasonEpisodes.map((e) => {
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
  });

  let nextEpisode: Episode | null = null;
  if (media.type === "TV" && media.episodes.length) {
    const watchedIds = new Set(
      progressRows.filter((p) => p.completed).map((p) => p.episodeId)
    );
    const next =
      media.episodes.find((e) => !watchedIds.has(e.id)) ?? media.episodes[0];
    nextEpisode = {
      id: next.id,
      seasonNumber: next.seasonNumber,
      episodeNumber: next.episodeNumber,
      title: next.title,
      overview: next.overview,
      stillUrl: next.stillUrl,
      airDate: next.airDate?.toISOString() ?? null,
      runtime: next.runtime,
      streamUrl: next.streamUrl,
      filePath: next.filePath,
    };
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
    seasons,
    episodes,
    nextEpisode,
  };
}

export async function browseMedia(params: {
  type?: MediaType;
  genre?: string;
  q?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}) {
  const { type, genre, q, sort = "popular", page = 1, pageSize = 24 } = params;
  const where: Prisma.MediaWhereInput = {};
  if (type) where.type = type;
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

export async function getStats(): Promise<LibraryStats> {
  const [mediaCount, movieCount, tvCount, episodeCount, genreCount, config, movieRuntime, epRuntime] =
    await Promise.all([
      db.media.count(),
      db.media.count({ where: { type: "MOVIE" } }),
      db.media.count({ where: { type: "TV" } }),
      db.episode.count(),
      db.genre.count(),
      db.libraryConfig.findUnique({ where: { id: "default" } }),
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
  };
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
  const existing = await db.watchProgress.findFirst({ where });
  if (existing) {
    await db.watchProgress.update({
      where: { id: existing.id },
      data: { position, duration, completed, updatedAt: new Date() },
    });
  } else {
    await db.watchProgress.create({
      data: { mediaId, episodeId, position, duration, completed },
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
