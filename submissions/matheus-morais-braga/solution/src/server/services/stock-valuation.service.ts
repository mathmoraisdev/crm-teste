import { prisma } from "@/server/db/client";
import { itemValueCents, marginBps } from "@/lib/margin";

export interface StockValuationItem {
  id: string; name: string; stockQty: number; costCents: number | null;
  priceCents: number; valueCents: number; marginBps: number;
}
export interface StockValuation {
  totalValueCents: number; withoutCostCount: number; items: StockValuationItem[];
}

/** Valor imobilizado no estoque rastreado da conta + margem potencial por item. */
export async function stockValuation(accountId: string): Promise<StockValuation> {
  const rows = await prisma.catalogItem.findMany({
    where: { accountId, trackStock: true },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, stockQty: true, costCents: true, priceCents: true },
  });
  let totalValueCents = 0;
  let withoutCostCount = 0;
  const items = rows.map((r) => {
    const valueCents = itemValueCents(r);
    totalValueCents += valueCents;
    if (r.costCents == null) withoutCostCount++;
    return {
      id: r.id, name: r.name, stockQty: r.stockQty, costCents: r.costCents, priceCents: r.priceCents,
      valueCents, marginBps: marginBps({ revenueCents: r.priceCents, costCents: r.costCents ?? 0 }),
    };
  });
  return { totalValueCents, withoutCostCount, items };
}
