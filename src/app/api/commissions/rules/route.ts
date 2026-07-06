import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { listCommissionRules, createCommissionRule } from "@/server/services/commission.service";

export const dynamic = "force-dynamic";

// Comissão é dado de DONO (quanto cada profissional ganha): gate canSettings.
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const rules = await listCommissionRules(ctx.tenantUserId);
  return NextResponse.json({ rules });
}

const createSchema = z.object({
  professionalId: z.string(),
  catalogItemId: z.string().nullish(),
  percentBps: z.number().int().nullish(),
  fixedCents: z.number().int().nullish(),
});

export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    const rule = await createCommissionRule(ctx.tenantUserId, parsed.data);
    return NextResponse.json({ rule });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao salvar" }, { status: 400 });
  }
}
