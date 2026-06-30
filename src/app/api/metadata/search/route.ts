import { NextResponse } from "next/server";
import { searchTmdb } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { title, type, year } = (await req.json()) as {
      title?: string;
      type?: "MOVIE" | "TV";
      year?: number;
    };
    if (!title || !type)
      return NextResponse.json({ error: "title and type required" }, { status: 400 });
    const results = await searchTmdb(title, type, year);
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, results: [] }, { status: 500 });
  }
}
