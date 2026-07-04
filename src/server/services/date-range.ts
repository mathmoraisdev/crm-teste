// Fuso do projeto (Brasil não tem mais horário de verão → offset fixo -03:00).
// Hardcoded como no resto do código (utils.formatSlot, conversation.agent) —
// evita acoplar este helper puro à validação eager de `@/lib/env`.
const TZ = "America/Sao_Paulo";

export type ReportPeriod = "hoje" | "7d" | "mes";

/** Deslocamento (ms) do fuso `tz` em relação ao UTC no instante `date`. */
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
  return asUTC - date.getTime();
}

/** Partes de calendário (ano/mês/dia) do instante `date` no fuso `tz`. */
function tzParts(date: Date, tz: string): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  return { year: +map.year, month: +map.month, day: +map.day };
}

/** Instante UTC correspondente à meia-noite local (fuso `tz`) de um dado dia. */
function zonedMidnight(year: number, month: number, day: number, tz: string): Date {
  // Constrói a "hora de parede" como se fosse UTC e subtrai o offset do fuso.
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const off = tzOffsetMs(guess, tz);
  return new Date(guess.getTime() - off);
}

/**
 * Resolve `from`/`to` de um período, alinhado ao calendário no fuso do projeto
 * (America/Sao_Paulo). `to` é sempre o instante `now`.
 *   hoje → início do dia local até agora
 *   7d   → início do dia 6 dias atrás (últimos 7 dias) até agora
 *   mes  → início do mês local até agora
 */
export function resolvePeriod(period: ReportPeriod, now = new Date()): { from: Date; to: Date } {
  const { year, month, day } = tzParts(now, TZ);
  const startOfToday = zonedMidnight(year, month, day, TZ);
  if (period === "mes") {
    return { from: zonedMidnight(year, month, 1, TZ), to: now };
  }
  if (period === "7d") {
    return { from: new Date(startOfToday.getTime() - 6 * 24 * 3600_000), to: now };
  }
  return { from: startOfToday, to: now };
}
