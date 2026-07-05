import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { getOrder, closeOrder, setOrderAdjustments } from "@/server/services/order.service";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  try {
    const order = await getOrder(ctx.tenantUserId, id);
    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 404 });
  }
}

const closeSchema = z.object({ payment: z.enum(["DINHEIRO", "PIX", "CARTAO", "OUTRO"]), note: z.string().optional() });
const adjustmentsSchema = z.object({
  discountCents: z.number().int().min(0).nullish(),
  surchargeCents: z.number().int().min(0).nullish(),
  tipCents: z.number().int().min(0).nullish(),
  tableLabel: z.string().nullish(),
});

// PATCH tem dois modos na mesma comanda ABERTA:
//  - com `payment` → FECHA a comanda (fluxo de fechamento);
//  - sem `payment` → grava os ajustes financeiros (desconto/taxa/gorjeta/mesa)
//    ao vivo, enquanto o operador edita.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);

  if (body && typeof body === "object" && "payment" in body) {
    const parsed = closeSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    try {
      const order = await closeOrder(ctx.tenantUserId, id, { ...parsed.data, closedById: ctx.sessionUserId });
      return NextResponse.json({ order });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
    }
  }

  const parsed = adjustmentsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  try {
    const order = await setOrderAdjustments(ctx.tenantUserId, id, parsed.data);
    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
