import { env } from "@/lib/env";
import type { CalendarService } from "./types";
import { createMockCalendar } from "./mock";
import { createGoogleCalendar } from "./google-calendar";

/** Factory + singleton da camada Calendar, resolvida por CALENDAR_MODE. */
let instance: CalendarService | null = null;

export function getCalendar(): CalendarService {
  if (instance) return instance;
  instance =
    env.CALENDAR_MODE === "google-calendar"
      ? createGoogleCalendar()
      : createMockCalendar();
  return instance;
}

export type { CalendarService, CreatedEvent } from "./types";
