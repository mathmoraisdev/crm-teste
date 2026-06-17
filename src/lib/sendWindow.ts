/** Hora (0–23) de uma data num fuso específico, via Intl (determinístico). */
export function hourInTz(date: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    timeZone,
  }).format(date);
  return parseInt(h, 10) % 24;
}

export interface WindowOpts {
  startHour: number; // inclusivo
  endHour: number;   // exclusivo
}

/** A hora informada está dentro da janela [startHour, endHour)? */
export function isWithinWindow(hour: number, opts: WindowOpts): boolean {
  return hour >= opts.startHour && hour < opts.endHour;
}

/** Jitter aleatório em ms (NÃO testado — usado só no worker p/ humanizar o ritmo). */
export function jitterMs(maxMs: number): number {
  return Math.floor(Math.random() * maxMs);
}
