import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { formatSlot } from "@/lib/utils";
import { sendWhatsAppMessage } from "./messaging";

const TZ = env.SCHEDULING_TIMEZONE;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// Piso da janela "véspera": abaixo disso a reunião já está perto demais e só faz
// sentido o lembrete de 1h (evita disparar "é amanhã" para algo marcado em cima da hora).
const DAY_FLOOR_MS = 2 * HOUR_MS;

export type ReminderKind = "day_before" | "hour_before";

/**
 * PURA: decide qual lembrete (se algum) deve sair AGORA para uma reunião.
 *
 * - hour_before: falta ≤ 1h e ainda não foi lembrado nessa janela.
 * - day_before:  falta ≤ 24h (e > 2h) e ainda não foi lembrado nessa janela.
 * - reunião no passado/iniciada (faltando ≤ 0) → nenhum.
 *
 * As janelas são mutuamente exclusivas num mesmo tick (day exige > 2h, hour exige
 * ≤ 1h). Prioriza a de 1h por ser a mais urgente.
 */
export function dueReminder(input: {
  scheduledAt: Date;
  now: Date;
  remindedDayBeforeAt: Date | null;
  remindedHourBeforeAt: Date | null;
}): ReminderKind | null {
  const remaining = input.scheduledAt.getTime() - input.now.getTime();
  if (remaining <= 0) return null;

  if (remaining <= HOUR_MS && !input.remindedHourBeforeAt) return "hour_before";
  if (remaining <= DAY_MS && remaining > DAY_FLOOR_MS && !input.remindedDayBeforeAt) {
    return "day_before";
  }
  return null;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * Templates padrão dos lembretes (usados quando o número não tem texto próprio).
 * Placeholders: {{nome}} (primeiro nome), {{quando}} (data/hora formatada),
 * {{link}} (URL da reunião, ou vazio). Exportados p/ a UI mostrar como exemplo.
 */
export const DEFAULT_REMINDER_DAY_BEFORE =
  "Oi, {{nome}}! Passando pra lembrar da nossa conversa de amanhã.\n📅 {{quando}}\n{{link}}\n\nAté lá! 😊";
export const DEFAULT_REMINDER_HOUR_BEFORE =
  "Oi, {{nome}}! Nossa conversa é daqui a pouco.\n📅 {{quando}}\n{{link}}\n\nAté lá! 😊";

/**
 * PURA: renderiza o template substituindo {{nome}}/{{quando}}/{{link}}. Linhas em
 * branco resultantes de um {{link}} vazio são colapsadas (reunião sem link não
 * deixa buraco). Sem link, o placeholder some.
 */
export function renderReminderTemplate(
  template: string,
  vars: { nome: string; quando: string; link: string },
): string {
  return template
    .replace(/\{\{\s*nome\s*\}\}/gi, vars.nome)
    .replace(/\{\{\s*quando\s*\}\}/gi, vars.quando)
    .replace(/\{\{\s*link\s*\}\}/gi, vars.link)
    .replace(/[ \t]+\n/g, "\n") // tira espaço sobrando antes de quebra
    .replace(/\n{3,}/g, "\n\n") // colapsa buraco do link vazio
    .trim();
}

/**
 * Monta o texto do lembrete. Usa o template do número (se houver) ou o padrão.
 */
export function reminderMessage(
  kind: ReminderKind,
  lead: { name: string },
  scheduledAt: Date,
  meetingLink: string | null,
  templates?: { dayBefore?: string | null; hourBefore?: string | null },
): string {
  const override =
    kind === "day_before" ? templates?.dayBefore : templates?.hourBefore;
  const fallback =
    kind === "day_before" ? DEFAULT_REMINDER_DAY_BEFORE : DEFAULT_REMINDER_HOUR_BEFORE;
  const template = override?.trim() ? override : fallback;
  return renderReminderTemplate(template, {
    nome: firstName(lead.name),
    quando: formatSlot(scheduledAt.toISOString(), TZ),
    link: meetingLink ?? "",
  });
}

/**
 * Efeito: varre as reuniões CONFIRMED futuras e envia ao lead os lembretes
 * devidos (véspera / 1h antes), pelo WhatsApp do próprio chip da conversa.
 * Marca o timestamp da janela só após enviar (idempotente entre ticks).
 * Retorna quantos lembretes saíram. Roda no loop do worker.
 */
export async function dispatchDueReminders(now: Date): Promise<number> {
  const meetings = await prisma.meeting.findMany({
    where: {
      status: "CONFIRMED",
      scheduledAt: { gt: now },
      OR: [{ remindedDayBeforeAt: null }, { remindedHourBeforeAt: null }],
    },
    select: {
      id: true,
      scheduledAt: true,
      meetingLink: true,
      remindedDayBeforeAt: true,
      remindedHourBeforeAt: true,
      lead: {
        select: {
          id: true,
          name: true,
          phone: true,
          userId: true,
          whatsAppNumberId: true,
          // texto dos lembretes configurado no número (cai p/ o padrão se null)
          whatsAppNumber: {
            select: {
              reminderDayBeforeTemplate: true,
              reminderHourBeforeTemplate: true,
            },
          },
        },
      },
    },
  });

  let sent = 0;
  for (const m of meetings) {
    if (!m.scheduledAt) continue;
    const kind = dueReminder({
      scheduledAt: m.scheduledAt,
      now,
      remindedDayBeforeAt: m.remindedDayBeforeAt,
      remindedHourBeforeAt: m.remindedHourBeforeAt,
    });
    if (!kind) continue;

    try {
      await sendWhatsAppMessage(
        m.lead,
        reminderMessage(kind, m.lead, m.scheduledAt, m.meetingLink, {
          dayBefore: m.lead.whatsAppNumber?.reminderDayBeforeTemplate,
          hourBefore: m.lead.whatsAppNumber?.reminderHourBeforeTemplate,
        }),
      );
      await prisma.meeting.update({
        where: { id: m.id },
        data:
          kind === "day_before"
            ? { remindedDayBeforeAt: now }
            : { remindedHourBeforeAt: now },
      });
      sent++;
    } catch (err) {
      // Não marca o timestamp: tenta de novo no próximo tick. Loga p/ rastrear
      // (ex.: chip do lead offline na hora do lembrete).
      console.error(
        `[worker] lembrete ${kind} falhou (meeting=${m.id} lead=${m.lead.id}):`,
        err,
      );
    }
  }
  return sent;
}
