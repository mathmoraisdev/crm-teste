// src/lib/money.ts

/**
 * "R$ 1.299,90" | "129,90" | "129.90" | "150" -> centavos (Int).
 * Aceita vírgula OU ponto como decimal; ponto como milhar quando há vírgula.
 * Retorna null para vazio/ inválido/ negativo (lançamento não aceita negativo).
 */
export function parseBRLToCents(raw: string): number | null {
  const s = raw.replace(/[R$\s]/g, "");
  if (!s) return null;
  // Se tem vírgula, ela é o decimal e ponto é milhar: "1.299,90" -> "1299.90".
  // Senão, ponto (se houver) já é o decimal: "129.90" -> "129.90".
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(parseFloat(normalized) * 100);
  return Number.isFinite(cents) && cents >= 0 ? cents : null;
}

/** centavos (Int) -> "R$ 129,90" (pt-BR). */
export function formatCentsBRL(cents: number): string {
  // Intl pode usar espaço não-quebrável (U+00A0/U+202F) entre "R$" e o número
  // dependendo da versão do ICU; normalizamos p/ espaço comum (determinístico).
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(cents / 100)
    .replace(/[  ]/g, " ");
}
