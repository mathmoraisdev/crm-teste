import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { formatSlot, formatSlotDay, formatSlotTime, localDayKey } from "@/lib/utils";
import { zonedWallTimeToUtc } from "@/lib/agenda/availability";
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

/**
 * PURA: converte um ISO "de parede" (naive, sem offset — como a IA devolve a
 * preferência de horário do lead) para o instante UTC correspondente NAQUELE fuso,
 * via `zonedWallTimeToUtc` (DST-safe). Aceita data sem hora ("2026-07-15" → 00:00,
 * que vira "o dia a partir da abertura"). Retorna null se não parsear.
 */
export function parsePreferredStart(iso: string, timeZone: string): Date | null {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  const minuteOfDay = Number(hh ?? "0") * 60 + Number(mm ?? "0");
  const dt = zonedWallTimeToUtc(Number(y), Number(mo), Number(d), minuteOfDay, timeZone);
  return Number.isNaN(dt.getTime()) ? null : dt;
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
  input: {
    serviceId: string;
    professionalId?: string | null;
    // Preferência de quando o lead quer ("semana que vem", "amanhã 14h"): ISO de
    // parede no fuso da conta. Desloca o início da busca; ausente/passado = agora.
    preferredStartIso?: string | null;
  },
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
  // Se o lead pediu um horário específico, começa a busca por ali (getAvailableSlots
  // já aplica a antecedência mínima e clampa ao horizonte). Preferência no passado
  // ou inválida cai para "agora" (comportamento padrão: os 3 primeiros livres).
  const preferred = input.preferredStartIso
    ? parsePreferredStart(input.preferredStartIso, TZ)
    : null;
  const fromUtc = preferred && preferred.getTime() > now.getTime() ? preferred : now;
  let slots;
  try {
    slots = await getAvailableSlots(accountId, {
      catalogItemId: input.serviceId,
      professionalId: input.professionalId ?? null,
      fromUtc,
      toUtc: new Date(now.getTime() + HORIZON_REQUEST_DAYS * DAY_MS),
    });
  } catch (e) {
    // Ex.: profissional inválido / serviço sem duração — mensagem legível ao cliente.
    await sendWhatsAppMessage(lead, e instanceof Error ? e.message : "Não consegui buscar horários agora.");
    return;
  }

  // Cartão de agenda: agrupa os livres por dia local (getAvailableSlots já devolve
  // em ordem crescente), pega os 3 primeiros DIAS com vaga e, dentro de cada dia,
  // até MAX_PER_DAY horários — pra não virar parede de texto no WhatsApp. O que
  // aparece no cartão é EXATAMENTE o que guardamos em `proposedSlots` (a interpretação
  // da escolha casa a resposta do cliente contra esses slots).
  const MAX_DAYS = 3;
  const MAX_PER_DAY = 6;
  const byDay = new Map<string, typeof slots>();
  for (const s of slots) {
    const key = localDayKey(s.startISO, TZ);
    const list = byDay.get(key) ?? [];
    if (list.length < MAX_PER_DAY) list.push(s);
    byDay.set(key, list);
  }
  const dayKeys = [...byDay.keys()].slice(0, MAX_DAYS);
  const offered = dayKeys.flatMap((k) => byDay.get(k) ?? []);

  if (offered.length === 0) {
    const url = await bookingUrlFor(accountId);
    const linkLine = url ? ` Se preferir, dá pra ver a agenda completa aqui: ${url}` : "";
    await sendWhatsAppMessage(
      lead,
      `Não achei horário disponível para ${service.name} nos próximos dias.${linkLine}`,
    );
    return;
  }

  const proposed: AppointmentProposedSlot[] = offered.map((s) => ({
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

  // Cartão em texto formatado (WhatsApp renderiza *negrito*): um bloco por dia com
  // os horários em linha. Sem número — o cliente responde "quarta 14h" e a
  // interpretação casa. Profissional fica fora da grade (aparece na confirmação).
  const dayBlocks = dayKeys
    .map((k) => {
      const daySlots = byDay.get(k) ?? [];
      const times = daySlots.map((s) => formatSlotTime(s.startISO, TZ)).join("   ");
      return `📅 *${formatSlotDay(daySlots[0].startISO, TZ)}*\n${times}`;
    })
    .join("\n\n");
  await sendWhatsAppMessage(
    lead,
    `Show, ${firstName(lead.name)}! Para *${service.name}*, tenho estes horários:\n\n${dayBlocks}\n\n` +
      `É só me dizer o dia e o horário que prefere. 😊`,
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
  const now = new Date();
  const choice = await interpretSlotChoice({
    ai,
    formattedSlots: formatted,
    leadMessage,
    nowLabel: formatSlot(now.toISOString(), TZ),
  });

  const idx = choice.chosenIndex;
  const validChoice = idx !== null && choice.confident && idx >= 0 && idx < slots.length;
  if (!validChoice) {
    // O lead não escolheu nenhum dos 3 — se pediu um horário DIFERENTE ("amanhã 14h",
    // "semana que vem"), re-propõe em volta do horário pedido em vez de repetir os
    // mesmos. Reabre amplo (sem travar no profissional). Sem preferência válida →
    // mantém o "qual desses fica melhor?".
    const preferred = choice.preferredStartIso
      ? parsePreferredStart(choice.preferredStartIso, TZ)
      : null;
    if (preferred && preferred.getTime() > now.getTime()) {
      await proposeAppointmentSlots(leadId, lead.userId, {
        serviceId: slots[0].serviceId,
        preferredStartIso: choice.preferredStartIso,
      });
      return { booked: false };
    }
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
