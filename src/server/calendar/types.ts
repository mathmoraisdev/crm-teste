/**
 * Interface da camada Calendar. Igual à de WhatsApp: os services dependem da
 * interface, e a factory resolve mock ↔ google-calendar por env.
 */
export interface CreatedEvent {
  eventId: string;
  meetingLink: string | null;
  scheduledAt: string; // ISO
}

export interface CalendarService {
  readonly mode: "mock" | "google-calendar";
  /** Retorna horários livres (ISO) para propor ao lead. */
  getAvailability(opts?: { count?: number }): Promise<string[]>;
  /** Cria o evento da reunião e devolve id + link. */
  createEvent(opts: {
    leadName: string;
    startIso: string;
    durationMinutes?: number;
  }): Promise<CreatedEvent>;
}

/**
 * Gera horários comerciais a partir de amanhã (10h/14h/16h, dias úteis).
 * Compartilhado entre mock e fallback — determinístico o suficiente p/ demo.
 */
export function businessSlots(count: number): string[] {
  const slots: string[] = [];
  const hours = [10, 14, 16];
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + 1); // a partir de amanhã

  while (slots.length < count) {
    const dow = day.getDay();
    if (dow !== 0 && dow !== 6) {
      for (const h of hours) {
        const slot = new Date(day);
        slot.setHours(h, 0, 0, 0);
        slots.push(slot.toISOString());
        if (slots.length >= count) break;
      }
    }
    day.setDate(day.getDate() + 1);
  }
  return slots;
}
