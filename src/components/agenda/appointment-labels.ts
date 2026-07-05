import type { Tone } from "@/components/ui/Badge";

export type AppointmentStatus = "AGENDADO" | "CONFIRMADO" | "REALIZADO" | "FALTOU" | "CANCELADO";

export const APPT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  AGENDADO: "Agendado",
  CONFIRMADO: "Confirmado",
  REALIZADO: "Realizado",
  FALTOU: "Faltou",
  CANCELADO: "Cancelado",
};

export const APPT_STATUS_TONE: Record<AppointmentStatus, Tone> = {
  AGENDADO: "amber",
  CONFIRMADO: "green",
  REALIZADO: "slate",
  FALTOU: "red",
  CANCELADO: "red",
};

/** Shape serializado (via fetch) de um item de `listAppointments`. */
export interface AppointmentDTO {
  id: string;
  leadId: string;
  catalogItemId: string | null;
  serviceName: string | null;
  scheduledAt: string; // ISO
  status: AppointmentStatus;
  note: string | null;
  seriesId: string | null;
  orderId: string | null;
  lead: { id: string; name: string; phone: string };
  catalogItem: { id: string; name: string } | null;
}
