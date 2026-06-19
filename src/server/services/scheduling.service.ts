import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { formatSlot } from "@/lib/utils";
import { getCalendar } from "@/server/calendar";
import { interpretSlotChoice } from "@/server/ai/conversation.agent";
import { getAiClient } from "@/server/ai/resolve";
import { sendWhatsAppMessage } from "./messaging";

const TZ = env.SCHEDULING_TIMEZONE;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * Subfluxo de agendamento — proposta de horários.
 * Busca disponibilidade no Calendar, cria/atualiza a reunião como PROPOSED com
 * os slots e envia a mensagem com as opções numeradas no WhatsApp.
 */
export async function proposeSlots(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;

  const cal = getCalendar();
  const slots = (await cal.getAvailability({ count: 3 })).slice(0, 3);

  await prisma.meeting.upsert({
    where: { leadId },
    create: { leadId, status: "PROPOSED", proposedSlots: slots },
    update: {
      status: "PROPOSED",
      proposedSlots: slots,
      scheduledAt: null,
      calendarEventId: null,
      meetingLink: null,
    },
  });

  const lines = slots
    .map((iso, i) => `${i + 1}) ${formatSlot(iso, TZ)}`)
    .join("\n");

  await sendWhatsAppMessage(
    lead,
    `Show, ${firstName(lead.name)}! Vamos marcar uma conversa rápida. Tenho estes horários:\n${lines}\n\nÉ só me dizer o número que fica melhor. 😊`,
  );
}

/**
 * Subfluxo de agendamento — interpretação do aceite.
 * Recebe a resposta do lead, identifica o horário escolhido (IA), cria o evento
 * no Calendar, marca a reunião como CONFIRMED, o lead como REUNIAO_AGENDADA e
 * envia a confirmação. Se não entender, repropõe os mesmos horários.
 */
export async function interpretAndBook(
  leadId: string,
  leadMessage: string,
): Promise<{ booked: boolean }> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { meeting: true },
  });
  if (!lead?.meeting || lead.meeting.status !== "PROPOSED") {
    return { booked: false };
  }

  const slots = (lead.meeting.proposedSlots as string[]) ?? [];
  const formatted = slots.map((iso) => formatSlot(iso, TZ));

  // BYOK: resolve o AiClient do dono do lead (chave própria ou fallback da plataforma).
  const ai = await getAiClient(lead.userId);
  const choice = await interpretSlotChoice({
    ai,
    formattedSlots: formatted,
    leadMessage,
  });

  const idx = choice.chosenIndex;
  if (idx === null || !choice.confident || idx < 0 || idx >= slots.length) {
    const lines = formatted.map((s, i) => `${i + 1}) ${s}`).join("\n");
    await sendWhatsAppMessage(
      lead,
      `Só pra confirmar, qual desses fica melhor pra você?\n${lines}`,
    );
    return { booked: false };
  }

  const startIso = slots[idx];
  const cal = getCalendar();
  const event = await cal.createEvent({ leadName: lead.name, startIso });

  await prisma.meeting.update({
    where: { leadId },
    data: {
      status: "CONFIRMED",
      scheduledAt: new Date(event.scheduledAt),
      calendarEventId: event.eventId,
      meetingLink: event.meetingLink,
    },
  });
  await prisma.lead.update({
    where: { id: leadId },
    data: { status: "REUNIAO_AGENDADA" },
  });

  const linkLine = event.meetingLink ? `\nLink: ${event.meetingLink}` : "";
  await sendWhatsAppMessage(
    lead,
    `Perfeito! Reunião confirmada para ${formatSlot(startIso, TZ)}.${linkLine}\nAté lá! 🎉`,
  );

  return { booked: true };
}
