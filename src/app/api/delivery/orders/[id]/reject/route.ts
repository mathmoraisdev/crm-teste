import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { rejectOnlineOrder } from "@/server/services/fulfillment.service";

export const dynamic = "force-dynamic";

const rejectSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// PENDENTE → RECUSADO. Comanda segue ABERTA (sem baixar estoque); se pago online,
// o serviço anota a necessidade de estorno manual.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = rejectSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Motivo inválido." }, { status: 400 });
  }
  try {
    const res = await rejectOnlineOrder(ctx.tenantUserId, id, parsed.data.reason ?? "");
    return NextResponse.json(res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao recusar pedido";
    return NextResponse.json({ error: msg }, { status: /n[ãa]o encontrado/i.test(msg) ? 404 : 409 });
  }
}
