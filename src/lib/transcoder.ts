import { spawn, spawnSync } from "child_process";

export interface CodecInfo {
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
  /** true if the browser can play this file directly without transcoding */
  browserCompatible: boolean;
  /** human-readable reason if not compatible */
  reason: string | null;
  directPlayable: boolean;
  directPlayReason: string | null;
}

// Codecs the browser can decode natively (Chromium/Firefox/Safari)
const BROWSER_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1", "h265", "hevc"]);
// Safari supports HEVC; Chromium/Firefox support is inconsistent. We allow it but
// it may still fail on some browsers — the player auto-falls back to transcode.
const BROWSER_AUDIO_CODECS = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);
const DEFAULT_VAAPI_DEVICE = "/dev/dri/renderD128";
const VALID_ENCODERS = new Set(["auto", "libx264", "h264_vaapi"]);
let vaapiCheckCache: { device: string; ok: boolean; reason: string | null; checkedAt: number } | null = null;

export interface TranscodeStatus {
  transcodeAvailable: boolean;
  transcodeHardware: boolean;
  transcodeEncoder: string;
  transcodeEncoderKey: string;
  transcodeReason: string | null;
}

function configuredEncoder() {
  const raw = process.env.LUMINA_TRANSCODE_ENCODER?.trim().toLowerCase();
  if (!raw) return "auto";
  if (raw === "vaapi") return "h264_vaapi";
  return VALID_ENCODERS.has(raw) ? raw : "auto";
}

function configuredVaapiDevice() {
  return process.env.LUMINA_VAAPI_DEVICE?.trim() || DEFAULT_VAAPI_DEVICE;
}

function ffmpegSupportsEncoder(encoder: string) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return false;
  return `${result.stdout}\n${result.stderr}`.includes(encoder);
}

function ffmpegAvailable() {
  const result = spawnSync("ffmpeg", ["-version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

function deviceAvailable(device: string) {
  const result = spawnSync("test", ["-e", device], {
    encoding: "utf8",
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

function vaapiUsable(device: string) {
  const now = Date.now();
  if (vaapiCheckCache?.device === device && now - vaapiCheckCache.checkedAt < 60_000) {
    return vaapiCheckCache;
  }

  const result = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel", "error",
    "-vaapi_device", device,
    "-f", "lavfi",
    "-i", "nullsrc=s=16x16:d=0.1",
    "-vf", "format=nv12,hwupload",
    "-c:v", "h264_vaapi",
    "-frames:v", "1",
    "-f", "null",
    "-",
  ], {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  const ok = !result.error && result.status === 0;
  vaapiCheckCache = {
    device,
    ok,
    reason: ok ? null : (result.stderr || result.error?.message || "VAAPI device failed an ffmpeg smoke test.").trim(),
    checkedAt: now,
  };
  return vaapiCheckCache;
}

export function getTranscodeStatus(): TranscodeStatus {
  if (!ffmpegAvailable()) {
    return {
      transcodeAvailable: false,
      transcodeHardware: false,
      transcodeEncoder: "ffmpeg unavailable",
      transcodeEncoderKey: "none",
      transcodeReason: "ffmpeg is not available in this runtime.",
    };
  }

  const requestedEncoder = configuredEncoder();
  if (requestedEncoder === "libx264") {
    return {
      transcodeAvailable: true,
      transcodeHardware: false,
      transcodeEncoder: "CPU transcoding via libx264",
      transcodeEncoderKey: "libx264",
      transcodeReason: null,
    };
  }

  const device = configuredVaapiDevice();
  if (!deviceAvailable(device)) {
    return {
      transcodeAvailable: true,
      transcodeHardware: false,
      transcodeEncoder: "CPU transcoding via libx264",
      transcodeEncoderKey: "libx264",
      transcodeReason:
        requestedEncoder === "h264_vaapi"
          ? `VAAPI was requested, but ${device} is not available. Falling back to CPU transcoding.`
          : null,
    };
  }

  if (!ffmpegSupportsEncoder("h264_vaapi")) {
    return {
      transcodeAvailable: true,
      transcodeHardware: false,
      transcodeEncoder: "CPU transcoding via libx264",
      transcodeEncoderKey: "libx264",
      transcodeReason:
        requestedEncoder === "h264_vaapi"
          ? "VAAPI was requested, but this ffmpeg build does not expose h264_vaapi. Falling back to CPU transcoding."
          : null,
    };
  }

  const vaapi = vaapiUsable(device);
  if (!vaapi.ok) {
    return {
      transcodeAvailable: true,
      transcodeHardware: false,
      transcodeEncoder: "CPU transcoding via libx264",
      transcodeEncoderKey: "libx264",
      transcodeReason:
        requestedEncoder === "h264_vaapi"
          ? `VAAPI was requested, but ${device} failed to initialize. Falling back to CPU transcoding.`
          : vaapi.reason,
    };
  }

  return {
    transcodeAvailable: true,
    transcodeHardware: true,
    transcodeEncoder: `VAAPI hardware transcoding via ${device}`,
    transcodeEncoderKey: "h264_vaapi",
    transcodeReason: null,
  };
}

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
    return {
      videoCodec,
      audioCodec,
      container,
      browserCompatible,
      reason,
      directPlayable: browserCompatible,
      directPlayReason: reason,
    };
  } catch {
    return {
      videoCodec: null,
      audioCodec: null,
      container: null,
      browserCompatible: true,
      reason: null,
      directPlayable: true,
      directPlayReason: null,
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
  /** Embedded bitmap subtitle stream to burn into the video. */
  subtitleStreamIndex?: number;
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
  const encoder = getTranscodeStatus().transcodeEncoderKey;
  const burnSubtitle = opts.subtitleStreamIndex != null;
  const args: string[] = [
    "-hide_banner",
    "-loglevel", "error",
  ];
  if (opts.startTime && opts.startTime > 1) {
    args.push("-ss", String(Math.floor(opts.startTime)));
  }

  const v = codecs.videoCodec;
  const copyVideo = !burnSubtitle && !!v && (v === "h264" || v === "hevc" || v === "h265");
  if (!copyVideo && encoder === "h264_vaapi") {
    args.push("-vaapi_device", configuredVaapiDevice());
  }

  args.push("-i", filePath);

  // Video: copy if H.264/HEVC (broadly compatible), else transcode to H.264
  if (copyVideo) {
    args.push("-c:v", "copy");
  } else if (encoder === "h264_vaapi") {
    if (burnSubtitle) {
      args.push(
        "-filter_complex", `[0:v:0][0:${opts.subtitleStreamIndex}]overlay,format=nv12,hwupload[v]`,
        "-map", "[v]",
        "-map", "0:a:0?",
      );
    } else {
      args.push("-vf", "format=nv12,hwupload");
    }
    args.push(
      "-c:v", "h264_vaapi",
      "-qp", "23",
      "-maxrate", "8M",
      "-bufsize", "16M",
    );
  } else {
    if (burnSubtitle) {
      args.push(
        "-filter_complex", `[0:v:0][0:${opts.subtitleStreamIndex}]overlay,format=yuv420p[v]`,
        "-map", "[v]",
        "-map", "0:a:0?",
      );
    }
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

export function childProcessToWebStream(proc: ReturnType<typeof spawn>, signal: AbortSignal) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (!proc.stdout) {
        controller.error(new Error("Transcode process has no stdout stream."));
        return;
      }
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {}
      };
      const error = (err: Error) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(err);
        } catch {}
      };
      const abort = () => {
        closed = true;
        try {
          proc.kill("SIGTERM");
        } catch {}
      };

      proc.stdout.on("data", (chunk: Buffer) => {
        if (closed) return;
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch {
          abort();
        }
      });
      proc.stdout.on("end", close);
      proc.stdout.on("error", error);
      proc.on("error", error);
      proc.on("exit", close);
      signal.addEventListener("abort", abort, { once: true });
    },
    cancel() {
      try {
        proc.kill("SIGTERM");
      } catch {}
    },
  });
}
