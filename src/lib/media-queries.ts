import { db } from "@/lib/db";
import { getTranscodeStatus } from "@/lib/transcoder";
import { isTextSubtitleCodec } from "@/lib/subtitles";
import { resolvePlaybackDecision } from "@/lib/playback-selection";
import { Prisma } from "@prisma/client";
import type {
  BrowsePreset,
  BrowseSort,
  MediaSummary,
  MediaDetail,
  Episode,
  Season,
  HomeData,
  ContentRow,
  LibraryStats,
  LibrarySectionInfo,
  MediaType,
  SearchEpisodeResult,
  SearchResults,
  Subtitle,
  PlexSyncDirection,
  WatchState,
} from "@/lib/types";

type SubtitleRow = {
  id: string;
  language: string;
  label: string;
  format: string;
  isDefault: boolean;
  streamUrl: string | null;
  filePath: string | null;
  streamIndex: number | null;
  codec: string | null;
};

/** Serialise subtitle rows into the client-facing shape with a serving URL. */
function serializeSubtitles(rows: SubtitleRow[]): Subtitle[] {
  return rows.map((s) => ({
    id: s.id,
    language: s.language,
    label: s.label,
    format: s.format,
    isDefault: s.isDefault,
    source: s.streamIndex == null ? "sidecar" : "embedded",
    delivery:
      s.streamIndex != null && !isTextSubtitleCodec(s.codec)
        ? "burn-in"
        : "track",
    // Remote subs use their URL directly; local subs are served (and SRT→VTT converted) by the API
    url: s.streamUrl ?? `/api/subtitles/${s.id}`,
  }));
}

const MY_LIST_SLUG = "my-list";

const playableEpisodeWhere: Prisma.EpisodeWhereInput = {
  OR: [{ filePath: { not: null } }, { streamUrl: { not: null } }],
};

const playableMediaWhere: Prisma.MediaWhereInput = {
  OR: [
    {
      type: "MOVIE",
      OR: [{ filePath: { not: null } }, { streamUrl: { not: null } }],
    },
    {
      type: "TV",
      episodes: {
        some: playableEpisodeWhere,
      },
    },
  ],
};

function locallyAvailable(where: Prisma.MediaWhereInput = {}): Prisma.MediaWhereInput {
  return { AND: [where, playableMediaWhere] };
}

type BrowseDefinition = {
  where: Prisma.MediaWhereInput;
  orderBy: Prisma.MediaOrderByWithRelationInput[];
};

function browsePresetDefinition(preset: BrowsePreset): BrowseDefinition {
  switch (preset) {
    case "recently-added-movies":
      return {
        where: { type: "MOVIE" },
        orderBy: [
          { sourceModifiedAt: "desc" },
          { createdAt: "desc" },
          { title: "asc" },
          { id: "asc" },
        ],
      };
    case "trending":
      return {
        where: {},
        orderBy: [
          { trending: "desc" },
          { popularity: "desc" },
          { title: "asc" },
          { id: "asc" },
        ],
      };
    case "popular-movies":
      return {
        where: { type: "MOVIE" },
        orderBy: [{ popularity: "desc" }, { title: "asc" }, { id: "asc" }],
      };
    case "popular-tv":
      return {
        where: { type: "TV" },
        orderBy: [{ popularity: "desc" }, { title: "asc" }, { id: "asc" }],
      };
    case "top-rated":
      return {
        where: { rating: { not: null } },
        orderBy: [
          { rating: "desc" },
          { popularity: "desc" },
          { title: "asc" },
          { id: "asc" },
        ],
      };
    case "new-releases":
      return {
        where: { year: { not: null } },
        orderBy: [
          { year: "desc" },
          { popularity: "desc" },
          { title: "asc" },
          { id: "asc" },
        ],
      };
  }
}

function browseSortOrder(sort: BrowseSort): Prisma.MediaOrderByWithRelationInput[] {
  if (sort === "rating") {
    return [{ rating: "desc" }, { popularity: "desc" }, { title: "asc" }, { id: "asc" }];
  }
  if (sort === "year") {
    return [{ year: "desc" }, { popularity: "desc" }, { title: "asc" }, { id: "asc" }];
  }
  if (sort === "title") return [{ title: "asc" }, { id: "asc" }];
  return [{ popularity: "desc" }, { title: "asc" }, { id: "asc" }];
}

const progressActivityWhere: Prisma.WatchProgressWhereInput = {
  OR: [{ completed: true }, { position: { gt: 0 } }],
};

const playableEpisodeWithoutCompletedProgress: Prisma.EpisodeWhereInput = {
  AND: [playableEpisodeWhere, { progress: { none: { completed: true } } }],
};

/**
 * Browse watch states are deliberately disjoint. A TV title is only watched
 * when every locally playable episode is complete; completing a single episode
 * makes a partially watched series in-progress instead.
 */
function watchStateWhere(watchState: WatchState): Prisma.MediaWhereInput {
  if (watchState === "all") return {};

  if (watchState === "watched") {
    return {
      OR: [
        {
          type: "MOVIE",
          progress: { some: { episodeId: null, completed: true } },
        },
        {
          type: "TV",
          AND: [
            { episodes: { some: playableEpisodeWhere } },
            { episodes: { none: playableEpisodeWithoutCompletedProgress } },
          ],
        },
      ],
    };
  }

  if (watchState === "in-progress") {
    return {
      OR: [
        {
          type: "MOVIE",
          AND: [
            {
              progress: {
                some: { episodeId: null, completed: false, position: { gt: 0 } },
              },
            },
            { progress: { none: { episodeId: null, completed: true } } },
          ],
        },
        {
          type: "TV",
          AND: [
            { episodes: { some: { progress: { some: progressActivityWhere } } } },
            { episodes: { some: playableEpisodeWithoutCompletedProgress } },
          ],
        },
      ],
    };
  }

  return {
    OR: [
      {
        type: "MOVIE",
        progress: { none: { episodeId: null, ...progressActivityWhere } },
      },
      {
        type: "TV",
        episodes: { none: { progress: { some: progressActivityWhere } } },
      },
    ],
  };
}

export async function getMyListCollection() {
  return db.collection.upsert({
    where: { slug: MY_LIST_SLUG },
    update: {},
    create: { name: "My List", slug: MY_LIST_SLUG },
  });
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
  const [myListItems, progressRows] = await Promise.all([
    db.collectionItem.findMany({
      where: { collectionId: col.id, mediaId: { in: ids } },
    }),
    db.watchProgress.findMany({
      where: { mediaId: { in: ids } },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      include: { episode: true },
    }),
  ]);
  const myListSet = new Set(myListItems.map((i) => i.mediaId));
  const progressByMedia = new Map<string, typeof progressRows>();
  for (const progress of progressRows) {
    const grouped = progressByMedia.get(progress.mediaId) ?? [];
    grouped.push(progress);
    progressByMedia.set(progress.mediaId, grouped);
  }
  // Episode topology is only needed to resolve a TV resume target. Shelves
  // without any progress should not hydrate thousands of unrelated episodes.
  const tvIds = items
    .filter((item) => item.type === "TV" && progressByMedia.has(item.id))
    .map((item) => item.id);
  const episodeRows = tvIds.length
    ? await db.episode.findMany({
        where: { mediaId: { in: tvIds } },
        orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }, { id: "asc" }],
        select: {
          id: true,
          mediaId: true,
          seasonNumber: true,
          episodeNumber: true,
          filePath: true,
          streamUrl: true,
          airDate: true,
        },
      })
    : [];
  const episodesByMedia = new Map<string, typeof episodeRows>();
  for (const episode of episodeRows) {
    const grouped = episodesByMedia.get(episode.mediaId) ?? [];
    grouped.push(episode);
    episodesByMedia.set(episode.mediaId, grouped);
  }
  const progressById = new Map(progressRows.map((progress) => [progress.id, progress]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const progressMap = new Map<string, ProgressInfo>();
  const seenProgressTargets = new Set<string>();
  for (const p of progressRows) {
    const media = itemById.get(p.mediaId);
    if (media?.type === "TV") continue;
    const targetKey = `${p.mediaId}:${p.episodeId ?? "movie"}`;
    if (seenProgressTargets.has(targetKey)) continue;
    seenProgressTargets.add(targetKey);
    if (progressMap.has(p.mediaId) || p.completed || p.position <= 0) continue;

    const hasPlayableTarget =
      media?.type === "MOVIE"
        ? p.episodeId == null && !!(media.filePath || media.streamUrl)
        : !!p.episode && !!(p.episode.filePath || p.episode.streamUrl);
    if (!hasPlayableTarget) continue;

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
  for (const mediaId of tvIds) {
    const decision = resolvePlaybackDecision({
      mediaId,
      episodes: (episodesByMedia.get(mediaId) ?? []).map((episode) => ({
        id: episode.id,
        mediaId: episode.mediaId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        available: Boolean(episode.filePath || episode.streamUrl),
        airDate: episode.airDate,
      })),
      progress: (progressByMedia.get(mediaId) ?? []).map((progress) => ({
        id: progress.id,
        mediaId:
          progress.episode && progress.episode.mediaId !== mediaId
            ? progress.episode.mediaId
            : progress.mediaId,
        episodeId: progress.episodeId,
        position: progress.position,
        duration: progress.duration,
        completed: progress.completed,
        updatedAt: progress.updatedAt,
      })),
    });
    const selected = decision.target?.progressId
      ? progressById.get(decision.target.progressId)
      : undefined;
    if (!selected?.episode || selected.position <= 0 || selected.completed) continue;
    progressMap.set(mediaId, {
      position: selected.position,
      duration: selected.duration,
      episodeId: selected.episodeId,
      episode: {
        seasonNumber: selected.episode.seasonNumber,
        episodeNumber: selected.episode.episodeNumber,
      },
      updatedAt: selected.updatedAt,
    });
  }
  return items.map((m) =>
    toSummary(m, myListSet.has(m.id), progressMap.get(m.id))
  );
}

const mediaInclude = { genres: { include: { genre: true } } } as const;
const searchEpisodeInclude = {
  media: {
    select: {
      id: true,
      title: true,
      posterUrl: true,
      backdropUrl: true,
      year: true,
    },
  },
  progress: { orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 1 },
} satisfies Prisma.EpisodeInclude;

async function getPresetMediaRows(
  preset: BrowsePreset,
  limit: number
): Promise<MediaRow[]> {
  const definition = browsePresetDefinition(preset);
  return db.media.findMany({
    where: locallyAvailable(definition.where),
    orderBy: definition.orderBy,
    take: limit,
    include: mediaInclude,
  });
}

async function getPresetMedia(
  preset: BrowsePreset,
  limit: number
): Promise<MediaSummary[]> {
  return attachSummaryData(await getPresetMediaRows(preset, limit));
}

async function getFeaturedRows(limit = 6): Promise<MediaRow[]> {
  const orderBy: Prisma.MediaOrderByWithRelationInput[] = [
    { featured: "desc" },
    { popularity: "desc" },
    { title: "asc" },
    { id: "asc" },
  ];
  const [movies, shows] = await Promise.all(
    (["MOVIE", "TV"] as const).map((type) =>
      db.media.findMany({
        where: locallyAvailable({
          type,
          OR: [{ featured: true }, { backdropUrl: { not: null } }],
        }),
        orderBy,
        take: limit * 2,
        include: mediaInclude,
      })
    )
  );

  const compareRank = (a: MediaRow, b: MediaRow) =>
    Number(b.featured) - Number(a.featured) ||
    b.popularity - a.popularity ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id);
  const interleave = (left: MediaRow[], right: MediaRow[]) => {
    const result: MediaRow[] = [];
    let leftIndex = 0;
    let rightIndex = 0;
    let useLeft = !right[0] || (!!left[0] && compareRank(left[0], right[0]) <= 0);
    while (leftIndex < left.length || rightIndex < right.length) {
      if ((useLeft && leftIndex < left.length) || rightIndex >= right.length) {
        result.push(left[leftIndex++]);
      } else {
        result.push(right[rightIndex++]);
      }
      useLeft = !useLeft;
    }
    return result;
  };

  // Explicit editorial picks remain ahead of artwork fallbacks. Within each
  // tier, alternate movies and series so the feature deck represents both
  // halves of a mixed library without randomising on every Home refresh.
  const items = [
    ...interleave(
      movies.filter((item) => item.featured),
      shows.filter((item) => item.featured)
    ),
    ...interleave(
      movies.filter((item) => !item.featured),
      shows.filter((item) => !item.featured)
    ),
  ].slice(0, limit);
  return items;
}

export async function getFeatured(limit = 6): Promise<MediaSummary[]> {
  return attachSummaryData(await getFeaturedRows(limit));
}

export async function getTrending(limit = 20): Promise<MediaSummary[]> {
  return getPresetMedia("trending", limit);
}

export async function getPopularMovies(limit = 20): Promise<MediaSummary[]> {
  return getPresetMedia("popular-movies", limit);
}

export async function getPopularTV(limit = 20): Promise<MediaSummary[]> {
  return getPresetMedia("popular-tv", limit);
}

export async function getTopRated(limit = 20): Promise<MediaSummary[]> {
  return getPresetMedia("top-rated", limit);
}

export async function getNewReleases(limit = 20): Promise<MediaSummary[]> {
  return getPresetMedia("new-releases", limit);
}

export async function getByGenre(
  genre: string,
  limit = 20
): Promise<MediaSummary[]> {
  const items = await db.media.findMany({
    where: locallyAvailable({ genres: { some: { genre: { name: genre } } } }),
    orderBy: [{ popularity: "desc" }, { title: "asc" }, { id: "asc" }],
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
  return getPresetMedia("recently-added-movies", limit);
}

/**
 * Recently added EPISODES — newest episodes by filesystem timestamp, collapsed to
 * their parent show so we don't show the same show 5 times. The latest
 * episode is display context only; show-level Play still uses the canonical
 * playback selector.
 */
async function getRecentlyAddedEpisodeRows(limit = 20) {
  // Fetch the newest episodes, grouped by show
  const episodes = await db.episode.findMany({
    where: playableEpisodeWhere,
    orderBy: [{ sourceModifiedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
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
  return picked;
}

function summariesWithEpisodeContext(
  picked: Awaited<ReturnType<typeof getRecentlyAddedEpisodeRows>>,
  summaryById: Map<string, MediaSummary>
) {
  return picked.flatMap((episode) => {
    const summary = summaryById.get(episode.mediaId);
    return summary
      ? [{
          ...summary,
          contextEpisodeId: episode.id,
          contextSeason: episode.seasonNumber,
          contextEpisode: episode.episodeNumber,
          contextEpisodeTitle: episode.title,
        }]
      : [];
  });
}

export async function getRecentlyAddedEpisodes(limit = 20): Promise<MediaSummary[]> {
  const picked = await getRecentlyAddedEpisodeRows(limit);
  if (picked.length === 0) return [];
  const summaries = await attachSummaryData(picked.map((episode) => episode.media));
  return summariesWithEpisodeContext(
    picked,
    new Map(summaries.map((summary) => [summary.id, summary]))
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
    where: {
      completed: false,
      hiddenFromContinueWatching: false,
      position: { gt: 0 },
      OR: [
        {
          episodeId: null,
          media: {
            type: "MOVIE",
            OR: [{ filePath: { not: null } }, { streamUrl: { not: null } }],
          },
        },
        { episode: { is: playableEpisodeWhere } },
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: limit * 3,
    include: { media: { include: mediaInclude }, episode: true },
  });
  const targetKey = (mediaId: string, episodeId: string | null) =>
    `${mediaId}:${episodeId ?? "movie"}`;
  const progressTargetClauses: Prisma.WatchProgressWhereInput[] = [
    ...new Map(
      inProgressRows.map((row) => [
        targetKey(row.mediaId, row.episodeId),
        { mediaId: row.mediaId, episodeId: row.episodeId },
      ])
    ).values(),
  ];
  const effectiveTargetRows = progressTargetClauses.length
    ? await db.watchProgress.findMany({
        where: { OR: progressTargetClauses },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      })
    : [];
  const effectiveTargetByKey = new Map<string, typeof effectiveTargetRows[number]>();
  for (const row of effectiveTargetRows) {
    const key = targetKey(row.mediaId, row.episodeId);
    if (!effectiveTargetByKey.has(key)) effectiveTargetByKey.set(key, row);
  }
  const seen = new Set<string>();
  const candidates: ContinueWatchingCandidate[] = [];

  for (const r of inProgressRows) {
    if (r.episode && r.episode.mediaId !== r.mediaId) continue;
    const effective = effectiveTargetByKey.get(targetKey(r.mediaId, r.episodeId));
    if (
      !effective ||
      effective.id !== r.id ||
      effective.completed ||
      effective.hiddenFromContinueWatching ||
      effective.position <= 0
    ) continue;
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
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: limit * 6,
      include: {
        episode: true,
        media: {
          include: {
            genres: { include: { genre: true } },
            episodes: {
              orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
              // The selector must see every row for a target so a newer
              // reset/incomplete duplicate can supersede older completion
              // history deterministically.
              include: {
                progress: {
                  orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
                },
              },
            },
          },
        },
      },
    });

    for (const watched of watchedEpisodeRows) {
      if (
        !watched.episode ||
        watched.episode.mediaId !== watched.mediaId ||
        seen.has(watched.mediaId) ||
        dismissedMediaIds.has(watched.mediaId)
      ) continue;
      const show = watched.media;

      const playbackDecision = resolvePlaybackDecision({
        mediaId: show.id,
        episodes: show.episodes.map((episode) => ({
          id: episode.id,
          mediaId: episode.mediaId,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          available: Boolean(episode.filePath || episode.streamUrl),
          airDate: episode.airDate,
        })),
        progress: show.episodes.flatMap((episode) =>
          episode.progress.map((progress) => ({
            id: progress.id,
            mediaId: progress.mediaId,
            episodeId: progress.episodeId,
            position: progress.position,
            duration: progress.duration,
            completed: progress.completed,
            updatedAt: progress.updatedAt,
          }))
        ),
      });
      if (
        playbackDecision.reason !== "first-unwatched-regular" &&
        playbackDecision.reason !== "first-unwatched-special"
      ) continue;
      const nextEpisode = show.episodes.find(
        (episode) => episode.id === playbackDecision.target?.episodeId
      );
      if (!nextEpisode) continue;

      const now = Date.now();
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
  const [featuredRows, continueWatching, recentEpisodeRows, recentlyAddedMovieRows, trendingRows, popularMovieRows, popularTVRows, topRatedRows, newReleaseRows] =
    await Promise.all([
      getFeaturedRows(6),
      getContinueWatching(12),
      getRecentlyAddedEpisodeRows(20),
      getPresetMediaRows("recently-added-movies", 20),
      getPresetMediaRows("trending", 20),
      getPresetMediaRows("popular-movies", 20),
      getPresetMediaRows("popular-tv", 20),
      getPresetMediaRows("top-rated", 20),
      getPresetMediaRows("new-releases", 20),
    ]);

  const summaryRows = [
    ...featuredRows,
    ...recentEpisodeRows.map((episode) => episode.media),
    ...recentlyAddedMovieRows,
    ...trendingRows,
    ...popularMovieRows,
    ...popularTVRows,
    ...topRatedRows,
    ...newReleaseRows,
  ];
  const uniqueSummaryRows = [...new Map(summaryRows.map((item) => [item.id, item])).values()];
  const summaries = await attachSummaryData(uniqueSummaryRows);
  const summaryById = new Map(summaries.map((summary) => [summary.id, summary]));
  const summarize = (items: MediaRow[]) =>
    items.flatMap((item) => {
      const summary = summaryById.get(item.id);
      return summary ? [summary] : [];
    });

  const featured = summarize(featuredRows);
  const recentlyAddedEpisodes = summariesWithEpisodeContext(recentEpisodeRows, summaryById);
  const recentlyAddedMovies = summarize(recentlyAddedMovieRows);
  const trending = summarize(trendingRows);
  const popularMovies = summarize(popularMovieRows);
  const popularTV = summarize(popularTVRows);
  const topRated = summarize(topRatedRows);
  const newReleases = summarize(newReleaseRows);

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
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: { episode: true },
  });
  const playableEpisodeRows = media.episodes.filter((e) => e.filePath || e.streamUrl);
  const episodeRowsForDisplay = media.type === "TV" ? playableEpisodeRows : media.episodes;

  const playbackDecision = media.type === "TV"
    ? resolvePlaybackDecision({
        mediaId: media.id,
        episodes: media.episodes.map((episode) => ({
          id: episode.id,
          mediaId: episode.mediaId,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          available: Boolean(episode.filePath || episode.streamUrl),
          airDate: episode.airDate,
        })),
        progress: progressRows.map((progress) => ({
          id: progress.id,
          mediaId: progress.mediaId,
          episodeId: progress.episodeId,
          position: progress.position,
          duration: progress.duration,
          completed: progress.completed,
          updatedAt: progress.updatedAt,
        })),
      })
    : undefined;

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

  const targetSeason =
    season ?? seasons.find((candidate) => candidate.seasonNumber > 0)?.seasonNumber ??
    seasons[0]?.seasonNumber ?? 1;
  const seasonEpisodes = episodeRowsForDisplay.filter((e) => e.seasonNumber === targetSeason);

  const epProgressMap = new Map<string, typeof progressRows[number]>();
  for (const progress of progressRows) {
    if (
      !progress.episodeId ||
      progress.episode?.mediaId !== media.id ||
      epProgressMap.has(progress.episodeId)
    ) continue;
    epProgressMap.set(progress.episodeId, progress);
  }
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
  const playbackEpisodeRows = [...playableEpisodeRows].sort(
    (a, b) =>
      Number(a.seasonNumber === 0) - Number(b.seasonNumber === 0) ||
      a.seasonNumber - b.seasonNumber ||
      a.episodeNumber - b.episodeNumber ||
      a.id.localeCompare(b.id)
  );
  const playableEpisodes = playbackEpisodeRows.map(serializeEpisode);

  const playbackEpisodeId = playbackDecision?.target?.episodeId;
  const nextEpisodeRow = playbackEpisodeId
    ? playbackEpisodeRows.find((episode) => episode.id === playbackEpisodeId)
    : null;
  const nextEpisode = nextEpisodeRow ? serializeEpisode(nextEpisodeRow) : null;
  const selectedProgress = playbackDecision?.target?.progressId
    ? progressRows.find((progress) => progress.id === playbackDecision.target?.progressId)
    : media.type === "MOVIE"
      ? (() => {
          const latest = progressRows.find((progress) => progress.episodeId == null);
          return latest && !latest.completed && latest.position > 0 ? latest : undefined;
        })()
      : undefined;

  const summary = toSummary(
    media,
    inMyList,
    selectedProgress
      ? {
          position: selectedProgress.position,
          duration: selectedProgress.duration,
          episodeId: selectedProgress.episodeId,
          episode: selectedProgress.episode
            ? {
                seasonNumber: selectedProgress.episode.seasonNumber,
                episodeNumber: selectedProgress.episode.episodeNumber,
              }
            : null,
          updatedAt: selectedProgress.updatedAt,
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
    playbackDecision,
  };
}

export async function browseMedia(params: {
  type?: MediaType;
  genre?: string;
  category?: string;
  preset?: BrowsePreset;
  watchState?: WatchState;
  sectionId?: string;
  q?: string;
  sort?: BrowseSort | null;
  page?: number;
  pageSize?: number;
  availability?: "available" | "unavailable" | "all";
  metadata?: "matched" | "unmatched" | "all";
}) {
  const {
    type,
    genre,
    category,
    preset,
    watchState = "all",
    sectionId,
    q,
    sort,
    page = 1,
    pageSize = 24,
    availability = "available",
    metadata = "all",
  } = params;
  const where: Prisma.MediaWhereInput = {};
  if (type) where.type = type;
  if (category) where.category = category;
  if (sectionId) where.sectionId = sectionId;
  if (q) where.OR = [{ title: { contains: q } }, { filePath: { contains: q } }];
  if (genre) where.genres = { some: { genre: { name: genre } } };
  if (metadata === "matched") where.tmdbId = { not: null };
  if (metadata === "unmatched") where.tmdbId = null;

  const presetDefinition = preset ? browsePresetDefinition(preset) : null;
  const filteredWhere: Prisma.MediaWhereInput = {
    AND: [where, presetDefinition?.where ?? {}, watchStateWhere(watchState)],
  };
  const orderBy = sort
    ? browseSortOrder(sort)
    : presetDefinition?.orderBy ?? browseSortOrder("popular");

  const visibleWhere: Prisma.MediaWhereInput =
    availability === "all"
      ? filteredWhere
      : availability === "unavailable"
        ? { AND: [filteredWhere, { NOT: playableMediaWhere }] }
        : locallyAvailable(filteredWhere);
  const [total, items] = await Promise.all([
    db.media.count({ where: visibleWhere }),
    db.media.findMany({
      where: visibleWhere,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: mediaInclude,
    }),
  ]);
  const summaries = await attachSummaryData(items);
  const availableIds = items.length
    ? new Set(
        (
          await db.media.findMany({
            where: { AND: [{ id: { in: items.map((item) => item.id) } }, playableMediaWhere] },
            select: { id: true },
          })
        ).map((item) => item.id)
      )
    : new Set<string>();
  const inventoryItems = summaries.map((summary, index) => ({
    ...summary,
    available: availableIds.has(summary.id),
    metadataMatched: items[index].tmdbId != null,
    sourcePath: items[index].filePath,
  }));
  const genres = await getAllGenres();
  return { items: inventoryItems, total, page, pageSize, genres };
}

export async function searchMedia(q: string, limit = 10): Promise<SearchResults> {
  const trimmed = q.trim();
  const empty: SearchResults = {
    query: q,
    groups: {
      movies: { items: [], total: 0 },
      shows: { items: [], total: 0 },
      episodes: { items: [], total: 0 },
    },
    total: 0,
  };
  if (!trimmed) return empty;

  const groupLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(50, Math.trunc(limit)))
    : 10;
  const titleMatch = { title: { contains: trimmed } };
  const moviesWhere = locallyAvailable({ type: "MOVIE", ...titleMatch });
  const showsWhere = locallyAvailable({ type: "TV", ...titleMatch });
  const playableEpisodeWhere: Prisma.EpisodeWhereInput = {
    OR: [{ filePath: { not: null } }, { streamUrl: { not: null } }],
  };
  const episodeTitleWhere: Prisma.EpisodeWhereInput = {
    AND: [titleMatch, playableEpisodeWhere],
  };
  const parentShowEpisodeWhere: Prisma.EpisodeWhereInput = {
    AND: [
      { NOT: titleMatch },
      { media: { title: { contains: trimmed } } },
      playableEpisodeWhere,
    ],
  };
  const episodesWhere: Prisma.EpisodeWhereInput = {
    OR: [episodeTitleWhere, parentShowEpisodeWhere],
  };

  const [movieTotal, showTotal, episodeTotal, movies, shows, titleEpisodes] =
    await Promise.all([
      db.media.count({ where: moviesWhere }),
      db.media.count({ where: showsWhere }),
      db.episode.count({ where: episodesWhere }),
      db.media.findMany({
        where: moviesWhere,
        take: groupLimit,
        orderBy: [{ popularity: "desc" }, { title: "asc" }],
        include: mediaInclude,
      }),
      db.media.findMany({
        where: showsWhere,
        take: groupLimit,
        orderBy: [{ popularity: "desc" }, { title: "asc" }],
        include: mediaInclude,
      }),
      db.episode.findMany({
        where: episodeTitleWhere,
        take: groupLimit,
        orderBy: [
          { title: "asc" },
          { media: { popularity: "desc" } },
          { media: { title: "asc" } },
          { seasonNumber: "asc" },
          { episodeNumber: "asc" },
        ],
        include: searchEpisodeInclude,
      }),
    ]);

  const parentEpisodes =
    titleEpisodes.length < groupLimit
      ? await db.episode.findMany({
          where: parentShowEpisodeWhere,
          take: groupLimit - titleEpisodes.length,
          orderBy: [
            { media: { popularity: "desc" } },
            { media: { title: "asc" } },
            { seasonNumber: "asc" },
            { episodeNumber: "asc" },
          ],
          include: searchEpisodeInclude,
        })
      : [];
  const episodes = [...titleEpisodes, ...parentEpisodes];

  const mediaSummaries = await attachSummaryData([...movies, ...shows]);
  const movieItems = mediaSummaries.slice(0, movies.length);
  const showItems = mediaSummaries.slice(movies.length);
  const episodeItems: SearchEpisodeResult[] = episodes.map((episode) => {
    const progress = episode.progress[0];
    return {
      type: "EPISODE",
      id: episode.id,
      mediaId: episode.mediaId,
      showTitle: episode.media.title,
      title: episode.title,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      stillUrl: episode.stillUrl,
      posterUrl: episode.media.posterUrl,
      backdropUrl: episode.media.backdropUrl,
      overview: episode.overview,
      airDate: episode.airDate?.toISOString() ?? null,
      year: episode.media.year,
      runtime: episode.runtime,
      ...(progress
        ? {
            progressPercent:
              progress.duration > 0
                ? (progress.position / progress.duration) * 100
                : undefined,
            progressPosition: progress.position,
            progressDuration: progress.duration,
          }
        : {}),
      completed: progress?.completed ?? false,
    };
  });

  return {
    query: q,
    groups: {
      movies: { items: movieItems, total: movieTotal },
      shows: { items: showItems, total: showTotal },
      episodes: { items: episodeItems, total: episodeTotal },
    },
    total: movieTotal + showTotal + episodeTotal,
  };
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
    tmdbKeyConfigured: !!(config.tmdbKey || process.env.TMDB_API_KEY),
    plexUrl: config.plexUrl ?? process.env.PLEX_URL ?? process.env.LUMINA_PLEX_URL ?? "",
    plexTokenSaved: !!(config.plexToken || process.env.PLEX_TOKEN || process.env.LUMINA_PLEX_TOKEN),
    plexSyncDirection: (config.plexSyncDirection || "pull") as PlexSyncDirection,
  };
}

export async function getStats(): Promise<LibraryStats> {
  const [mediaCount, movieCount, tvCount, episodeCount, genreCount, config, movieRuntime, epRuntime] =
    await Promise.all([
      db.media.count({ where: playableMediaWhere }),
      db.media.count({ where: locallyAvailable({ type: "MOVIE" }) }),
      db.media.count({ where: locallyAvailable({ type: "TV" }) }),
      db.episode.count({
        where: { OR: [{ filePath: { not: null } }, { streamUrl: { not: null } }] },
      }),
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
    tmdbKeyConfigured: !!(config?.tmdbKey || process.env.TMDB_API_KEY),
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
  await assertProgressTargetOwnership(mediaId, episodeId);
  const where = episodeId ? { mediaId, episodeId } : { mediaId, episodeId: null };
  await db.watchProgress.updateMany({
    where: { mediaId, hiddenFromContinueWatching: true },
    data: { hiddenFromContinueWatching: false },
  });
  const existing = await db.watchProgress.findFirst({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
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

export class InvalidProgressTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProgressTargetError";
  }
}

async function assertProgressTargetOwnership(
  mediaId: string,
  episodeId: string | null
) {
  if (!episodeId) return;
  const episode = await db.episode.findFirst({
    where: { id: episodeId, mediaId },
    select: { id: true },
  });
  if (!episode) {
    throw new InvalidProgressTargetError(
      "Episode does not belong to the requested media item."
    );
  }
}

export async function dismissContinueWatching(input: {
  mediaId: string;
  episodeId?: string | null;
  duration?: number;
}) {
  const { mediaId, episodeId = null, duration = 0 } = input;
  await assertProgressTargetOwnership(mediaId, episodeId);
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
    include: {
      _count: {
        select: { media: { where: playableMediaWhere } },
      },
    },
  });
  return sections.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type as MediaType,
    category: s.category,
    mediaDir: s.mediaDir,
    tmdbKeyConfigured: !!s.tmdbKey,
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
    tmdbKeyConfigured: !!s.tmdbKey,
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
