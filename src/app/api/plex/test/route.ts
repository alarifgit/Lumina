import { NextResponse } from "next/server";
import { testPlexConnection } from "@/lib/plex-sync";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await testPlexConnection({
      url: typeof body?.url === "string" ? body.url : undefined,
      token: typeof body?.token === "string" ? body.token : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
