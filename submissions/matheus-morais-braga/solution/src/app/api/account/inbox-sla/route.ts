import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getInboxSlaMinutes, setInboxSlaMinutes } from "@/server/services/account.service";
import { getTenantUserId, getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const inboxSlaMinutes = await getInboxSlaMinutes(userId);
  return NextResponse.json({ inboxSlaMinutes });
}

const putSchema = z.object({
  inboxSlaMinutes: z.number().int().min(0).max(1440).nullable(),
});

export async function PUT(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) {
    return NextResponse.json(
      { error: "Seu usuário não tem permissão para alterar as configurações da conta." },
      { status: 403 },
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    const inboxSlaMinutes = await setInboxSlaMinutes(ctx.tenantUserId, parsed.data.inboxSlaMinutes);
    return NextResponse.json({ inboxSlaMinutes });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao salvar meta de SLA" },
      { status: 400 },
    );
  }
}
