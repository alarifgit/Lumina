export type PlaybackSelectionIntent =
  | { kind: "show" }
  | { kind: "episode"; episodeId: string };

export interface PlaybackEpisodeCandidate {
  id: string;
  /** Optional ownership evidence for diagnostics when callers already have it. */
  mediaId?: string | null;
  seasonNumber: number;
  episodeNumber: number;
  available: boolean;
  airDate?: Date | string | number | null;
}

export interface PlaybackProgressCandidate {
  id: string;
  mediaId?: string | null;
  episodeId: string | null;
  position: number;
  duration: number;
  completed: boolean;
  updatedAt: Date | string | number;
}

export interface PlaybackSelectionInput {
  mediaId: string;
  intent?: PlaybackSelectionIntent;
  episodes: PlaybackEpisodeCandidate[];
  progress: PlaybackProgressCandidate[];
  /** Injectable clock for deterministic tests. */
  now?: Date | number;
}

export type PlaybackSelectionReason =
  | "explicit-episode"
  | "resume-canonical-episode"
  | "first-unwatched-regular"
  | "first-unwatched-special"
  | "restart-first-regular"
  | "restart-first-special"
  | "explicit-episode-not-found"
  | "explicit-episode-unavailable"
  | "no-playable-episode";

export type PlaybackSelectionWarningCode =
  | "duplicate-progress-target"
  | "multiple-in-progress"
  | "noncanonical-progress-ignored"
  | "progress-media-mismatch"
  | "progress-target-missing"
  | "progress-target-unavailable"
  | "episode-media-mismatch"
  | "missing-series-premiere"
  | "future-local-episode"
  | "no-playable-episodes";

export interface PlaybackSelectionWarning {
  code: PlaybackSelectionWarningCode;
  message: string;
  episodeId?: string;
  count?: number;
}

export interface PlaybackSelectionTarget {
  episodeId: string;
  seasonNumber: number;
  episodeNumber: number;
  startAt: number;
  progressId: string | null;
}

export interface PlaybackSelectionCounts {
  episodes: number;
  playableEpisodes: number;
  unavailableEpisodes: number;
  regularEpisodes: number;
  specials: number;
  futureEpisodes: number;
  progressRows: number;
  effectiveProgressTargets: number;
  inProgressEpisodes: number;
  completedEpisodes: number;
  unwatchedRegularEpisodes: number;
  unwatchedSpecials: number;
}

export interface PlaybackSelectionTraceEntry {
  rule:
    | "explicit"
    | "canonical-unwatched-regular"
    | "canonical-unwatched-special"
    | "restart-regular"
    | "restart-special";
  outcome: "not-applicable" | "none" | "selected" | "rejected";
  candidateCount?: number;
  selectedEpisodeId?: string;
}

export interface PlaybackSelectionDecision {
  selectorVersion: 1;
  mediaId: string;
  intent: PlaybackSelectionIntent;
  target: PlaybackSelectionTarget | null;
  reason: PlaybackSelectionReason;
  counts: PlaybackSelectionCounts;
  warnings: PlaybackSelectionWarning[];
  trace: PlaybackSelectionTraceEntry[];
}

/** Concise alias for API and shared media-detail contracts. */
export type PlaybackDecision = PlaybackSelectionDecision;

type NormalizedEpisode = PlaybackEpisodeCandidate & {
  progress: PlaybackProgressCandidate | null;
  future: boolean;
};

function numericTime(value: Date | string | number): number {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function safePosition(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function compareEpisodes(a: PlaybackEpisodeCandidate, b: PlaybackEpisodeCandidate): number {
  return (
    a.seasonNumber - b.seasonNumber ||
    a.episodeNumber - b.episodeNumber ||
    a.id.localeCompare(b.id)
  );
}

function isInProgress(progress: PlaybackProgressCandidate | null): boolean {
  return !!progress && !progress.completed && safePosition(progress.position) > 0;
}

function targetFor(
  episode: NormalizedEpisode,
  resume: boolean,
): PlaybackSelectionTarget {
  return {
    episodeId: episode.id,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    startAt: resume ? safePosition(episode.progress?.position ?? 0) : 0,
    progressId: resume ? episode.progress?.id ?? null : null,
  };
}

/**
 * Resolve one deterministic episode for a show-level or explicit episode play
 * request. This function is deliberately pure: callers provide indexed
 * availability and progress, and no filesystem or database work happens here.
 */
export function resolvePlaybackDecision(
  input: PlaybackSelectionInput,
): PlaybackSelectionDecision {
  const intent = input.intent ?? { kind: "show" as const };
  const warnings: PlaybackSelectionWarning[] = [];
  const trace: PlaybackSelectionTraceEntry[] = [];
  const now = input.now instanceof Date
    ? input.now.getTime()
    : typeof input.now === "number"
      ? input.now
      : Date.now();

  const ownedEpisodes = input.episodes
    .filter((episode) => {
      if (episode.mediaId == null || episode.mediaId === input.mediaId) return true;
      warnings.push({
        code: "episode-media-mismatch",
        episodeId: episode.id,
        message: `Episode ${episode.id} belongs to another media row and was ignored.`,
      });
      return false;
    })
    .sort(compareEpisodes);
  const episodeById = new Map(ownedEpisodes.map((episode) => [episode.id, episode]));

  const ownedProgress = input.progress.filter((progress) => {
    if (progress.mediaId == null || progress.mediaId === input.mediaId) return true;
    warnings.push({
      code: "progress-media-mismatch",
      episodeId: progress.episodeId ?? undefined,
      message: `Progress row ${progress.id} belongs to another media row and was ignored.`,
    });
    return false;
  });
  const progressByEpisode = new Map<string, PlaybackProgressCandidate[]>();
  for (const progress of ownedProgress) {
    if (!progress.episodeId) continue;
    const episode = episodeById.get(progress.episodeId);
    if (!episode) {
      warnings.push({
        code: "progress-target-missing",
        episodeId: progress.episodeId,
        message: `Progress row ${progress.id} targets an episode that is not part of this show.`,
      });
      continue;
    }
    if (!episode.available) {
      warnings.push({
        code: "progress-target-unavailable",
        episodeId: episode.id,
        message: `Progress targets unavailable S${episode.seasonNumber}E${episode.episodeNumber}.`,
      });
    }
    const rows = progressByEpisode.get(progress.episodeId) ?? [];
    rows.push(progress);
    progressByEpisode.set(progress.episodeId, rows);
  }

  const effectiveProgress = new Map<string, PlaybackProgressCandidate>();
  for (const [episodeId, rows] of progressByEpisode) {
    rows.sort((a, b) => numericTime(b.updatedAt) - numericTime(a.updatedAt) || a.id.localeCompare(b.id));
    effectiveProgress.set(episodeId, rows[0]);
    if (rows.length > 1) {
      warnings.push({
        code: "duplicate-progress-target",
        episodeId,
        count: rows.length,
        message: `${rows.length} progress rows target episode ${episodeId}; the latest row was used.`,
      });
    }
  }

  const episodes: NormalizedEpisode[] = ownedEpisodes.map((episode) => ({
    ...episode,
    progress: effectiveProgress.get(episode.id) ?? null,
    future:
      episode.airDate != null &&
      Number.isFinite(numericTime(episode.airDate)) &&
      numericTime(episode.airDate) > now,
  }));
  const playable = episodes.filter((episode) => episode.available);
  const playableRegular = playable.filter((episode) => episode.seasonNumber > 0);
  const playableSpecials = playable.filter((episode) => episode.seasonNumber === 0);
  const future = playable.filter((episode) => episode.future);
  // A local source remains authoritative even when imported metadata carries
  // a future air date. Surface the anomaly, but never turn a playable local
  // file into a black player or demote a regular episode behind Specials.
  const regular = playableRegular;
  const specials = playableSpecials;
  const unwatchedRegular = regular.filter((episode) => !episode.progress?.completed);
  const unwatchedSpecials = specials.filter((episode) => !episode.progress?.completed);
  const inProgress = playable.filter((episode) => isInProgress(episode.progress));
  const completed = playable.filter((episode) => episode.progress?.completed);

  if (future.length > 0) {
    warnings.push({
      code: "future-local-episode",
      count: future.length,
      message: `${future.length} locally playable episode${future.length === 1 ? " has" : "s have"} a future air date; local availability remains authoritative.`,
    });
  }
  if (inProgress.length > 1) {
    warnings.push({
      code: "multiple-in-progress",
      count: inProgress.length,
      message: `${inProgress.length} episodes have resumable progress; canonical episode order decides which may resume.`,
    });
  }
  const firstIndexedRegular = playableRegular[0];
  if (
    firstIndexedRegular &&
    (firstIndexedRegular.seasonNumber !== 1 || firstIndexedRegular.episodeNumber !== 1)
  ) {
    warnings.push({
      code: "missing-series-premiere",
      episodeId: firstIndexedRegular.id,
      message: `The earliest playable regular episode is S${firstIndexedRegular.seasonNumber}E${firstIndexedRegular.episodeNumber}, not S1E1.`,
    });
  }
  if (playable.length === 0) {
    warnings.push({
      code: "no-playable-episodes",
      message: "The show has no indexed playable episodes.",
    });
  }

  const counts: PlaybackSelectionCounts = {
    episodes: ownedEpisodes.length,
    playableEpisodes: playable.length,
    unavailableEpisodes: ownedEpisodes.length - playable.length,
    regularEpisodes: playableRegular.length,
    specials: playableSpecials.length,
    futureEpisodes: future.length,
    progressRows: ownedProgress.filter((progress) => progress.episodeId != null).length,
    effectiveProgressTargets: effectiveProgress.size,
    inProgressEpisodes: inProgress.length,
    completedEpisodes: completed.length,
    unwatchedRegularEpisodes: unwatchedRegular.length,
    unwatchedSpecials: unwatchedSpecials.length,
  };

  const finish = (
    target: PlaybackSelectionTarget | null,
    reason: PlaybackSelectionReason,
  ): PlaybackSelectionDecision => ({
    selectorVersion: 1,
    mediaId: input.mediaId,
    intent,
    target,
    reason,
    counts,
    warnings,
    trace,
  });

  if (intent.kind === "episode") {
    const explicit = episodes.find((episode) => episode.id === intent.episodeId);
    if (!explicit) {
      trace.push({ rule: "explicit", outcome: "rejected" });
      return finish(null, "explicit-episode-not-found");
    }
    if (!explicit.available) {
      trace.push({
        rule: "explicit",
        outcome: "rejected",
        selectedEpisodeId: explicit.id,
      });
      return finish(null, "explicit-episode-unavailable");
    }
    trace.push({
      rule: "explicit",
      outcome: "selected",
      candidateCount: 1,
      selectedEpisodeId: explicit.id,
    });
    return finish(targetFor(explicit, isInProgress(explicit.progress)), "explicit-episode");
  }

  trace.push({ rule: "explicit", outcome: "not-applicable" });

  const canonicalRegular = unwatchedRegular[0];
  if (canonicalRegular) {
    const laterProgress = inProgress.filter((episode) => episode.id !== canonicalRegular.id);
    if (laterProgress.length > 0) {
      warnings.push({
        code: "noncanonical-progress-ignored",
        episodeId: canonicalRegular.id,
        count: laterProgress.length,
        message: `${laterProgress.length} later in-progress episode${laterProgress.length === 1 ? " was" : "s were"} ignored in favour of earliest unwatched S${canonicalRegular.seasonNumber}E${canonicalRegular.episodeNumber}.`,
      });
    }
    const resume = isInProgress(canonicalRegular.progress);
    trace.push({
      rule: "canonical-unwatched-regular",
      outcome: "selected",
      candidateCount: unwatchedRegular.length,
      selectedEpisodeId: canonicalRegular.id,
    });
    return finish(
      targetFor(canonicalRegular, resume),
      resume ? "resume-canonical-episode" : "first-unwatched-regular",
    );
  }
  trace.push({
    rule: "canonical-unwatched-regular",
    outcome: "none",
    candidateCount: 0,
  });

  if (regular.length > 0) {
    trace.push({
      rule: "restart-regular",
      outcome: "selected",
      candidateCount: regular.length,
      selectedEpisodeId: regular[0].id,
    });
    return finish(targetFor(regular[0], false), "restart-first-regular");
  }
  trace.push({ rule: "restart-regular", outcome: "none", candidateCount: 0 });

  const canonicalSpecial = unwatchedSpecials[0];
  if (canonicalSpecial) {
    const resume = isInProgress(canonicalSpecial.progress);
    trace.push({
      rule: "canonical-unwatched-special",
      outcome: "selected",
      candidateCount: unwatchedSpecials.length,
      selectedEpisodeId: canonicalSpecial.id,
    });
    return finish(
      targetFor(canonicalSpecial, resume),
      resume ? "resume-canonical-episode" : "first-unwatched-special",
    );
  }
  trace.push({
    rule: "canonical-unwatched-special",
    outcome: "none",
    candidateCount: 0,
  });

  if (specials.length > 0) {
    trace.push({
      rule: "restart-special",
      outcome: "selected",
      candidateCount: specials.length,
      selectedEpisodeId: specials[0].id,
    });
    return finish(targetFor(specials[0], false), "restart-first-special");
  }
  trace.push({ rule: "restart-special", outcome: "none", candidateCount: 0 });

  return finish(null, "no-playable-episode");
}
