import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { FulfillmentStatus } from "@prisma/client";
import { getTenantContext } from "@/lib/tenant";
import { listOnlineOrders } from "@/server/services/fulfillment.service";

export const dynamic = "force-dynamic";

const STATUS: [FulfillmentStatus, ...FulfillmentStatus[]] = [
  "PENDENTE",
  "CONFIRMADO",
  "EM_PREPARO",
  "PRONTO",
  "SAIU_ENTREGA",
  "ENTREGUE",
  "RECUSADO",
];

const querySchema = z.object({
  status: z.enum(STATUS).optional(),
});

// Fila de pedidos online do lojista (source=ONLINE). Mesmo modelo do PDV:
// qualquer operador autenticado da conta opera a fila (não é gate de settings).
export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Filtro de status inválido." }, { status: 400 });
  }
  const orders = await listOnlineOrders(ctx.tenantUserId, parsed.data.status ? { status: parsed.data.status } : undefined);
  return NextResponse.json({ orders });
}
