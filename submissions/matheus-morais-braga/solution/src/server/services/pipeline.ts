import type { LeadStatus } from "@prisma/client";
import type { NextAction } from "@/server/ai/schemas";

/**
 * State machine de pipeline — função PURA e testável (sem I/O).
 * Decide o próximo status e quais efeitos disparar a partir de
 * (status atual, score, nextAction da IA).
 *
 * Limiares:
 *  - QUALIFICA: score >= 70 OU a IA pediu schedule_meeting.
 *  - DESCARTA:  score < 40 E a IA sinalizou desinteresse (discard).
 *               (exige sinal explícito — não descarta lead "frio mas novo").
 *  - senão: permanece/segue EM_CONVERSA e responde com a próxima pergunta.
 */
export const SCORE_QUALIFY = 70;
export const SCORE_DISCARD = 40;

export interface PipelineDecision {
  status: LeadStatus;
  shouldSchedule: boolean;
  shouldReply: boolean;
  shouldDiscard: boolean;
  shouldOffer: boolean;
}

const TERMINAL: LeadStatus[] = ["REUNIAO_AGENDADA", "PAGO", "DESCARTADO"];

export function decidePipeline(input: {
  current: LeadStatus;
  score: number;
  nextAction: NextAction;
}): PipelineDecision {
  const { current, score, nextAction } = input;

  // Estados terminais não reagem mais à qualificação.
  if (TERMINAL.includes(current)) {
    return {
      status: current,
      shouldSchedule: false,
      shouldReply: false,
      shouldDiscard: false,
      shouldOffer: false,
    };
  }

  // Venda: a IA sinalizou intenção de compra clara. Precede a qualificação por
  // score — vender é o desfecho mais avançado que agendar uma reunião.
  if (nextAction === "send_offer") {
    return {
      status: "OFERTA_ENVIADA",
      shouldSchedule: false,
      shouldReply: false,
      shouldDiscard: false,
      shouldOffer: true,
    };
  }

  if (score >= SCORE_QUALIFY || nextAction === "schedule_meeting") {
    return {
      status: "QUALIFICADO",
      shouldSchedule: true,
      shouldReply: false,
      shouldDiscard: false,
      shouldOffer: false,
    };
  }

  if (score < SCORE_DISCARD && nextAction === "discard") {
    return {
      status: "DESCARTADO",
      shouldSchedule: false,
      shouldReply: false,
      shouldDiscard: true,
      shouldOffer: false,
    };
  }

  return {
    status: "EM_CONVERSA",
    shouldSchedule: false,
    shouldReply: true,
    shouldDiscard: false,
    shouldOffer: false,
  };
}
