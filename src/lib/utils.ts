/**
 * Helpers de UI/formatação sem dependências externas.
 */

/** Concatena classes condicionalmente (mini `clsx`). */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/** Formata uma data para pt-BR curto: 17/06 14:32 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "há 5 min", "há 2 h", "há 3 d" — tempo relativo simples. */
export function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "agora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} d`;
}

/** Formata um datetime ISO para um horário legível de agendamento. */
export function formatSlot(iso: string, timeZone = "America/Sao_Paulo"): string {
  return new Date(iso).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

/** Cabeçalho de dia p/ cartão de agenda: "Quarta, 02/04" (sem o "-feira"). */
export function formatSlotDay(iso: string, timeZone = "America/Sao_Paulo"): string {
  const d = new Date(iso);
  const weekday = d.toLocaleDateString("pt-BR", { weekday: "long", timeZone }).split("-")[0];
  const dayMonth = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${dayMonth}`;
}

/** Só o horário do slot: "14:00". */
export function formatSlotTime(iso: string, timeZone = "America/Sao_Paulo"): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

/** Chave estável do dia local (YYYY-MM-DD no fuso) — p/ agrupar slots por dia. */
export function localDayKey(iso: string, timeZone = "America/Sao_Paulo"): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone });
}
