import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { confirmOnlineOrder } from "@/server/services/fulfillment.service";

export const dynamic = "force-dynamic";

// PENDENTE → CONFIRMADO. Devolve os tickets de cozinha para o client imprimir
// (reusar printKitchenTickets no client). Operacional: qualquer operador da conta.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  try {
    const res = await confirmOnlineOrder(ctx.tenantUserId, id);
    return NextResponse.json(res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao confirmar pedido";
    return NextResponse.json({ error: msg }, { status: /n[ãa]o encontrado/i.test(msg) ? 404 : 409 });
  }
}
