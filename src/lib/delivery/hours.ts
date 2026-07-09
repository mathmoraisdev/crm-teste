import type { DeliveryHours } from "@/server/services/delivery-settings.service";

/**
 * Loja aberta se `now` (no fuso dado) cai em alguma janela do dia da semana.
 * `hours` null → sempre aberta (conta não configurou horário).
 *
 * O dia da semana e o horário são derivados do fuso `tz` (não do UTC nem do
 * cliente), para bater com o expediente real do estabelecimento. Limite inicial
 * inclusivo, final exclusivo (close = horário de fechar).
 */
export function isStoreOpen(hours: DeliveryHours | null, now: Date, tz: string): boolean {
  if (!hours) return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const wdMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const wd = wdMap[parts.find((p) => p.type === "weekday")!.value] ?? 0;
  const hh = parts.find((p) => p.type === "hour")!.value;
  const mm = parts.find((p) => p.type === "minute")!.value;
  // hour12:false pode devolver "24" na meia-noite em alguns ICU; normaliza p/ "00".
  const cur = `${hh === "24" ? "00" : hh}:${mm}`;
  const windows = hours[String(wd)] ?? [];
  return windows.some((w) => w.open <= cur && cur < w.close);
}
