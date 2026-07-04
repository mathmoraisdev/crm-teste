import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { competenceMonth } from "@/server/services/date-range";
import { createExpense, listPayable, listPaid, ensureRecurringForMonth } from "@/server/services/expense.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  // Garante as fixas do mês corrente antes de listar (lazy, idempotente).
  await ensureRecurringForMonth(ctx.tenantUserId, competenceMonth());
  const [payable, paid] = await Promise.all([listPayable(ctx.tenantUserId), listPaid(ctx.tenantUserId)]);
  return NextResponse.json({ payable, paid });
}

const createSchema = z.object({
  description: z.string(),
  amountCents: z.number().int(),
  category: z.enum(["ALUGUEL", "FORNECEDOR", "PESSOAL", "CONTAS", "IMPOSTOS", "OUTRO"]).optional(),
  dueDate: z.string(),
  note: z.string().optional(),
  paidNow: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    const expense = await createExpense(ctx.tenantUserId, { ...parsed.data, createdById: ctx.sessionUserId });
    return NextResponse.json({ expense });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao salvar" }, { status: 400 });
  }
}
