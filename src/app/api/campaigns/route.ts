import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createCampaign, listCampaigns } from "@/server/services/campaign.service";
import { isAccountActive } from "@/server/services/account.service";
import { getTenantUserId, getTenantContext } from "@/lib/tenant";

const SUSPENDED_MSG =
  "Conta aguardando liberação no painel financeiro. Fale com o suporte para ativar as campanhas.";

const NO_CAMPAIGN_PERM =
  "Seu usuário não tem permissão para disparar campanhas. Fale com o administrador da conta.";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const campaigns = await listCampaigns(userId);
  return NextResponse.json({ campaigns });
}

const createSchema = z.object({
  name: z.string().min(1, "Nome obrigatório"),
  messageTemplate: z
    .string()
    .min(1, "Template obrigatório")
    .refine((t) => /\{\{\s*nome\s*\}\}/i.test(t), {
      message: "O template deve conter {{nome}}",
    }),
  leadIds: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canCampaigns) {
    return NextResponse.json({ error: NO_CAMPAIGN_PERM }, { status: 403 });
  }
  const userId = ctx.tenantUserId;
  if (!(await isAccountActive(userId))) {
    return NextResponse.json({ error: SUSPENDED_MSG }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  const result = await createCampaign(userId, parsed.data);
  return NextResponse.json(result, { status: 201 });
}
