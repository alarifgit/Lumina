type PlaybackTimelineInput = {
  transcoded: boolean;
  timelineOffset: number;
  currentTime: number;
  mediaDuration: number;
  probeDuration?: number | null;
  runtimeMinutes?: number | null;
};

function positiveFinite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Resolve one absolute playback timeline for direct and segmented transcodes. */
export function resolvePlaybackTimeline(input: PlaybackTimelineInput) {
  const offset = input.transcoded ? positiveFinite(input.timelineOffset) : 0;
  const currentTime = positiveFinite(input.currentTime);
  const rawDuration = positiveFinite(input.mediaDuration);
  const probeDuration = positiveFinite(input.probeDuration);
  const runtimeDuration = positiveFinite(input.runtimeMinutes) * 60;
  const position = offset + currentTime;
  const duration = probeDuration || runtimeDuration || (input.transcoded ? offset + rawDuration : rawDuration);

  return {
    position,
    duration,
    completed: duration > 0 && position / duration > 0.95,
  };
}
