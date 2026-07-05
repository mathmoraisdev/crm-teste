import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { formatSlot } from "@/lib/utils";
import { dueReminder, type ReminderKind } from "./meeting-reminders";
import { sendWhatsAppMessage } from "./messaging";

const TZ = env.SCHEDULING_TIMEZONE;

/**
 * Lembretes de AGENDAMENTO de serviço (Appointment). Reaproveita `dueReminder`
 * (PURA — a decisão de janela véspera/1h é idêntica à da Meeting), mas com texto
 * próprio de "serviço" (não "conversa") e SEM link. Copia fielmente o padrão
 * idempotente de `dispatchDueReminders`: só marca o timestamp APÓS enviar.
 */

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * Templates padrão dos lembretes de serviço. Placeholders: {{nome}} (primeiro
 * nome), {{servico}} (nome do serviço, ou "atendimento" quando não há), {{quando}}
 * (data/hora formatada). Sem link — agendamento de balcão não tem URL.
 */
export const DEFAULT_APPT_REMINDER_DAY_BEFORE =
  "Oi, {{nome}}! Lembrete do seu {{servico}} amanhã.\n📅 {{quando}}\nAté lá! 😊";
export const DEFAULT_APPT_REMINDER_HOUR_BEFORE =
  "Oi, {{nome}}! Seu {{servico}} é daqui a pouco.\n📅 {{quando}}\nAté já! 😊";

/**
 * PURA: renderiza o template de agendamento substituindo {{nome}}/{{servico}}/
 * {{quando}}. Serviço vazio cai p/ "atendimento" (frase não fica capenga).
 */
export function renderApptReminderTemplate(
  template: string,
  vars: { nome: string; servico: string | null; quando: string },
): string {
  const servico = vars.servico?.trim() || "atendimento";
  return template
    .replace(/\{\{\s*nome\s*\}\}/gi, vars.nome)
    .replace(/\{\{\s*servico\s*\}\}/gi, servico)
    .replace(/\{\{\s*quando\s*\}\}/gi, vars.quando)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Monta o texto do lembrete de agendamento (usa o padrão de serviço). */
export function apptReminderMessage(
  kind: ReminderKind,
  lead: { name: string },
  scheduledAt: Date,
  serviceName: string | null,
): string {
  const template =
    kind === "day_before" ? DEFAULT_APPT_REMINDER_DAY_BEFORE : DEFAULT_APPT_REMINDER_HOUR_BEFORE;
  return renderApptReminderTemplate(template, {
    nome: firstName(lead.name),
    servico: serviceName,
    quando: formatSlot(scheduledAt.toISOString(), TZ),
  });
}

/**
 * Efeito: varre os agendamentos futuros (AGENDADO/CONFIRMADO) e envia ao cliente
 * os lembretes devidos (véspera / 1h antes), pelo WhatsApp do chip da conversa.
 * Marca o timestamp da janela só após enviar (idempotente entre ticks). Retorna
 * quantos lembretes saíram. Roda no loop do worker.
 */
export async function dispatchDueAppointmentReminders(now: Date): Promise<number> {
  const appts = await prisma.appointment.findMany({
    where: {
      status: { in: ["AGENDADO", "CONFIRMADO"] },
      scheduledAt: { gt: now },
      OR: [{ remindedDayBeforeAt: null }, { remindedHourBeforeAt: null }],
    },
    select: {
      id: true,
      scheduledAt: true,
      serviceName: true,
      remindedDayBeforeAt: true,
      remindedHourBeforeAt: true,
      lead: {
        select: { id: true, name: true, phone: true, userId: true, whatsAppNumberId: true },
      },
    },
  });

  let sent = 0;
  for (const a of appts) {
    const kind = dueReminder({
      scheduledAt: a.scheduledAt,
      now,
      remindedDayBeforeAt: a.remindedDayBeforeAt,
      remindedHourBeforeAt: a.remindedHourBeforeAt,
    });
    if (!kind) continue;

    try {
      await sendWhatsAppMessage(
        a.lead,
        apptReminderMessage(kind, a.lead, a.scheduledAt, a.serviceName),
        { source: "SYSTEM" }, // lembrete automático, não é resposta da IA
      );
      await prisma.appointment.update({
        where: { id: a.id },
        data:
          kind === "day_before"
            ? { remindedDayBeforeAt: now }
            : { remindedHourBeforeAt: now },
      });
      sent++;
    } catch (err) {
      // Não marca o timestamp: retry no próximo tick. Loga p/ rastrear.
      console.error(
        `[worker] lembrete de agendamento ${kind} falhou (appt=${a.id} lead=${a.lead.id}):`,
        err,
      );
    }
  }
  return sent;
}
