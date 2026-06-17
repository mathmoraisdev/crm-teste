import { NextRequest, NextResponse } from "next/server";
import { startCampaign } from "@/server/services/campaign.service";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await startCampaign(id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao iniciar campanha" },
      { status: 400 },
    );
  }
}
