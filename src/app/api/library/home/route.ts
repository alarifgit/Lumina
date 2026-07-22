import { NextResponse } from "next/server";
import { getHomeData } from "@/lib/media-queries";
import { getHomeDataAfterPrime } from "@/lib/home-prime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getHomeDataAfterPrime(getHomeData);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
