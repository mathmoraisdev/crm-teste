// src/lib/commission.ts — cálculo PURO de comissão (sem DB). Espelha a disciplina
// de orderTotalCents: número derivado de entradas inteiras, dinheiro em centavos.

export interface CommissionRuleLite {
  catalogItemId: string | null; // null = regra padrão do profissional
  percentBps: number | null; // pontos-base (4000 = 40,00%)
  fixedCents: number | null; // comissão fixa POR UNIDADE
}

/** Escolhe a regra aplicável a um item: a específica do serviço vence a padrão do
 * profissional (catalogItemId null). Sem regra aplicável → null. PURA. */
export function pickCommissionRule(
  rules: CommissionRuleLite[],
  catalogItemId: string | null,
): CommissionRuleLite | null {
  if (catalogItemId) {
    const specific = rules.find((r) => r.catalogItemId === catalogItemId);
    if (specific) return specific;
  }
  return rules.find((r) => r.catalogItemId === null) ?? null;
}

/** Comissão de uma linha (centavos). percentBps sobre o bruto (unit × qtd);
 * fixedCents POR UNIDADE (× qtd). Sem regra → 0. Nunca negativa. PURA. */
export function commissionForLine(opts: {
  unitPriceCents: number;
  quantity: number;
  rule: CommissionRuleLite | null;
}): number {
  const { rule } = opts;
  if (!rule) return 0;
  if (rule.percentBps != null) {
    const line = opts.unitPriceCents * opts.quantity;
    return Math.max(0, Math.round((line * rule.percentBps) / 10000));
  }
  if (rule.fixedCents != null) {
    return Math.max(0, rule.fixedCents * opts.quantity);
  }
  return 0;
}
