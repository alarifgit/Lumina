import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function completenessScore(media) {
  return (
    (media.filePath || media.streamUrl ? 100 : 0) +
    media.episodes.filter((episode) => episode.filePath || episode.streamUrl).length * 10 +
    (media.posterUrl ? 5 : 0) +
    (media.overview ? 3 : 0) +
    (media.title ? 1 : 0)
  );
}

async function mergeMediaRows(sourceId, targetId) {
  await db.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.media.findUnique({
        where: { id: sourceId },
        include: { episodes: true, genres: true, collections: true },
      }),
      tx.media.findUnique({
        where: { id: targetId },
        include: { episodes: true },
      }),
    ]);
    if (!source || !target) return;

    await tx.media.update({
      where: { id: target.id },
      data: {
        title: target.title || source.title,
        sortTitle: target.sortTitle ?? source.sortTitle,
        filePath: target.filePath ?? source.filePath,
        streamUrl: target.streamUrl ?? source.streamUrl,
        sourceCreatedAt: target.sourceCreatedAt ?? source.sourceCreatedAt,
        sourceModifiedAt: target.sourceModifiedAt ?? source.sourceModifiedAt,
        imdbId: target.imdbId ?? source.imdbId,
        overview: target.overview ?? source.overview,
        tagline: target.tagline ?? source.tagline,
        posterUrl: target.posterUrl ?? source.posterUrl,
        backdropUrl: target.backdropUrl ?? source.backdropUrl,
        releaseDate: target.releaseDate ?? source.releaseDate,
        year: target.year ?? source.year,
        runtime: target.runtime ?? source.runtime,
        rating: target.rating ?? source.rating,
        voteCount: target.voteCount ?? source.voteCount,
        status: target.status ?? source.status,
        certification: target.certification ?? source.certification,
        sectionId: target.sectionId ?? source.sectionId,
        featured: target.featured || source.featured,
        trending: target.trending || source.trending,
        popularity: Math.max(target.popularity, source.popularity),
      },
    });

    for (const sourceEpisode of source.episodes) {
      const targetEpisode = target.episodes.find(
        (episode) =>
          episode.seasonNumber === sourceEpisode.seasonNumber &&
          episode.episodeNumber === sourceEpisode.episodeNumber
      );
      if (!targetEpisode) {
        await tx.episode.update({
          where: { id: sourceEpisode.id },
          data: { mediaId: target.id },
        });
        await tx.watchProgress.updateMany({
          where: { episodeId: sourceEpisode.id },
          data: { mediaId: target.id },
        });
        await tx.subtitle.updateMany({
          where: { episodeId: sourceEpisode.id },
          data: { mediaId: target.id },
        });
        continue;
      }

      await tx.episode.update({
        where: { id: targetEpisode.id },
        data: {
          title: targetEpisode.title || sourceEpisode.title,
          filePath: targetEpisode.filePath ?? sourceEpisode.filePath,
          streamUrl: targetEpisode.streamUrl ?? sourceEpisode.streamUrl,
          sourceCreatedAt: targetEpisode.sourceCreatedAt ?? sourceEpisode.sourceCreatedAt,
          sourceModifiedAt: targetEpisode.sourceModifiedAt ?? sourceEpisode.sourceModifiedAt,
          overview: targetEpisode.overview ?? sourceEpisode.overview,
          stillUrl: targetEpisode.stillUrl ?? sourceEpisode.stillUrl,
          airDate: targetEpisode.airDate ?? sourceEpisode.airDate,
          runtime: targetEpisode.runtime ?? sourceEpisode.runtime,
        },
      });
      await tx.watchProgress.updateMany({
        where: { episodeId: sourceEpisode.id },
        data: { mediaId: target.id, episodeId: targetEpisode.id },
      });
      await tx.subtitle.updateMany({
        where: { episodeId: sourceEpisode.id },
        data: { mediaId: target.id, episodeId: targetEpisode.id },
      });
      await tx.episode.delete({ where: { id: sourceEpisode.id } });
    }

    await tx.watchProgress.updateMany({
      where: { mediaId: source.id, episodeId: null },
      data: { mediaId: target.id },
    });
    await tx.subtitle.updateMany({
      where: { mediaId: source.id, episodeId: null },
      data: { mediaId: target.id },
    });

    for (const genre of source.genres) {
      const existing = await tx.mediaGenre.findUnique({
        where: { mediaId_genreId: { mediaId: target.id, genreId: genre.genreId } },
      });
      if (existing) {
        await tx.mediaGenre.delete({
          where: { mediaId_genreId: { mediaId: source.id, genreId: genre.genreId } },
        });
      } else {
        await tx.mediaGenre.update({
          where: { mediaId_genreId: { mediaId: source.id, genreId: genre.genreId } },
          data: { mediaId: target.id },
        });
      }
    }

    for (const item of source.collections) {
      const existing = await tx.collectionItem.findUnique({
        where: {
          collectionId_mediaId: { collectionId: item.collectionId, mediaId: target.id },
        },
      });
      if (existing) {
        await tx.collectionItem.delete({ where: { id: item.id } });
      } else {
        await tx.collectionItem.update({
          where: { id: item.id },
          data: { mediaId: target.id },
        });
      }
    }

    await tx.media.delete({ where: { id: source.id } });
  }, { maxWait: 10_000, timeout: 120_000 });
}

try {
  const mediaTables = await db.$queryRawUnsafe(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Media'
  `);
  const duplicateKeys = mediaTables.length
    ? await db.$queryRawUnsafe(`
        SELECT type, tmdbId
        FROM Media
        WHERE tmdbId IS NOT NULL
        GROUP BY type, tmdbId
        HAVING COUNT(*) > 1
      `)
    : [];

  for (const key of duplicateKeys) {
    const rows = await db.media.findMany({
      where: { type: key.type, tmdbId: Number(key.tmdbId) },
      include: { episodes: true },
    });
    rows.sort((a, b) => completenessScore(b) - completenessScore(a));
    const [target, ...sources] = rows;
    if (!target) continue;

    console.log(
      `[Lumina] Merging ${sources.length} duplicate ${key.type} row(s) for TMDB ${key.tmdbId}.`
    );
    for (const source of sources) {
      await mergeMediaRows(source.id, target.id);
    }
  }

  if (mediaTables.length) {
    await db.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "Media_type_tmdbId_key"
      ON "Media"("type", "tmdbId")
    `);
  }
} finally {
  await db.$disconnect();
}
