import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { listStock } from "@/server/services/stock.service";
import { stockValuation } from "@/server/services/stock-valuation.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const [items, valuation] = await Promise.all([
    listStock(ctx.tenantUserId),
    stockValuation(ctx.tenantUserId),
  ]);
  return NextResponse.json({ items, valuation }); // cada item traz `low`; valuation = valor total + itens sem custo
}
