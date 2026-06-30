import { NextResponse } from "next/server";
import { updateSection, deleteSection } from "@/lib/media-queries";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as Partial<{
      name: string;
      mediaDir: string;
      tmdbKey: string;
      autoMatch: boolean;
    }>;
    return NextResponse.json(await updateSection(id, body));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json(await deleteSection(id));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
