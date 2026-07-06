import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { reopenOrder } from "@/server/services/order.service";

export const dynamic = "force-dynamic";

// Reabertura: volta uma comanda FECHADA para ABERTA p/ correção. Ação sensível → canSettings.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  try {
    const order = await reopenOrder(ctx.tenantUserId, id, ctx.sessionUserId);
    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
