import { NextRequest, NextResponse } from "next/server";
import { getCampaignProgress } from "@/server/services/dispatchMetrics";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const progress = await getCampaignProgress(id, userId, new Date());
  if (!progress) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
  return NextResponse.json(progress);
}
