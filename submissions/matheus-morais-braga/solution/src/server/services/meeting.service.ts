import { prisma } from "@/server/db/client";
import type { MeetingStatus } from "@prisma/client";

export interface AgendaItem {
  id: string;
  status: MeetingStatus;
  scheduledAt: string | null; // ISO (CONFIRMED)
  proposedSlots: string[]; // ISO[] (PROPOSED ainda sem confirmação)
  meetingLink: string | null;
  createdAt: string; // ISO
  lead: { id: string; name: string; phone: string };
}

/**
 * Agenda do usuário: todos os compromissos (Meeting) dos seus leads, com o lead
 * embutido. Scoping por dono via `lead.userId` (Meeting não tem userId próprio).
 *
 * Ordem: CONFIRMED pelo horário marcado (próximos primeiro); os demais
 * (PROPOSED/CANCELLED, sem `scheduledAt`) caem no fim por data de criação.
 */
export async function listMeetings(userId: string): Promise<AgendaItem[]> {
  const meetings = await prisma.meeting.findMany({
    where: { lead: { userId } },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      status: true,
      scheduledAt: true,
      proposedSlots: true,
      meetingLink: true,
      createdAt: true,
      lead: { select: { id: true, name: true, phone: true } },
    },
  });

  return meetings.map((m) => ({
    id: m.id,
    status: m.status,
    scheduledAt: m.scheduledAt ? m.scheduledAt.toISOString() : null,
    proposedSlots: Array.isArray(m.proposedSlots)
      ? (m.proposedSlots as string[])
      : [],
    meetingLink: m.meetingLink,
    createdAt: m.createdAt.toISOString(),
    lead: m.lead,
  }));
}
