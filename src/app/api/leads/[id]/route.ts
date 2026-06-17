import { NextRequest, NextResponse } from "next/server";
import { getLeadDetail } from "@/server/services/lead.service";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const lead = await getLeadDetail(id);
  if (!lead) {
    return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ lead });
}
