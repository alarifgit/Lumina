import { NextResponse } from "next/server";
import { browseMedia } from "@/lib/media-queries";
import type { MediaType } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = (searchParams.get("type") as MediaType | null) ?? undefined;
    const genre = searchParams.get("genre") || undefined;
    const q = searchParams.get("q") || undefined;
    const sort = searchParams.get("sort") || undefined;
    const page = searchParams.get("page") ? parseInt(searchParams.get("page")!, 10) : 1;
    const pageSize = searchParams.get("pageSize")
      ? parseInt(searchParams.get("pageSize")!, 10)
      : 24;
    const data = await browseMedia({ type, genre, q, sort, page, pageSize });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
