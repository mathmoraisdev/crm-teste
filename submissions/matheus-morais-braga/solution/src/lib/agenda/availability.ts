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

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * "Relógio de parede" (ano/mês/dia/hora/min/seg, mês 1-based) que um instante UTC
 * mostra no timeZone, MAIS o weekday. Base compartilhada de zonedWallTimeToUtc e
 * enumerateLocalDates. PURA via Intl.DateTimeFormat.
 */
function zonedParts(
  date: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_MAP[get("weekday")] ?? 0,
  };
}

/**
 * Inverso de `localWeekdayAndMinutes`: dado um "relógio de parede" local
 * (ano/mês/dia — mês 1-based — + minuto do dia) NAQUELE fuso, devolve o instante
 * `Date` (UTC) correspondente. Mede o offset do fuso via Intl e corrige DUAS vezes
 * (segurança em transição de DST — não hardcoda -03:00; vale p/ qualquer fuso).
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  // Alvo: o relógio de parede desejado, lido como se fosse UTC.
  const targetWallMs = Date.UTC(year, month - 1, day, hour, minute);

  // Offset (ms a somar ao UTC p/ obter a parede) num dado instante.
  const offsetAt = (utcMs: number): number => {
    const p = zonedParts(new Date(utcMs), timeZone);
    const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return wallAsUtc - utcMs;
  };

  // Chute assumindo UTC, depois corrige o offset duas vezes.
  let utc = targetWallMs;
  utc = targetWallMs - offsetAt(utc);
  utc = targetWallMs - offsetAt(utc);
  return new Date(utc);
}

export interface LocalDate {
  year: number; // 1-based no calendário (ex.: 2026)
  month: number; // 1-based (janeiro = 1)
  day: number;
  weekday: number; // 0=Domingo..6=Sábado
}

/**
 * Lista os dias-calendário DO FUSO cujo início (00:00 local) cai em
 * [fromUtc, toUtc) — MEIO-ABERTO: inclui `fromUtc`, exclui `toUtc`. Assim, passar
 * `[meia-noite do dia, meia-noite do dia seguinte)` rende exatamente UM dia (a
 * meia-noite seguinte, igual a `toUtc`, fica de fora). Caminha de dia em dia
 * normalizando cada meia-noite via `zonedWallTimeToUtc` — não confia em +24h ingênuo.
 */
export function enumerateLocalDates(
  fromUtc: Date,
  toUtc: Date,
  timeZone: string,
): LocalDate[] {
  const out: LocalDate[] = [];
  if (toUtc.getTime() <= fromUtc.getTime()) return out;

  // Meia-noite local do dia que contém fromUtc (pode cair antes de fromUtc).
  const first = zonedParts(fromUtc, timeZone);
  let midnight = zonedWallTimeToUtc(first.year, first.month, first.day, 0, timeZone);

  // Teto de segurança: nº de dias no intervalo + folga (evita loop infinito).
  const maxDays = Math.ceil((toUtc.getTime() - fromUtc.getTime()) / 86_400_000) + 2;
  for (let i = 0; i <= maxDays && midnight.getTime() < toUtc.getTime(); i++) {
    if (midnight.getTime() >= fromUtc.getTime()) {
      const p = zonedParts(midnight, timeZone);
      out.push({ year: p.year, month: p.month, day: p.day, weekday: p.weekday });
    }
    // Avança ~25h (passa qualquer transição de DST) e re-normaliza p/ a próxima
    // meia-noite local do dia seguinte.
    const probe = zonedParts(new Date(midnight.getTime() + 25 * 60 * 60 * 1000), timeZone);
    midnight = zonedWallTimeToUtc(probe.year, probe.month, probe.day, 0, timeZone);
  }
  return out;
}

export interface DaySlotOpts {
  date: { year: number; month: number; day: number }; // dia-calendário local (mês 1-based)
  timeZone: string;
  windows: DayWindow[]; // expediente do dia
  busy: { start: Date; end: Date }[]; // ocupados (UTC) do profissional nesse dia
  durationMinutes: number; // duração do serviço (>0)
  stepMinutes: number; // grade (bookingSlotStep)
  notBefore: Date; // piso de antecedência (agora + bookingLeadMinutes), UTC
}

/**
 * PURA: gera os horários de início LIVRES do dia. Para cada janela, varre inícios
 * candidatos de `startMinute` até `endMinute - duração`, de `stepMinutes` em
 * `stepMinutes`, converte cada um p/ UTC via `zonedWallTimeToUtc` e MANTÉM o slot
 * sse: cabe inteiro na janela e fora da pausa (`isWithinWorkingHours` no par
 * [start, start+dur]), `slotStart >= notBefore`, e NÃO sobrepõe nenhum `busy`
 * (`overlaps` + `appointmentEnd`). Ordena crescente e deduplica entre janelas.
 */
export function computeDaySlots(opts: DaySlotOpts): Date[] {
  const { date, timeZone, windows, busy, durationMinutes, stepMinutes, notBefore } = opts;
  if (durationMinutes <= 0 || stepMinutes <= 0 || windows.length === 0) return [];

  const seen = new Set<number>();
  const slots: Date[] = [];

  for (const w of windows) {
    // Último início possível: o slot precisa terminar até endMinute.
    const lastStart = w.endMinute - durationMinutes;
    for (let startMin = w.startMinute; startMin <= lastStart; startMin += stepMinutes) {
      const slotEndMin = startMin + durationMinutes;
      // Cabe na janela E fora da pausa (a mesma regra do fluxo interno).
      if (!isWithinWorkingHours(startMin, slotEndMin, [w])) continue;

      const slotStart = zonedWallTimeToUtc(date.year, date.month, date.day, startMin, timeZone);
      if (slotStart.getTime() < notBefore.getTime()) continue;

      const slotEnd = appointmentEnd(slotStart, durationMinutes);
      const collides = busy.some((b) => overlaps(slotStart, slotEnd, b.start, b.end));
      if (collides) continue;

      const key = slotStart.getTime();
      if (seen.has(key)) continue;
      seen.add(key);
      slots.push(slotStart);
    }
  }

  slots.sort((a, b) => a.getTime() - b.getTime());
  return slots;
}
