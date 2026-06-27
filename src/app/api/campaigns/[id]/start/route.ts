import { NextRequest, NextResponse } from "next/server";
import { startCampaign } from "@/server/services/campaign.service";
import { isAccountActive } from "@/server/services/account.service";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (process.env.ENABLE_DISPATCH !== "1") return NextResponse.json({ error: "Disparo desativado nesta instalação." }, { status: 403 });
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!(await isAccountActive(userId))) {
    return NextResponse.json(
      {
        error:
          "Conta aguardando liberação no painel financeiro. O disparo é liberado após a ativação.",
      },
      { status: 403 },
    );
  }
  const { id } = await params;
  try {
    const result = await startCampaign(id, userId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao iniciar campanha" },
      { status: 400 },
    );
  }
}
