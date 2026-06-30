import { NextResponse } from "next/server";
import { getAllGenres } from "@/lib/media-queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getAllGenres());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
