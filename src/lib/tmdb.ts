import { db } from "@/lib/db";

const TMDB_BASE = "https://api.themoviedb.org/3";
export const TMDB_IMG = "https://image.tmdb.org/t/p";

export const tmdbPoster = (p?: string | null) => (p ? `${TMDB_IMG}/w500${p}` : null);
export const tmdbBackdrop = (p?: string | null) => (p ? `${TMDB_IMG}/w1280${p}` : null);
export const tmdbStill = (p?: string | null) => (p ? `${TMDB_IMG}/w500${p}` : null);
export const tmdbLogo = (p?: string | null) => (p ? `${TMDB_IMG}/w500${p}` : null);

export async function getTmdbKey(): Promise<string | null> {
  const cfg = await db.libraryConfig.findUnique({ where: { id: "default" } });
  return cfg?.tmdbKey || process.env.TMDB_API_KEY || null;
}

interface TmdbOptions {
  [key: string]: string | number | boolean | undefined;
}

async function tmdbFetch<T>(path: string, params: TmdbOptions, key: string): Promise<T> {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TMDB request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

function extractSearchYear(raw: string, fallback?: number) {
  const match = raw.match(/\(?\b(19\d{2}|20\d{2})\b\)?\s*$/);
  return {
    title: raw.replace(/\(?\b(19\d{2}|20\d{2})\b\)?\s*$/, "").replace(/\s+/g, " ").trim(),
    year: fallback ?? (match ? Number(match[1]) : undefined),
  };
}

export interface TmdbMatch {
  tmdbId: number;
  title: string;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  type: "MOVIE" | "TV";
}

export async function searchTmdb(
  title: string,
  type: "MOVIE" | "TV",
  year?: number,
  key?: string
): Promise<TmdbMatch[]> {
  const apiKey = key ?? (await getTmdbKey());
  if (!apiKey) throw new Error("No TMDB API key configured");

  const path = type === "MOVIE" ? "/search/movie" : "/search/tv";
  const parsed = extractSearchYear(title, year);
  const query = parsed.title || title;
  const params: TmdbOptions = { query, include_adult: false };
  if (parsed.year && type === "MOVIE") params.year = parsed.year;
  if (parsed.year && type === "TV") params.first_air_date_year = parsed.year;

  let data = await tmdbFetch<{ results: any[] }>(path, params, apiKey);
  if ((data.results?.length ?? 0) === 0 && parsed.year) {
    data = await tmdbFetch<{ results: any[] }>(path, { query, include_adult: false }, apiKey);
  }
  return data.results
    .filter((r) => r)
    .slice(0, 8)
    .map((r) => ({
      tmdbId: r.id,
      title: r.title || r.name || query,
      year: r.release_date ? new Date(r.release_date).getFullYear() : r.first_air_date ? new Date(r.first_air_date).getFullYear() : null,
      overview: r.overview || null,
      posterUrl: tmdbPoster(r.poster_path),
      type,
    }));
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export async function fetchTmdbMovie(tmdbId: number, key?: string) {
  const apiKey = key ?? (await getTmdbKey());
  if (!apiKey) throw new Error("No TMDB API key configured");
  const data = await tmdbFetch<any>(`/movie/${tmdbId}`, {
    append_to_response: "credits,release_dates,videos",
  }, apiKey);
  const certification = extractCertification(data.release_dates);
  return {
    type: "MOVIE" as const,
    tmdbId: data.id,
    title: data.title,
    overview: data.overview || null,
    tagline: data.tagline || null,
    posterUrl: tmdbPoster(data.poster_path),
    backdropUrl: tmdbBackdrop(data.backdrop_path),
    releaseDate: data.release_date ? new Date(data.release_date) : null,
    year: data.release_date ? new Date(data.release_date).getFullYear() : null,
    runtime: data.runtime || null,
    rating: data.vote_average ? Number(data.vote_average) : null,
    voteCount: data.vote_count || null,
    status: data.status || null,
    certification,
    popularity: data.popularity || 0,
    genres: (data.genres || []).map((g: TmdbGenre) => ({ id: g.id, name: g.name })),
    imdbId: data.imdb_id || null,
  };
}

export async function fetchTmdbTv(tmdbId: number, key?: string, seasonFilter?: number[]) {
  const apiKey = key ?? (await getTmdbKey());
  if (!apiKey) throw new Error("No TMDB API key configured");
  const data = await tmdbFetch<any>(`/tv/${tmdbId}`, {
    append_to_response: "credits,content_ratings,external_ids,videos",
  }, apiKey);
  const certification = extractTvCertification(data.content_ratings);

  const episodes: {
    seasonNumber: number;
    episodeNumber: number;
    title: string;
    overview: string | null;
    stillUrl: string | null;
    airDate: Date | null;
    runtime: number | null;
  }[] = [];
  const wantedSeasons = seasonFilter ? new Set(seasonFilter) : null;
  for (const season of data.seasons || []) {
    if (season.season_number === 0) continue; // skip specials by default
    if (wantedSeasons && !wantedSeasons.has(season.season_number)) continue;
    const seasonData = await tmdbFetch<any>(`/tv/${tmdbId}/season/${season.season_number}`, {}, apiKey);
    for (const ep of seasonData.episodes || []) {
      episodes.push({
        seasonNumber: ep.season_number,
        episodeNumber: ep.episode_number,
        title: ep.name || `Episode ${ep.episode_number}`,
        overview: ep.overview || null,
        stillUrl: tmdbStill(ep.still_path),
        airDate: ep.air_date ? new Date(ep.air_date) : null,
        runtime: ep.runtime || null,
      });
    }
  }

  return {
    type: "TV" as const,
    tmdbId: data.id,
    title: data.name,
    overview: data.overview || null,
    tagline: data.tagline || null,
    posterUrl: tmdbPoster(data.poster_path),
    backdropUrl: tmdbBackdrop(data.backdrop_path),
    releaseDate: data.first_air_date ? new Date(data.first_air_date) : null,
    year: data.first_air_date ? new Date(data.first_air_date).getFullYear() : null,
    runtime: data.episode_run_time?.[0] || null,
    rating: data.vote_average ? Number(data.vote_average) : null,
    voteCount: data.vote_count || null,
    status: data.status || null,
    certification,
    popularity: data.popularity || 0,
    genres: (data.genres || []).map((g: TmdbGenre) => ({ id: g.id, name: g.name })),
    imdbId: data.external_ids?.imdb_id || null,
    seasons: (data.seasons || []).map((s: any) => ({
      seasonNumber: s.season_number,
      name: s.name,
      episodeCount: s.episode_count,
      airDate: s.air_date ? new Date(s.air_date) : null,
      overview: s.overview || null,
    })),
    episodes,
  };
}

function extractCertification(releaseDates: any): string | null {
  try {
    const us = (releaseDates?.results || []).find((r: any) => r.iso_3166_1 === "US");
    const cert = us?.release_dates?.find((r: any) => r.certification);
    return cert?.certification || null;
  } catch {
    return null;
  }
}

function extractTvCertification(contentRatings: any): string | null {
  try {
    const us = (contentRatings?.results || []).find((r: any) => r.iso_3166_1 === "US");
    return us?.rating || null;
  } catch {
    return null;
  }
}

/** Persist fetched TMDB metadata onto an existing Media row. */
export async function applyTmdbMetadata(
  mediaId: string,
  tmdbId: number,
  type: "MOVIE" | "TV",
  key?: string
) {
  const existingMatch = await db.media.findFirst({
    where: { tmdbId, type, id: { not: mediaId } },
  });
  if (existingMatch) {
    await mergeMediaRows(mediaId, existingMatch.id);
    mediaId = existingMatch.id;
  }

  const localTvEpisodes =
    type === "TV"
      ? await db.episode.findMany({
          where: {
            mediaId,
            OR: [{ filePath: { not: null } }, { streamUrl: { not: null } }],
          },
          select: { seasonNumber: true },
        })
      : [];
  const localSeasons = [...new Set(localTvEpisodes.map((episode) => episode.seasonNumber))];
  const data =
    type === "MOVIE"
      ? await fetchTmdbMovie(tmdbId, key)
      : await fetchTmdbTv(tmdbId, key, localSeasons);

  await db.media.update({
    where: { id: mediaId },
    data: {
      tmdbId: data.tmdbId,
      title: data.title,
      overview: data.overview,
      tagline: data.tagline,
      posterUrl: data.posterUrl,
      backdropUrl: data.backdropUrl,
      releaseDate: data.releaseDate,
      year: data.year,
      runtime: data.runtime,
      rating: data.rating,
      voteCount: data.voteCount,
      status: data.status,
      certification: data.certification,
      popularity: data.popularity,
      imdbId: data.imdbId,
      genres: {
        deleteMany: {},
        create: data.genres.map((g) => ({
          genre: {
            connectOrCreate: {
              where: { name: g.name },
              create: { id: g.id, name: g.name },
            },
          },
        })),
      },
    },
  });

  if (type === "TV") {
    // Enrich local episodes with TMDB metadata. Lumina should not create or
    // display remote-only/future episodes that are not present on disk.
    const tv = data as Awaited<ReturnType<typeof fetchTmdbTv>>;
    const existing = await db.episode.findMany({ where: { mediaId } });
    const existingByKey = new Map(
      existing.map((e) => [`${e.seasonNumber}x${e.episodeNumber}`, e])
    );
    // Clean up old TMDB-only rows from earlier builds while preserving local files.
    const tmdbKeys = new Set(tv.episodes.map((e) => `${e.seasonNumber}x${e.episodeNumber}`));
    for (const e of existing) {
      if (!e.filePath && !e.streamUrl) {
        await db.episode.delete({ where: { id: e.id } });
      } else if (!tmdbKeys.has(`${e.seasonNumber}x${e.episodeNumber}`)) {
        await db.episode.delete({ where: { id: e.id } });
      }
    }
    for (const ep of tv.episodes) {
      const existingEp = existingByKey.get(`${ep.seasonNumber}x${ep.episodeNumber}`);
      if (existingEp && (existingEp.filePath || existingEp.streamUrl)) {
        await db.episode.update({
          where: { id: existingEp.id },
          data: {
            title: ep.title,
            overview: ep.overview,
            stillUrl: ep.stillUrl,
            airDate: ep.airDate,
            runtime: ep.runtime,
          },
        });
      }
    }
  }

  return { mediaId };
}

export async function mergeMediaRows(sourceId: string, targetId: string) {
  if (sourceId === targetId) return;

  const [source, target] = await Promise.all([
    db.media.findUnique({
      where: { id: sourceId },
      include: { episodes: true, progress: true, subtitles: true, collections: true },
    }),
    db.media.findUnique({
      where: { id: targetId },
      include: { episodes: true },
    }),
  ]);
  if (!source || !target) return;

  await db.media.update({
    where: { id: target.id },
    data: {
      filePath: target.filePath ?? source.filePath,
      streamUrl: target.streamUrl ?? source.streamUrl,
      sectionId: target.sectionId ?? source.sectionId,
      category: target.category || source.category,
      sortTitle: target.sortTitle ?? source.sortTitle,
      sourceCreatedAt: target.sourceCreatedAt ?? source.sourceCreatedAt,
      sourceModifiedAt: target.sourceModifiedAt ?? source.sourceModifiedAt,
    },
  });

  for (const sourceEpisode of source.episodes) {
    const targetEpisode = target.episodes.find(
      (ep) =>
        ep.seasonNumber === sourceEpisode.seasonNumber &&
        ep.episodeNumber === sourceEpisode.episodeNumber
    );
    if (targetEpisode) {
      await db.episode.update({
        where: { id: targetEpisode.id },
        data: {
          filePath: targetEpisode.filePath ?? sourceEpisode.filePath,
          streamUrl: targetEpisode.streamUrl ?? sourceEpisode.streamUrl,
          sourceCreatedAt: targetEpisode.sourceCreatedAt ?? sourceEpisode.sourceCreatedAt,
          sourceModifiedAt: targetEpisode.sourceModifiedAt ?? sourceEpisode.sourceModifiedAt,
        },
      });
      await db.watchProgress.updateMany({
        where: { episodeId: sourceEpisode.id },
        data: { mediaId: target.id, episodeId: targetEpisode.id },
      });
      await db.subtitle.updateMany({
        where: { episodeId: sourceEpisode.id },
        data: { mediaId: target.id, episodeId: targetEpisode.id },
      });
      await db.episode.delete({ where: { id: sourceEpisode.id } });
    } else {
      await db.episode.update({
        where: { id: sourceEpisode.id },
        data: { mediaId: target.id },
      });
      await db.watchProgress.updateMany({
        where: { episodeId: sourceEpisode.id },
        data: { mediaId: target.id },
      });
      await db.subtitle.updateMany({
        where: { episodeId: sourceEpisode.id },
        data: { mediaId: target.id },
      });
    }
  }

  await db.watchProgress.updateMany({
    where: { mediaId: source.id, episodeId: null },
    data: { mediaId: target.id },
  });
  await db.subtitle.updateMany({
    where: { mediaId: source.id, episodeId: null },
    data: { mediaId: target.id },
  });

  for (const item of source.collections) {
    const exists = await db.collectionItem.findUnique({
      where: {
        collectionId_mediaId: {
          collectionId: item.collectionId,
          mediaId: target.id,
        },
      },
    });
    if (exists) {
      await db.collectionItem.delete({ where: { id: item.id } });
    } else {
      await db.collectionItem.update({
        where: { id: item.id },
        data: { mediaId: target.id },
      });
    }
  }

  await db.media.delete({ where: { id: source.id } });
}
