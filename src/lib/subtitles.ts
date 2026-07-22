import path from "path";
import { spawn } from "child_process";

export const SUBTITLE_EXTS = [".vtt", ".srt", ".ass", ".ssa", ".sub"];

export interface DiscoveredSubtitle {
  filePath: string;
  language: string;
  label: string;
  format: string;
  source: "sidecar" | "embedded";
  streamIndex: number | null;
  codec: string | null;
  isDefault: boolean;
}

export interface SubtitleDiscoveryIssue {
  source: "sidecar" | "embedded";
  path: string;
  message: string;
  /** A filesystem traversal failure makes missing-path reconciliation unsafe. */
  traversal: boolean;
}

export interface SubtitleDiscoveryResult {
  subtitles: DiscoveredSubtitle[];
  complete: boolean;
  sidecarComplete: boolean;
  /** False when embedded discovery was skipped or failed. */
  embeddedComplete: boolean;
  issues: SubtitleDiscoveryIssue[];
}

/** Detect subtitle format from a filename extension. */
export function subtitleFormat(filePath: string): "vtt" | "srt" | "ass" | "ssa" | "sub" {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".vtt") return "vtt";
  if (ext === ".srt") return "srt";
  if (ext === ".ass") return "ass";
  if (ext === ".ssa") return "ssa";
  if (ext === ".sub") return "sub";
  return "srt";
}

/** Parse a language code/label from a subtitle filename. */
export function parseSubtitleLang(fileName: string): { language: string; label: string } {
  const base = path.basename(fileName, path.extname(fileName));
  // patterns: "Movie.en.srt", "Movie.eng.srt", "Movie.en.sdh.srt", "Movie.srt"
  const langMatch = base.match(/[\._\s-](en|eng|english|ja|jpn|japanese|es|spa|spanish|fr|fre|french|de|ger|german|pt|por|portuguese|zh|chi|chinese|ko|kor|korean|it|ita|italian|ru|rus|russian|ar|ara|arabic|hi|hin|hindi)(?:[\._\s-]|$)/i);
  const map: Record<string, { language: string; label: string }> = {
    en: { language: "en", label: "English" },
    eng: { language: "en", label: "English" },
    english: { language: "en", label: "English" },
    ja: { language: "ja", label: "Japanese" },
    jpn: { language: "ja", label: "Japanese" },
    japanese: { language: "ja", label: "Japanese" },
    es: { language: "es", label: "Spanish" },
    spa: { language: "es", label: "Spanish" },
    spanish: { language: "es", label: "Spanish" },
    fr: { language: "fr", label: "French" },
    fre: { language: "fr", label: "French" },
    french: { language: "fr", label: "French" },
    de: { language: "de", label: "German" },
    ger: { language: "de", label: "German" },
    german: { language: "de", label: "German" },
    pt: { language: "pt", label: "Portuguese" },
    por: { language: "pt", label: "Portuguese" },
    portuguese: { language: "pt", label: "Portuguese" },
    zh: { language: "zh", label: "Chinese" },
    chi: { language: "zh", label: "Chinese" },
    chinese: { language: "zh", label: "Chinese" },
    ko: { language: "ko", label: "Korean" },
    kor: { language: "ko", label: "Korean" },
    korean: { language: "ko", label: "Korean" },
    it: { language: "it", label: "Italian" },
    ita: { language: "it", label: "Italian" },
    italian: { language: "it", label: "Italian" },
    ru: { language: "ru", label: "Russian" },
    rus: { language: "ru", label: "Russian" },
    russian: { language: "ru", label: "Russian" },
    ar: { language: "ar", label: "Arabic" },
    ara: { language: "ar", label: "Arabic" },
    arabic: { language: "ar", label: "Arabic" },
    hi: { language: "hi", label: "Hindi" },
    hin: { language: "hi", label: "Hindi" },
    hindi: { language: "hi", label: "Hindi" },
  };
  if (langMatch) {
    const key = langMatch[1].toLowerCase();
    return map[key] ?? { language: "en", label: "English" };
  }
  return { language: "en", label: "English" };
}

/**
 * Find subtitle files that accompany a video file.
 * Looks in the same directory for files sharing the video's base name
 * (e.g. "Movie.mp4" → "Movie.srt", "Movie.en.srt", "Movie.en.vtt").
 */
export async function findSubtitlesForVideo(
  videoPath: string,
  readdir: (p: string) => Promise<string[]>,
  options: { includeEmbedded?: boolean } = {}
): Promise<SubtitleDiscoveryResult> {
  const dir = path.dirname(videoPath);
  const videoBase = path.basename(videoPath, path.extname(videoPath));
  const issues: SubtitleDiscoveryIssue[] = [];
  let sidecarComplete = true;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    issues.push({
      source: "sidecar",
      path: dir,
      message: error instanceof Error ? error.message : String(error),
      traversal: true,
    });
    sidecarComplete = false;
    entries = [];
  }
  const subs: DiscoveredSubtitle[] = [];
  const videoCount = entries.filter(isLikelyVideo).length;
  const locations = [{ directory: dir, entries }];
  // The parent listing already tells us whether a nested subtitle directory
  // exists. Avoid four speculative readdir calls per video: those misses are
  // especially expensive on a remote SMB mount and multiply across episodes.
  const nestedSubtitleFolders = [...new Set(
    entries.filter((entry) => ["subs", "subtitles"].includes(entry.toLowerCase()))
  )];
  for (const folder of nestedSubtitleFolders) {
    const directory = path.join(/* turbopackIgnore: true */ dir, folder);
    const nested = await readdir(directory).catch((error: unknown) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        sidecarComplete = false;
        issues.push({
          source: "sidecar",
          path: directory,
          message: error instanceof Error ? error.message : String(error),
          traversal: true,
        });
      }
      return null;
    });
    if (nested) locations.push({ directory, entries: nested });
  }

  const seen = new Set<string>();
  for (const location of locations) {
    for (const entry of location.entries) {
      const ext = path.extname(entry).toLowerCase();
      if (!SUBTITLE_EXTS.includes(ext)) continue;
      const entryBase = path.basename(entry, ext);
      const sharesVideoName =
        entryBase === videoBase ||
        entryBase.startsWith(videoBase + ".") ||
        entryBase.startsWith(videoBase + "_") ||
        entryBase.startsWith(videoBase + "-");
      if (!sharesVideoName && videoCount !== 1) continue;

      const filePath = path.join(/* turbopackIgnore: true */ location.directory, entry);
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const { language, label } = parseSubtitleLang(entry);
      const forced = /(?:^|[._ -])forced(?:[._ -]|$)/i.test(entryBase);
      const hearingImpaired = /(?:^|[._ -])(sdh|cc)(?:[._ -]|$)/i.test(entryBase);
      subs.push({
        filePath,
        language,
        label: `${label}${forced ? " (Forced)" : hearingImpaired ? " (SDH)" : ""}`,
        format: subtitleFormat(entry),
        source: "sidecar",
        streamIndex: null,
        codec: null,
        isDefault: forced,
      });
    }
  }
  if (options.includeEmbedded === false) {
    return {
      subtitles: subs,
      complete: sidecarComplete,
      sidecarComplete,
      embeddedComplete: false,
      issues,
    };
  }

  const embedded = await findEmbeddedSubtitles(videoPath);
  if (embedded.issue) issues.push(embedded.issue);
  return {
    subtitles: [...subs, ...embedded.subtitles],
    complete: sidecarComplete && !embedded.issue,
    sidecarComplete,
    embeddedComplete: !embedded.issue,
    issues,
  };
}

function isLikelyVideo(fileName: string) {
  return [".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".ts"]
    .includes(path.extname(fileName).toLowerCase());
}

const TEXT_SUBTITLE_CODECS = new Set([
  "subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text",
]);

export function isTextSubtitleCodec(codec: string | null | undefined) {
  return TEXT_SUBTITLE_CODECS.has(String(codec ?? "").toLowerCase());
}

async function findEmbeddedSubtitles(videoPath: string): Promise<{
  subtitles: DiscoveredSubtitle[];
  issue: SubtitleDiscoveryIssue | null;
}> {
  try {
    const data = await runFfprobe(videoPath);
    return {
      subtitles: (data.streams ?? [])
      .filter((stream: any) => Number.isInteger(Number(stream.index)))
      .map((stream: any) => {
        const languageTag = String(stream.tags?.language ?? "und").toLowerCase();
        const parsed = parseSubtitleLang(`track.${languageTag}.srt`);
        const knownLanguage = languageTag !== "und" && parsed.language !== "en"
          ? parsed
          : languageTag === "eng" || languageTag === "en"
            ? { language: "en", label: "English" }
            : { language: languageTag, label: languageTag === "und" ? "Unknown language" : languageTag.toUpperCase() };
        const title = String(stream.tags?.title ?? "").trim();
        const forced = stream.disposition?.forced === 1;
        return {
          filePath: videoPath,
          language: knownLanguage.language,
          label: title || `${knownLanguage.label}${forced ? " (Forced)" : ""}`,
          format: String(stream.codec_name ?? "embedded"),
          source: "embedded" as const,
          streamIndex: Number(stream.index),
          codec: String(stream.codec_name ?? ""),
          isDefault: stream.disposition?.default === 1 || forced,
        };
      }),
      issue: null,
    };
  } catch (error) {
    return {
      subtitles: [],
      issue: {
        source: "embedded",
        path: videoPath,
        message: error instanceof Error ? error.message : String(error),
        traversal: false,
      },
    };
  }
}

function runFfprobe(videoPath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const process = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "s",
      "-show_entries", "stream=index,codec_name:stream_tags=language,title:stream_disposition=default,forced",
      "-of", "json",
      videoPath,
    ]);
    let output = "";
    let error = "";
    process.stdout.on("data", (chunk) => { output += chunk; });
    process.stderr.on("data", (chunk) => { error += chunk; });
    process.on("error", reject);
    process.on("close", (code) => {
      if (code !== 0) return reject(new Error(error || `ffprobe exited ${code}`));
      try {
        resolve(JSON.parse(output));
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

/**
 * Convert SRT subtitle content to WebVTT format.
 * VTT uses `.` for milliseconds where SRT uses `,`, and requires a `WEBVTT` header.
 */
export function srtToVtt(srt: string): string {
  const withHeader = "WEBVTT\n\n" + srt.replace(/\r+/g, "");
  // Replace the comma in SRT timestamps with a dot: 00:00:01,000 → 00:00:01.000
  return withHeader.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    "$1.$2"
  );
}

/** Read a local subtitle file and return VTT content (converting if needed). */
export async function readSubtitleAsVtt(filePath: string, streamIndex?: number | null): Promise<string> {
  const { promises: fsp } = await import("fs");
  if (streamIndex != null || ["ass", "ssa", "sub"].includes(subtitleFormat(filePath))) {
    return extractSubtitleAsVtt(filePath, streamIndex);
  }
  const content = await fsp.readFile(/* turbopackIgnore: true */ filePath, "utf-8");
  const fmt = subtitleFormat(filePath);
  if (fmt === "vtt") return content;
  if (fmt === "srt") return srtToVtt(content);
  // ASS/SSA/Sub — basic fallback: serve as-is (browser may not render, but at least provide the data)
  return "WEBVTT\n\n" + content;
}

function extractSubtitleAsVtt(filePath: string, streamIndex?: number | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["-v", "error", "-i", filePath];
    if (streamIndex != null) args.push("-map", `0:${streamIndex}`);
    args.push("-f", "webvtt", "pipe:1");
    const process = spawn("ffmpeg", args);
    let output = "";
    let error = "";
    process.stdout.on("data", (chunk) => { output += chunk; });
    process.stderr.on("data", (chunk) => { error += chunk; });
    process.on("error", reject);
    process.on("close", (code) => {
      if (code !== 0) return reject(new Error(error || `ffmpeg exited ${code}`));
      resolve(output.startsWith("WEBVTT") ? output : `WEBVTT\n\n${output}`);
    });
  });
}
