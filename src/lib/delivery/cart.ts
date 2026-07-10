export type FulfillMode = "DELIVERY" | "RETIRADA";

export interface CartLine {
  id: string;
  priceCents: number;
  qty: number;
}

/** Uma linha do carrinho do cardápio: item + seleção de adicionais (onda-N). Itens
 * iguais com a MESMA seleção fundem numa linha só (ver cartEntryKey). */
export interface CartEntry {
  key: string;
  catalogItemId: string;
  name: string;
  basePriceCents: number;
  optionIds: string[];
  chosen: { optionName: string; priceDeltaCents: number }[]; // p/ exibir + somar
  quantity: number;
}

/** Preço unitário da linha = base + Σ deltas dos adicionais escolhidos. */
export function entryUnitPriceCents(e: CartEntry): number {
  return e.basePriceCents + e.chosen.reduce((s, c) => s + c.priceDeltaCents, 0);
}

/** Identidade da linha: mesmo item + mesma seleção → mesma chave (funde). Sem
 * adicionais, a chave é o próprio catalogItemId (retrocompat com o carrinho antigo). */
export function cartEntryKey(catalogItemId: string, optionIds: string[]): string {
  return optionIds.length ? `${catalogItemId}:${[...optionIds].sort().join(",")}` : catalogItemId;
}

/** Subtotal + taxa + total do carrinho. Taxa só incide em DELIVERY com itens. */
export function computeCartTotals(lines: CartLine[], opts: { mode: FulfillMode; feeCents: number }) {
  const subtotalCents = lines.reduce((s, l) => s + l.priceCents * Math.max(1, l.qty), 0);
  const feeCents = subtotalCents > 0 && opts.mode === "DELIVERY" ? Math.max(0, opts.feeCents) : 0;
  return { subtotalCents, feeCents, totalCents: subtotalCents + feeCents };
}
