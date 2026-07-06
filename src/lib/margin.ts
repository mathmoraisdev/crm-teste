/** Margem em centavos de uma linha: (preço − custo) × qtd. Custo ausente conta como 0. */
export function marginCents(i: { priceCents: number; costCents: number | null; quantity: number }): number {
  return (i.priceCents - (i.costCents ?? 0)) * i.quantity;
}
/** Margem sobre a receita em pontos-base (inteiro). Receita 0 → 0 (guarda divisão). */
export function marginBps(i: { revenueCents: number; costCents: number }): number {
  if (i.revenueCents <= 0) return 0;
  return Math.round(((i.revenueCents - i.costCents) / i.revenueCents) * 10000);
}
/** Valor imobilizado em estoque de um item: saldo × custo. Custo ausente → 0. */
export function itemValueCents(i: { stockQty: number; costCents: number | null }): number {
  return i.stockQty * (i.costCents ?? 0);
}
