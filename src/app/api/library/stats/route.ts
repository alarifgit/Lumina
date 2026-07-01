import { NextResponse } from "next/server";
import { getStats } from "@/lib/media-queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getStats());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
