import { db } from "@/lib/db";
import { resolvePlaybackDecision } from "@/lib/playback-selection";
import type { PlaybackDecision } from "@/lib/playback-selection";

export interface PlaybackDecisionAudit {
  media: { id: string; type: "TV"; title: string };
  decision: PlaybackDecision;
}

export class UnsupportedPlaybackAuditError extends Error {}

export async function getPlaybackDecisionAudit(
  mediaId: string,
  episodeId?: string
): Promise<PlaybackDecisionAudit | null> {
  const media = await db.media.findUnique({
    where: { id: mediaId },
    select: {
      id: true,
      type: true,
      title: true,
      episodes: {
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
      },
    },
  });
  if (!media) return null;
  if (media.type !== "TV") {
    throw new UnsupportedPlaybackAuditError(
      "Playback selection diagnostics currently apply to TV shows only."
    );
  }

  const progress = await db.watchProgress.findMany({
    where: { mediaId },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: { episode: { select: { mediaId: true } } },
  });

  const decision = resolvePlaybackDecision({
    mediaId,
    intent: episodeId ? { kind: "episode", episodeId } : { kind: "show" },
    episodes: media.episodes.map((episode) => ({
      id: episode.id,
      mediaId: episode.mediaId,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      available: Boolean(episode.filePath || episode.streamUrl),
      airDate: episode.airDate,
    })),
    progress: progress.map((row) => ({
      id: row.id,
      mediaId:
        row.episode && row.episode.mediaId !== mediaId ? row.episode.mediaId : row.mediaId,
      episodeId: row.episodeId,
      position: row.position,
      duration: row.duration,
      completed: row.completed,
      updatedAt: row.updatedAt,
    })),
  });
  return {
    media: { id: media.id, type: media.type, title: media.title },
    decision,
  };
}
