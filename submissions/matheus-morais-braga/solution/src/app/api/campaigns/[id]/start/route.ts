import { NextRequest, NextResponse } from "next/server";
import { startCampaign } from "@/server/services/campaign.service";
import { isAccountActive } from "@/server/services/account.service";
import { getTenantContext } from "@/lib/tenant";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (process.env.ENABLE_DISPATCH !== "1") return NextResponse.json({ error: "Disparo desativado nesta instalação." }, { status: 403 });
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canCampaigns) {
    return NextResponse.json(
      { error: "Seu usuário não tem permissão para disparar campanhas." },
      { status: 403 },
    );
  }
  const userId = ctx.tenantUserId;
  // Rate limit por conta: protege o disparo em massa de clique-frenético/abuso
  // (10/min). Sem Redis é no-op (dev/local). Idempotência da campanha cobre o
  // resto; aqui é a 1ª barreira barata, antes de tocar o banco.
  const rl = await rateLimit(`campaign-start:${userId}`, 10, 60);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Muitas tentativas de disparo. Aguarde um minuto e tente de novo." },
      { status: 429 },
    );
  }
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
