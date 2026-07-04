import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { createRecurring, listRecurring } from "@/server/services/expense.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const recurring = await listRecurring(ctx.tenantUserId);
  return NextResponse.json({ recurring });
}

const createSchema = z.object({
  description: z.string(),
  amountCents: z.number().int(),
  category: z.enum(["ALUGUEL", "FORNECEDOR", "PESSOAL", "CONTAS", "IMPOSTOS", "OUTRO"]).optional(),
  dayOfMonth: z.number().int(),
});

export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    const recurring = await createRecurring(ctx.tenantUserId, { ...parsed.data, createdById: ctx.sessionUserId });
    return NextResponse.json({ recurring });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao salvar" }, { status: 400 });
  }
}
