import { spawn } from "child_process";

export interface CodecInfo {
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
  /** true if the browser can play this file directly without transcoding */
  browserCompatible: boolean;
  /** human-readable reason if not compatible */
  reason: string | null;
}

// Codecs the browser can decode natively (Chromium/Firefox/Safari)
const BROWSER_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1", "h265", "hevc"]);
// Safari supports HEVC; Chromium/Firefox support is inconsistent. We allow it but
// it may still fail on some browsers — the player auto-falls back to transcode.
const BROWSER_AUDIO_CODECS = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);

/** Detect a file's video/audio codecs using ffprobe. Returns nulls on failure. */
export async function probeCodecs(filePath: string): Promise<CodecInfo> {
  try {
    const data = await runProbe(filePath);
    const streams = data.streams ?? [];
    const v = streams.find((s: any) => s.codec_type === "video");
    const a = streams.find((s: any) => s.codec_type === "audio");
    const videoCodec = v?.codec_name ?? null;
    const audioCodec = a?.codec_name ?? null;
    const container = data.format?.format_name?.split(",")[0] ?? null;

    let reason: string | null = null;
    if (audioCodec && !BROWSER_AUDIO_CODECS.has(audioCodec)) {
      reason = `Audio codec "${audioCodec.toUpperCase()}" isn't supported by browsers — needs transcoding to AAC.`;
    } else if (videoCodec && !BROWSER_VIDEO_CODECS.has(videoCodec)) {
      reason = `Video codec "${videoCodec.toUpperCase()}" isn't supported by browsers — needs transcoding to H.264.`;
    }
    const browserCompatible = !reason;
    return { videoCodec, audioCodec, container, browserCompatible, reason };
  } catch {
    return {
      videoCodec: null,
      audioCodec: null,
      container: null,
      browserCompatible: true,
      reason: null,
    };
  }
}

function runProbe(filePath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(err || `ffprobe exited ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(e);
      }
    });
    proc.on("error", reject);
  });
}

export interface TranscodeOptions {
  /** Start position in seconds (for resume). 0 = from start. */
  startTime?: number;
}

/**
 * Spawn ffmpeg to transcode a media file into a browser-friendly MP4:
 *   - Video stream COPIED when it's H.264/HEVC (fast, lossless)
 *   - Video stream TRANSCODED to H.264 when it's incompatible (e.g. VP9, AV1 in some containers)
 *   - Audio ALWAYS transcoded to AAC (solves the AC3/DTS/TrueHD problem)
 * Output is a fragmented MP4 streamed to stdout (streamable, no seeking past buffered point).
 *
 * Returns the ChildProcess — the caller pipes stdout to the HTTP response.
 */
export function spawnTranscode(
  filePath: string,
  codecs: CodecInfo,
  opts: TranscodeOptions = {}
) {
  const args: string[] = [
    "-hide_banner",
    "-loglevel", "error",
  ];
  if (opts.startTime && opts.startTime > 1) {
    args.push("-ss", String(Math.floor(opts.startTime)));
  }
  args.push("-i", filePath);

  // Video: copy if H.264/HEVC (broadly compatible), else transcode to H.264
  const v = codecs.videoCodec;
  if (v && (v === "h264" || v === "hevc" || v === "h265")) {
    args.push("-c:v", "copy");
  } else {
    args.push(
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-maxrate", "8M",
      "-bufsize", "16M",
      "-profile:v", "high",
      "-level", "4.1",
      "-pix_fmt", "yuv420p",
    );
  }

  // Audio: always AAC (browsers universally support it)
  args.push(
    "-c:a", "aac",
    "-b:a", "192k",
    "-ac", "2", // stereo (ensures compatibility)
  );

  // Fragmented MP4 for streaming (no moov atom at end; playable as it arrives)
  args.push(
    "-f", "mp4",
    "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    "-avoid_negative_ts", "make_zero",
    "pipe:1",
  );

  return spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "inherit"] });
}

/**
 * Register cleanup so an ffmpeg process is killed when the client disconnects.
 * Without this, seeking or closing the player leaves orphaned ffmpeg processes
 * burning CPU until they finish processing the entire file.
 *
 * Returns the ChildProcess for convenience (pipable to the HTTP response).
 */
export function registerTranscodeCleanup(
  proc: ReturnType<typeof spawn>,
  signal: AbortSignal
) {
  const kill = () => {
    try {
      proc.kill("SIGTERM");
      // Force-kill after 2s if it hasn't exited
      setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch {}
      }, 2000);
    } catch {}
  };
  signal.addEventListener("abort", kill, { once: true });
  proc.on("exit", () => signal.removeEventListener("abort", kill));
  return proc;
}
