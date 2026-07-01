import { NextResponse } from "next/server";
import { searchMedia } from "@/lib/media-queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    return NextResponse.json(await searchMedia(q));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
