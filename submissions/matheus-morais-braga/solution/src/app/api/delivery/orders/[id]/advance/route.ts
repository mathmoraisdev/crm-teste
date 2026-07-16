import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { advanceOnlineOrder } from "@/server/services/fulfillment.service";

export const dynamic = "force-dynamic";

// Avança um passo na cadeia CONFIRMADO→EM_PREPARO→PRONTO→SAIU_ENTREGA→ENTREGUE.
// Em ENTREGUE fecha a comanda (baixa estoque + fiscal). Sem body.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  try {
    const res = await advanceOnlineOrder(ctx.tenantUserId, id);
    return NextResponse.json(res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao avançar pedido";
    return NextResponse.json({ error: msg }, { status: /n[ãa]o encontrado/i.test(msg) ? 404 : 409 });
  }
}
