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

const PAYMENT = z.enum(["DINHEIRO", "PIX", "CARTAO", "OUTRO"]);
// Fechamento: multi-pagamento (tenders) OU o `payment` único legado (retrocompat).
const closeSchema = z.object({
  tenders: z.array(z.object({ method: PAYMENT, amountCents: z.number().int().min(0) })).optional(),
  payment: PAYMENT.optional(),
  amountTenderedCents: z.number().int().min(0).optional(),
  allowPartial: z.boolean().optional(),
  note: z.string().optional(),
  professionalId: z.string().optional(), // profissional creditado (comissão); opcional
});
const adjustmentsSchema = z.object({
  discountCents: z.number().int().min(0).nullish(),
  surchargeCents: z.number().int().min(0).nullish(),
  tipCents: z.number().int().min(0).nullish(),
  tableLabel: z.string().nullish(),
});

// PATCH tem dois modos na mesma comanda ABERTA:
//  - com `tenders` (ou o `payment` legado) → FECHA a comanda;
//  - sem eles → grava os ajustes financeiros (desconto/taxa/gorjeta/mesa)
//    ao vivo, enquanto o operador edita.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);

  const isClose = body && typeof body === "object" && ("payment" in body || "tenders" in body);
  if (isClose) {
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
    const order = await setOrderAdjustments(ctx.tenantUserId, id, parsed.data, ctx.sessionUserId);
    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
