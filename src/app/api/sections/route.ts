import { NextResponse } from "next/server";
import { getSections, createSection } from "@/lib/media-queries";
import type { MediaType } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getSections());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      name?: string;
      type?: MediaType;
      category?: string;
      mediaDir?: string;
      tmdbKey?: string;
      autoMatch?: boolean;
    };
    if (!body?.name || !body?.type || !body?.mediaDir) {
      return NextResponse.json(
        { error: "name, type and mediaDir are required" },
        { status: 400 }
      );
    }
    const section = await createSection({
      name: body.name,
      type: body.type,
      category: body.category,
      mediaDir: body.mediaDir,
      tmdbKey: body.tmdbKey,
      autoMatch: body.autoMatch,
    });
    return NextResponse.json(section);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
