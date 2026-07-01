import path from "path";

export const SUBTITLE_EXTS = [".vtt", ".srt", ".ass", ".ssa", ".sub"];

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
  readdir: (p: string) => Promise<string[]>
): Promise<{ filePath: string; language: string; label: string; format: string }[]> {
  const dir = path.dirname(videoPath);
  const videoBase = path.basename(videoPath, path.extname(videoPath));
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const subs: { filePath: string; language: string; label: string; format: string }[] = [];
  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (!SUBTITLE_EXTS.includes(ext)) continue;
    const entryBase = path.basename(entry, ext);
    // Match "Movie.srt", "Movie.en.srt", "Movie.en.sdh.srt" but not "OtherMovie.srt"
    if (entryBase === videoBase || entryBase.startsWith(videoBase + ".") || entryBase.startsWith(videoBase + "_") || entryBase.startsWith(videoBase + "-")) {
      const { language, label } = parseSubtitleLang(entry);
      subs.push({
        filePath: path.join(dir, entry),
        language,
        label,
        format: subtitleFormat(entry),
      });
    }
  }
  return subs;
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
export async function readSubtitleAsVtt(filePath: string): Promise<string> {
  const { promises: fsp } = await import("fs");
  const content = await fsp.readFile(filePath, "utf-8");
  const fmt = subtitleFormat(filePath);
  if (fmt === "vtt") return content;
  if (fmt === "srt") return srtToVtt(content);
  // ASS/SSA/Sub — basic fallback: serve as-is (browser may not render, but at least provide the data)
  return "WEBVTT\n\n" + content;
}
