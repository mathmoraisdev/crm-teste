import { businessSlots, type CalendarService } from "./types";

/**
 * Calendar mock: disponibilidade sintética (dias úteis 10/14/16h) e eventos
 * "criados" em memória com link fake. Permite rodar o agendamento ponta a
 * ponta sem conta Google.
 */
let counter = 0;

export function createMockCalendar(): CalendarService {
  return {
    mode: "mock",
    async getAvailability(opts) {
      return businessSlots(opts?.count ?? 3);
    },
    async createEvent({ startIso }) {
      const id = `mock-evt-${Date.now()}-${++counter}`;
      console.log(`[calendar:mock] evento criado para ${startIso} (${id})`);
      return {
        eventId: id,
        meetingLink: `https://meet.mock.local/${id}`,
        scheduledAt: startIso,
      };
    },
  };
}
