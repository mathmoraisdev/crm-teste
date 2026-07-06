// src/lib/agenda/availability.ts
// Biblioteca PURA de disponibilidade da agenda. Sem DB, sem imports de @/server.
// Toda a lógica de conflito de horário / expediente vive aqui para ser testável
// isoladamente; os serviços apenas montam os intervalos e delegam.

/**
 * Fim do agendamento a partir do início + duração (em minutos).
 * Sem duração (null/undefined) ou duração <= 0 => retorna um instante igual
 * ao início (agendamento pontual, sem janela).
 */
export function appointmentEnd(
  scheduledAt: Date,
  durationMinutes: number | null | undefined,
): Date {
  if (durationMinutes == null || durationMinutes <= 0) {
    return new Date(scheduledAt.getTime());
  }
  return new Date(scheduledAt.getTime() + durationMinutes * 60_000);
}

/**
 * Verdadeiro sse os dois intervalos [start, end) se intersectam.
 * Bordas que apenas se tocam (aEnd === bStart ou bEnd === aStart) NÃO são
 * conflito — o fim é exclusivo.
 */
export function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * Janela de expediente de um dia, em minutos desde 00:00. O intervalo de almoço
 * [breakStart, breakEnd) é opcional e bloqueia horários que o atravessem.
 */
export interface DayWindow {
  startMinute: number;
  endMinute: number;
  breakStart?: number | null;
  breakEnd?: number | null;
}

/**
 * Verdadeiro sse o slot [slotStartMin, slotEndMin] cabe INTEIRO dentro de ao
 * menos uma janela E não intersecta a pausa [breakStart, breakEnd) dessa mesma
 * janela. Sem janelas => false (não há expediente nesse dia).
 */
export function isWithinWorkingHours(
  slotStartMin: number,
  slotEndMin: number,
  windows: DayWindow[],
): boolean {
  for (const w of windows) {
    // Precisa caber inteiro na janela.
    if (slotStartMin < w.startMinute || slotEndMin > w.endMinute) continue;
    // Se há pausa válida, o slot não pode atravessá-la (intervalo [start, end)).
    if (
      w.breakStart != null &&
      w.breakEnd != null &&
      w.breakEnd > w.breakStart
    ) {
      const hitsBreak = slotStartMin < w.breakEnd && w.breakStart < slotEndMin;
      if (hitsBreak) continue;
    }
    return true;
  }
  return false;
}

/**
 * Dia da semana (0=Domingo..6=Sábado) e minuto do dia (hora*60+min) de um
 * instante, projetado no timeZone informado. PURA via Intl.DateTimeFormat.
 */
export function localWeekdayAndMinutes(
  date: Date,
  timeZone: string,
): { weekday: number; minuteOfDay: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayMap[get("weekday")] ?? 0;

  // hour12:false pode render "24" para meia-noite em alguns runtimes; normaliza.
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  const minute = Number(get("minute"));
  const minuteOfDay = hour * 60 + minute;

  return { weekday, minuteOfDay };
}
