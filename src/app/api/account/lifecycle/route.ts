import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getLifecycleAutomationEnabled,
  setLifecycleAutomationEnabled,
} from "@/server/services/account.service";
import { getTenantUserId, getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const lifecycleAutomationEnabled = await getLifecycleAutomationEnabled(userId);
  return NextResponse.json({ lifecycleAutomationEnabled });
}

const putSchema = z.object({
  lifecycleAutomationEnabled: z.boolean(),
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
    const lifecycleAutomationEnabled = await setLifecycleAutomationEnabled(
      ctx.tenantUserId,
      parsed.data.lifecycleAutomationEnabled,
    );
    return NextResponse.json({ lifecycleAutomationEnabled });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao salvar automações de ciclo de vida" },
      { status: 400 },
    );
  }
}
