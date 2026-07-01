import { NextResponse } from "next/server";
import { getMyList } from "@/lib/media-queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await getMyList();
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
