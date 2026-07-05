import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { listOpenOrders, openOrder } from "@/server/services/order.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  return NextResponse.json({ orders: await listOpenOrders(ctx.tenantUserId) });
}

const openSchema = z.object({
  leadId: z.string().nullish(),
  customerName: z.string().nullish(),
  customerPhone: z.string().nullish(), // NOVO
});

export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const parsed = openSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  try {
    const order = await openOrder(ctx.tenantUserId, { openedById: ctx.sessionUserId, ...parsed.data });
    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
