import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { voidOrder } from "@/server/services/order.service";

export const dynamic = "force-dynamic";

// Estorno: anula uma comanda FECHADA. Motivo obrigatório. Ação sensível → canSettings.
const voidSchema = z.object({ reason: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = voidSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Informe o motivo do estorno." }, { status: 400 });
  try {
    const order = await voidOrder(ctx.tenantUserId, id, parsed.data.reason, ctx.sessionUserId);
    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
