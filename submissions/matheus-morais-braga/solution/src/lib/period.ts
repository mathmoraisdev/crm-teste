// src/lib/period.ts
/** "2026-06" -> [00:00 do dia 1, 00:00 do dia 1 do mês seguinte). UTC. */
export function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  return { from, to };
}
/** "YYYY-MM" do mês atual (para default do filtro). */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
