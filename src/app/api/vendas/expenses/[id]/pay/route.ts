import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { payExpense } from "@/server/services/expense.service";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  try {
    const expense = await payExpense(ctx.tenantUserId, id);
    return NextResponse.json({ expense });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao pagar" }, { status: 400 });
  }
}
