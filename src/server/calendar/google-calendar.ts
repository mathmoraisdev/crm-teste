import { google } from "googleapis";
import { env } from "@/lib/env";
import { businessSlots, type CalendarService } from "./types";

/**
 * Implementação real via Google Calendar (service account / JWT).
 * Pronta e selecionável por env (CALENDAR_MODE=google-calendar). Credenciais
 * validadas de forma preguiçosa, para o modo mock subir sem conta Google.
 *
 * Disponibilidade: parte dos slots comerciais e filtra os que colidem com
 * eventos existentes (freebusy).
 */
export function createGoogleCalendar(): CalendarService {
  if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new Error(
      "CALENDAR_MODE=google-calendar exige GOOGLE_CLIENT_EMAIL e GOOGLE_PRIVATE_KEY no .env",
    );
  }

  const auth = new google.auth.JWT({
    email: env.GOOGLE_CLIENT_EMAIL,
    key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  const calendar = google.calendar({ version: "v3", auth });
  const calendarId = env.GOOGLE_CALENDAR_ID;

  return {
    mode: "google-calendar",
    async getAvailability(opts) {
      const candidates = businessSlots((opts?.count ?? 3) * 3);
      const timeMin = candidates[0];
      const timeMax = new Date(
        new Date(candidates[candidates.length - 1]).getTime() + 60 * 60 * 1000,
      ).toISOString();

      const fb = await calendar.freebusy.query({
        requestBody: { timeMin, timeMax, items: [{ id: calendarId }] },
      });
      const busy = fb.data.calendars?.[calendarId]?.busy ?? [];

      const free = candidates.filter((iso) => {
        const start = new Date(iso).getTime();
        const end = start + 30 * 60 * 1000;
        return !busy.some((b) => {
          const bs = new Date(b.start!).getTime();
          const be = new Date(b.end!).getTime();
          return start < be && end > bs;
        });
      });

      return free.slice(0, opts?.count ?? 3);
    },

    async createEvent({ leadName, startIso, durationMinutes = 30 }) {
      const end = new Date(
        new Date(startIso).getTime() + durationMinutes * 60 * 1000,
      ).toISOString();

      const res = await calendar.events.insert({
        calendarId,
        conferenceDataVersion: 1,
        requestBody: {
          summary: `Reunião — ${leadName}`,
          description: "Reunião agendada automaticamente pelo Mini CRM de IA.",
          start: { dateTime: startIso, timeZone: env.SCHEDULING_TIMEZONE },
          end: { dateTime: end, timeZone: env.SCHEDULING_TIMEZONE },
          conferenceData: {
            createRequest: {
              requestId: `crm-${Date.now()}`,
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        },
      });

      return {
        eventId: res.data.id ?? `gcal-${Date.now()}`,
        meetingLink: res.data.hangoutLink ?? res.data.htmlLink ?? null,
        scheduledAt: startIso,
      };
    },
  };
}
