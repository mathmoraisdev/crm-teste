import type { Tone } from "@/components/ui/Badge";

export type AppointmentStatus = "AGENDADO" | "CONFIRMADO" | "REALIZADO" | "FALTOU" | "CANCELADO";

export type AppointmentSource = "MANUAL" | "ONLINE" | "IA";

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
  leadId: string | null; // null = walk-in (sem cadastro)
  accountId: string | null; // preenchido no walk-in (scoping por conta)
  catalogItemId: string | null;
  serviceName: string | null;
  durationMinutes: number | null;
  scheduledAt: string; // ISO
  status: AppointmentStatus;
  source: AppointmentSource; // origem: MANUAL (equipe) x ONLINE (link público)
  note: string | null;
  seriesId: string | null;
  orderId: string | null;
  needsReview: boolean;
  reviewReason: string | null;
  professionalId: string | null;
  customerName: string | null; // walk-in: nome livre
  customerPhone: string | null; // walk-in: telefone opcional
  lead: { id: string; name: string; phone: string } | null; // null = walk-in
  professional: { id: string; name: string; color: string } | null;
  catalogItem: { id: string; name: string } | null;
}

/** Nome de exibição: do lead quando há, senão o nome livre do walk-in, senão genérico. */
export function apptDisplayName(a: Pick<AppointmentDTO, "lead" | "customerName">): string {
  return a.lead?.name ?? a.customerName ?? "Cliente";
}
