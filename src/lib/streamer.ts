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
    return new Response(JSON.stringify({ error: "File not found", path: filePath }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!stat.isFile()) {
    return new Response(JSON.stringify({ error: "Not a file", path: filePath }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? fallbackContentType;
  const fileSize = stat.size;
  const range = req.headers.get("range");

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : fileSize - 1;
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
