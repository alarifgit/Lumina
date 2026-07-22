type PlaybackTimelineInput = {
  transcoded: boolean;
  timelineOffset: number;
  currentTime: number;
  mediaDuration: number;
  probeDuration?: number | null;
  runtimeMinutes?: number | null;
};

type PlaybackOffsetInput = {
  resumeOverride: number | null;
  serverResumeAt: number;
  timelineOffset: number;
};

type AutoTranscodeStartInput = {
  currentTime: number;
  serverResumeAt: number;
};

function positiveFinite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Generic TV playback receives its canonical resume point after the detail
 * request resolves. Keep a transcode anchored to that server-selected point
 * until an explicit seek or quality change takes ownership of the timeline.
 */
export function resolvePlaybackOffset(input: PlaybackOffsetInput) {
  return input.resumeOverride == null
    ? positiveFinite(input.serverResumeAt)
    : positiveFinite(input.timelineOffset);
}

/** Capture the furthest known absolute clock before a late probe changes source. */
export function resolveAutoTranscodeStart(input: AutoTranscodeStartInput) {
  return Math.max(
    positiveFinite(input.currentTime),
    positiveFinite(input.serverResumeAt)
  );
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
