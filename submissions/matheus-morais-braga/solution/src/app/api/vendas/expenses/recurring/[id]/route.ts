import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { updateRecurring, deleteRecurring } from "@/server/services/expense.service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  description: z.string().optional(),
  amountCents: z.number().int().optional(),
  category: z.enum(["ALUGUEL", "FORNECEDOR", "PESSOAL", "CONTAS", "IMPOSTOS", "OUTRO"]).optional(),
  dayOfMonth: z.number().int().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canFinance) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    const recurring = await updateRecurring(ctx.tenantUserId, id, parsed.data);
    return NextResponse.json({ recurring });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao salvar" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canFinance) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  try {
    await deleteRecurring(ctx.tenantUserId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao excluir" }, { status: 400 });
  }
}
