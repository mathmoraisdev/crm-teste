export type FulfillMode = "DELIVERY" | "RETIRADA";

export interface CartLine {
  id: string;
  priceCents: number;
  qty: number;
}

/** Subtotal + taxa + total do carrinho. Taxa só incide em DELIVERY com itens. */
export function computeCartTotals(lines: CartLine[], opts: { mode: FulfillMode; feeCents: number }) {
  const subtotalCents = lines.reduce((s, l) => s + l.priceCents * Math.max(1, l.qty), 0);
  const feeCents = subtotalCents > 0 && opts.mode === "DELIVERY" ? Math.max(0, opts.feeCents) : 0;
  return { subtotalCents, feeCents, totalCents: subtotalCents + feeCents };
}
