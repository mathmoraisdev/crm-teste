import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { getKitchenOrder } from "@/server/services/order.service";
import { buildKitchenTickets } from "@/lib/receipt/kitchen";

export const dynamic = "force-dynamic";

// Tickets de produção (N3) da comanda, um por setor, SEM valores. JSON puro —
// o cliente renderiza (browser) ou constrói os bytes ESC/POS (buildKitchenEscposBytes)
// e roteia p/ o QZ. Escopado por conta.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  try {
    const order = await getKitchenOrder(ctx.tenantUserId, id);
    const tickets = buildKitchenTickets(order);
    return NextResponse.json({ tickets });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 404 });
  }
}
