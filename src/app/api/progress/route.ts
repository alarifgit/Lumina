import { NextResponse } from "next/server";
import {
  getContinueWatching,
  InvalidProgressTargetError,
  saveProgress,
} from "@/lib/media-queries";
import type { SaveProgressPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await getContinueWatching(24);
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SaveProgressPayload;
    if (
      !body?.mediaId ||
      typeof body.position !== "number" ||
      !Number.isFinite(body.position) ||
      body.position < 0 ||
      typeof body.duration !== "number" ||
      !Number.isFinite(body.duration) ||
      body.duration < 0
    ) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const result = await saveProgress(body);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof InvalidProgressTargetError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
