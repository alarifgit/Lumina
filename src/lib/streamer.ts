import fs from "fs";
import { Readable } from "stream";
import path from "path";

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".m4v": "video/x-m4v",
  ".ts": "video/mp2t",
};

/**
 * Parse an HTTP Range header value into { start, end } byte offsets.
 * Supports all three syntaxes:
 *   bytes=START-END   (explicit range)
 *   bytes=START-      (from START to end of file)
 *   bytes=-SUFFIX     (last SUFFIX bytes)
 * Returns null for unparseable values.
 */
function parseRange(range: string, fileSize: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m) return null;
  const startStr = m[1];
  const endStr = m[2];

  // Suffix range: bytes=-N (last N bytes)
  if (!startStr && endStr) {
    const suffix = parseInt(endStr, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    const start = Math.max(0, fileSize - suffix);
    return { start, end: fileSize - 1 };
  }

  // Open-ended range: bytes=N-
  if (startStr && !endStr) {
    const start = parseInt(startStr, 10);
    if (!Number.isFinite(start) || start < 0 || start >= fileSize) return null;
    return { start, end: fileSize - 1 };
  }

  // Explicit range: bytes=N-M
  if (startStr && endStr) {
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (start < 0 || start >= fileSize || start > end) return null;
    return { start, end: Math.min(end, fileSize - 1) };
  }

  return null;
}

/**
 * Stream a local file with HTTP Range support for video playback.
 * Returns a Response with a Web ReadableStream body (Node runtime required).
 */
export function streamFile(
  req: Request,
  filePath: string,
  fallbackContentType = "video/mp4"
): Response {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return new Response(JSON.stringify({ error: "File not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!stat.isFile()) {
    return new Response(JSON.stringify({ error: "Not a file" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? fallbackContentType;
  const fileSize = stat.size;
  const range = req.headers.get("range");

  if (range) {
    const parsed = parseRange(range, fileSize);
    if (parsed) {
      const { start, end } = parsed;
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      const webStream = Readable.toWeb(stream) as ReadableStream;
      return new Response(webStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize.toString(),
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }
    // Malformed range — respond with 416 Range Not Satisfiable
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${fileSize}`,
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  const webStream = Readable.toWeb(stream) as ReadableStream;
  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Length": fileSize.toString(),
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
