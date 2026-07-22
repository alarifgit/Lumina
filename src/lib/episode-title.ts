import path from "path";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".ts"]);
const EPISODE_MARKER = /[sS]\d{1,2}\s*[eE]\d{1,4}(?!\d)/;
const RELEASE_TAG = /\b(1080p|720p|480p|2160p|4k|x264|x265|h264|h265|hevc|bluray|web[ ._-]?dl|webrip|hdtv|web|brrip|bdrip|dvdrip|remux|hdr|atmos|aac|ac3|5\.1|2\.0|10bit|dual[ ._-]?audio)\b/gi;

/**
 * Derive the human episode name after an SxxExx marker without changing the
 * episode identity. This is a display fallback when provider ordering differs
 * or metadata has not arrived yet.
 */
export function deriveEpisodeSourceTitle(raw: string) {
  const extension = path.extname(raw).toLowerCase();
  const base = path.basename(raw, VIDEO_EXTENSIONS.has(extension) ? extension : undefined);
  const marker = base.match(EPISODE_MARKER);
  if (!marker || marker.index == null) return null;
  const title = base
    .slice(marker.index + marker[0].length)
    .replace(/^[\s._\-–—]+/, "")
    .replace(/[._]/g, " ")
    .replace(RELEASE_TAG, " ")
    .replace(/\s*[-–—+]+\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title && !/^s\d+e\d+$/i.test(title) ? title : null;
}
