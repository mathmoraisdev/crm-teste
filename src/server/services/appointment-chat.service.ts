import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { formatSlot } from "@/lib/utils";
import { interpretSlotChoice } from "@/server/ai/conversation.agent";
import { getAiClient } from "@/server/ai/resolve";
import { resolveAiModelForUser } from "@/server/services/entitlements";
import {
  confirmBooking,
  getAvailableSlots,
  listBookableServices,
} from "./booking-availability.service";
import { sendWhatsAppMessage } from "./messaging";

/**
 * Agendamento in-chat REAL: religa a tool `agendar` na Agenda Pro (serviço +
 * profissional + expediente + conflito), no lugar do fluxo antigo de `Meeting`/
 * calendário mock. Reaproveita o registro `Meeting` (1:1 com o lead) só como store
 * da proposta pendente — `proposedSlots` guarda OBJETOS ricos (discriminador de
 * forma que separa este fluxo do antigo, baseado em strings ISO). Nada de schema
 * novo; toda a lógica de disponibilidade/criação vive nos serviços da Agenda Pro.
 */

const TZ = env.SCHEDULING_TIMEZONE;
const DAY_MS = 24 * 60 * 60 * 1000;
// Janela pedida ao motor de disponibilidade — ele CLAMPA ao `bookingHorizonDays`
// da conta, então isto é só um teto amplo p/ não enumerar dias além do necessário.
const HORIZON_REQUEST_DAYS = 60;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Slot rico guardado em `Meeting.proposedSlots` (objeto = discriminador do fluxo novo). */
export interface AppointmentProposedSlot {
  startISO: string;
  professionalId: string;
  professionalName: string;
  serviceId: string;
  serviceName: string;
}

/** True se `proposedSlots` está na forma nova (objetos), não strings ISO do fluxo antigo. */
export function isAppointmentSlots(slots: unknown): slots is AppointmentProposedSlot[] {
  return (
    Array.isArray(slots) &&
    slots.length > 0 &&
    typeof slots[0] === "object" &&
    slots[0] !== null &&
    "startISO" in (slots[0] as object)
  );
}

/** Link público de autoatendimento da conta (null quando desligado/sem slug). */
async function bookingUrlFor(accountId: string): Promise<string | null> {
  const acct = await prisma.user.findUnique({
    where: { id: accountId },
    select: { publicSlug: true, bookingEnabled: true },
  });
  return acct?.bookingEnabled && acct.publicSlug
    ? `${env.APP_URL}/agendar/${acct.publicSlug}`
    : null;
}

/**
 * Propõe horários REAIS da Agenda Pro pelo chat: pega os 3 primeiros livres do
 * serviço (com profissional específico ou "sem preferência"), grava-os como
 * `Meeting` PROPOSED (objetos ricos) e envia a mensagem numerada. Sem horário no
 * horizonte → mensagem de fallback (oferece o link se houver) e NÃO cria proposta.
 * Serviço/profissional inválido → o motor lança mensagem legível, que devolvemos.
 */
export async function proposeAppointmentSlots(
  leadId: string,
  accountId: string,
  input: { serviceId: string; professionalId?: string | null },
): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;

  const services = await listBookableServices(accountId);
  const service = services.find((s) => s.id === input.serviceId);
  if (!service) {
    await sendWhatsAppMessage(lead, "Não encontrei esse serviço para agendar. Pode me dizer de novo qual você quer?");
    return;
  }

  const now = new Date();
  let slots;
  try {
    slots = await getAvailableSlots(accountId, {
      catalogItemId: input.serviceId,
      professionalId: input.professionalId ?? null,
      fromUtc: now,
      toUtc: new Date(now.getTime() + HORIZON_REQUEST_DAYS * DAY_MS),
    });
  } catch (e) {
    // Ex.: profissional inválido / serviço sem duração — mensagem legível ao cliente.
    await sendWhatsAppMessage(lead, e instanceof Error ? e.message : "Não consegui buscar horários agora.");
    return;
  }

  const top = slots.slice(0, 3);
  if (top.length === 0) {
    const url = await bookingUrlFor(accountId);
    const linkLine = url ? ` Se preferir, dá pra ver a agenda completa aqui: ${url}` : "";
    await sendWhatsAppMessage(
      lead,
      `Não achei horário disponível para ${service.name} nos próximos dias.${linkLine}`,
    );
    return;
  }

  const proposed: AppointmentProposedSlot[] = top.map((s) => ({
    startISO: s.startISO,
    professionalId: s.professionalId,
    professionalName: s.professionalName,
    serviceId: service.id,
    serviceName: service.name,
  }));

  // `proposedSlots` é Json; o array de objetos ricos precisa do cast p/ InputJsonValue.
  const proposedJson = proposed as unknown as Prisma.InputJsonValue;
  await prisma.meeting.upsert({
    where: { leadId },
    create: { leadId, status: "PROPOSED", proposedSlots: proposedJson },
    update: {
      status: "PROPOSED",
      proposedSlots: proposedJson,
      scheduledAt: null,
      calendarEventId: null,
      meetingLink: null,
    },
  });

  const lines = proposed
    .map((s, i) => `${i + 1}) ${formatSlot(s.startISO, TZ)} — ${s.professionalName}`)
    .join("\n");
  await sendWhatsAppMessage(
    lead,
    `Show, ${firstName(lead.name)}! Para ${service.name}, tenho estes horários:\n${lines}\n\nÉ só me dizer o número que fica melhor. 😊`,
  );
}

/**
 * Interpreta a escolha do cliente sobre uma proposta de Agenda Pro (Meeting
 * PROPOSED com slots-objeto) e confirma via `confirmBooking` — a MESMA trava
 * anti-corrida e criação do link público. `confirmBooking` já envia a confirmação
 * ao lead com chip, então NÃO duplicamos a mensagem no sucesso. CONFLICT: → repropõe
 * horários frescos. Não confiante → pede p/ reconfirmar. Não mexe em `lead.status`
 * (REUNIAO_AGENDADA é do funil de venda; aqui é serviço).
 */
export async function interpretAndBookAppointment(
  leadId: string,
  leadMessage: string,
): Promise<{ booked: boolean }> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { meeting: true },
  });
  if (!lead?.meeting || lead.meeting.status !== "PROPOSED") return { booked: false };
  if (!isAppointmentSlots(lead.meeting.proposedSlots)) return { booked: false };

  const slots = lead.meeting.proposedSlots as AppointmentProposedSlot[];
  const formatted = slots.map((s) => `${formatSlot(s.startISO, TZ)} — ${s.professionalName}`);

  // BYOK: mesmo padrão do fluxo antigo — modelo do número clampado pelo plano.
  const num = lead.whatsAppNumberId
    ? await prisma.whatsAppNumber.findUnique({
        where: { id: lead.whatsAppNumberId },
        select: { aiModel: true },
      })
    : null;
  const effectiveModel = await resolveAiModelForUser(lead.userId, num?.aiModel ?? null);
  const ai = await getAiClient(lead.userId, effectiveModel ?? undefined);
  const choice = await interpretSlotChoice({ ai, formattedSlots: formatted, leadMessage });

  const idx = choice.chosenIndex;
  if (idx === null || !choice.confident || idx < 0 || idx >= slots.length) {
    const lines = formatted.map((s, i) => `${i + 1}) ${s}`).join("\n");
    await sendWhatsAppMessage(lead, `Só pra confirmar, qual desses fica melhor pra você?\n${lines}`);
    return { booked: false };
  }

  const chosen = slots[idx];
  try {
    await confirmBooking(lead.userId, {
      catalogItemId: chosen.serviceId,
      professionalId: chosen.professionalId,
      startISO: chosen.startISO,
      customerName: lead.name,
      customerPhone: lead.phone,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.startsWith("CONFLICT:")) {
      // Slot tomado no meio: repropõe horários frescos do MESMO serviço, sem travar
      // no profissional daquele slot (reabre amplo p/ o cliente ter mais opções).
      await proposeAppointmentSlots(leadId, lead.userId, { serviceId: chosen.serviceId });
      return { booked: false };
    }
    await sendWhatsAppMessage(lead, "Não consegui concluir o agendamento agora. Pode tentar de novo?");
    return { booked: false };
  }

  // Sucesso: encerra a proposta. `confirmBooking` já mandou a confirmação ao lead.
  await prisma.meeting.update({ where: { leadId }, data: { status: "CONFIRMED" } });
  return { booked: true };
}
