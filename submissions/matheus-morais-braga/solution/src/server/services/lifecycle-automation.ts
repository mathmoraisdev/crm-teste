import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { hourInTz, isWithinWindow } from "@/lib/sendWindow";
import { appendOptOutFooter, sendWhatsAppMessage } from "./messaging";
import {
  isDueAfter,
  postSaleMessage,
  reviewMessage,
  reengageMessage,
} from "@/lib/lifecycle";

const TZ = env.SCHEDULING_TIMEZONE;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Teto de toques por passe por execução: não blastar o histórico ao LIGAR e não
// segurar o worker num lote gigante. A varredura de comanda reusa
// @@index([accountId, closedAt]); o reengajamento é filtrado por relação.
const BATCH = 50;

/** Lead mínimo p/ enviar (o shape que sendWhatsAppMessage/*Message esperam). */
type TouchLead = {
  id: string;
  name: string;
  phone: string;
  userId: string;
  whatsAppNumberId: string | null;
  optOut: boolean;
};

const LEAD_SELECT = {
  id: true,
  name: true,
  phone: true,
  userId: true,
  whatsAppNumberId: true,
  optOut: true,
} as const;

/**
 * Efeito: varre as comandas FECHADAS devidas para UM toque ancorado na comanda
 * (pós-venda OU pedido de avaliação/NPS) e envia ao lead, marcando o timestamp
 * SÓ após enviar (idempotente entre ticks — falha retenta no próximo tick).
 * Sem rodapé de opt-out: é dentro-da-relação (o cliente acabou de transacionar).
 */
async function dispatchOrderTouch(
  now: Date,
  cfg: {
    delayHours: number;
    marker: "postSaleThankedAt" | "reviewRequestedAt";
    message: (lead: { name: string }) => string;
  },
): Promise<number> {
  if (cfg.delayHours <= 0) return 0; // toque desligado
  const floorMs = env.LIFECYCLE_BACKLOG_FLOOR_DAYS * DAY_MS;
  const delayMs = cfg.delayHours * HOUR_MS;

  const orders = await prisma.order.findMany({
    where: {
      status: "FECHADA",
      leadId: { not: null },
      closedAt: { not: null },
      [cfg.marker]: null,
      lead: { optOut: false },
      account: { lifecycleAutomationEnabled: true }, // opt-in por conta (Order.account = dono)
    },
    select: { id: true, closedAt: true, lead: { select: LEAD_SELECT } },
    take: BATCH,
    orderBy: { closedAt: "asc" },
  });

  let sent = 0;
  for (const o of orders) {
    if (!o.closedAt || !o.lead) continue;
    const due = isDueAfter({ eventAt: o.closedAt, now, delayMs, floorMs, marker: null });
    if (!due) continue;
    if (o.lead.optOut) continue; // re-check anti-corrida (opt-out entre a query e o envio)
    try {
      await sendWhatsAppMessage(o.lead, cfg.message(o.lead), { source: "SYSTEM" });
      await prisma.order.update({ where: { id: o.id }, data: { [cfg.marker]: now } });
      sent++;
    } catch (err) {
      // Não marca: retenta no próximo tick (ex.: chip offline na hora).
      logger.error(
        { err, orderId: o.id, leadId: o.lead.id, marker: cfg.marker },
        "[worker] toque de ciclo de vida (comanda) falhou",
      );
    }
  }
  if (sent === BATCH) {
    logger.info({ marker: cfg.marker, sent }, "[worker] lote de ciclo de vida saturado (comanda)");
  }
  return sent;
}

/** Pós-venda: "obrigado pela preferência" horas depois da comanda FECHADA. */
export function dispatchPostSale(now: Date): Promise<number> {
  return dispatchOrderTouch(now, {
    delayHours: env.LIFECYCLE_POSTSALE_HOURS,
    marker: "postSaleThankedAt",
    message: postSaleMessage,
  });
}

/** Pedido de avaliação (NPS): um dia depois. Independente do pós-venda (a mesma
 *  comanda pode receber os dois, em horas diferentes, marcadores distintos). */
export function dispatchReviewRequests(now: Date): Promise<number> {
  return dispatchOrderTouch(now, {
    delayHours: env.LIFECYCLE_REVIEW_HOURS,
    marker: "reviewRequestedAt",
    message: reviewMessage,
  });
}

/**
 * Reengajamento (win-back): quem ENGAJOU (inbound algum dia) e ESFRIOU (sem
 * inbound nos últimos N dias), ainda "em jogo" no funil, sem handoff humano e
 * sem compra recente. Cold-ish → leva o rodapé de descadastro (LGPD). Marca
 * lastEngagedAt SÓ após enviar (não re-toca o mesmo frio toda semana).
 */
export async function dispatchReengagement(now: Date): Promise<number> {
  const days = env.LIFECYCLE_REENGAGE_DAYS;
  if (days <= 0) return 0; // toque desligado
  const coldCutoff = new Date(now.getTime() - days * DAY_MS);

  const leads = await prisma.lead.findMany({
    where: {
      optOut: false,
      aiPaused: false, // não atropela handoff humano
      status: { in: ["EM_CONVERSA", "QUALIFICADO", "OFERTA_ENVIADA"] },
      user: { lifecycleAutomationEnabled: true }, // opt-in por conta
      OR: [{ lastEngagedAt: null }, { lastEngagedAt: { lt: coldCutoff } }], // não re-tocar frio recente
      AND: [
        { messages: { some: { direction: "INBOUND", createdAt: { lt: coldCutoff } } } }, // engajou algum dia
        { messages: { none: { direction: "INBOUND", createdAt: { gte: coldCutoff } } } }, // sem inbound recente
        { orders: { none: { status: "FECHADA", closedAt: { gte: coldCutoff } } } }, // não comprou há pouco
      ],
    },
    select: LEAD_SELECT,
    take: BATCH,
    orderBy: { updatedAt: "asc" },
  });

  const footer = env.OUTBOUND_OPTOUT_FOOTER ? env.OUTBOUND_OPTOUT_FOOTER_TEXT : "";
  let sent = 0;
  for (const lead of leads as TouchLead[]) {
    if (lead.optOut) continue; // re-check anti-corrida
    try {
      const text = appendOptOutFooter(reengageMessage(lead), footer);
      await sendWhatsAppMessage(lead, text, { source: "SYSTEM" });
      await prisma.lead.update({ where: { id: lead.id }, data: { lastEngagedAt: now } });
      sent++;
    } catch (err) {
      logger.error({ err, leadId: lead.id }, "[worker] reengajamento falhou");
    }
  }
  if (sent === BATCH) {
    logger.info({ sent }, "[worker] lote de reengajamento saturado");
  }
  return sent;
}

/**
 * Orquestra os 3 sub-passes num tick do worker. No-op total se o kill-switch
 * global estiver off OU fora da janela comercial (o toque espera o próximo tick
 * dentro do horário — o marcador não é gravado, nada se perde). Cada passe em
 * try/catch próprio: a falha de um não derruba os outros. Retorna o total enviado.
 */
export async function dispatchLifecycleAutomations(now: Date): Promise<number> {
  if (!env.LIFECYCLE_AUTOMATION) return 0; // kill-switch global (sobe inerte)
  const withinWindow = isWithinWindow(hourInTz(now, TZ), {
    startHour: env.WHATSAPP_SEND_START_HOUR,
    endHour: env.WHATSAPP_SEND_END_HOUR,
  });
  if (!withinWindow) return 0; // nunca "avalie a gente" de madrugada — espera o próximo tick

  let total = 0;
  for (const pass of [dispatchPostSale, dispatchReviewRequests, dispatchReengagement]) {
    try {
      total += await pass(now);
    } catch (err) {
      logger.error({ err, pass: pass.name }, "[worker] passe de ciclo de vida falhou");
    }
  }
  return total;
}
