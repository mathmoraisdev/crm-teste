import { prisma } from "@/server/db/client";
import { runQualification, type ConversationTurn } from "@/server/ai/qualification.agent";
import type { QualificationResult } from "@/server/ai/schemas";
import { normalizeEmail } from "@/lib/email";

/**
 * Roda o agente de qualificação sobre a conversa e persiste o resultado:
 * upsert em Qualification (1:1) + espelha o score em Lead.score (denormalizado
 * para a listagem). Devolve o resultado validado para a orquestração decidir.
 */
export async function qualifyLead(opts: {
  leadId: string;
  leadName: string;
  conversation: ConversationTurn[];
}): Promise<QualificationResult> {
  const result = await runQualification({
    leadName: opts.leadName,
    conversation: opts.conversation,
  });

  const score = Math.round(result.score);
  // e-mail capturado pela IA: só grava se for válido (não sobrescreve com null
  // num turno em que o lead não repetiu o e-mail).
  const email = normalizeEmail(result.email);

  await prisma.$transaction([
    prisma.qualification.upsert({
      where: { leadId: opts.leadId },
      create: {
        leadId: opts.leadId,
        interestLevel: result.interestLevel,
        painPoint: result.painPoint,
        segment: result.segment,
        isDecisionMaker: result.isDecisionMaker,
        urgency: result.urgency,
        budget: result.budget,
        preferredMeetingTime: result.preferredMeetingTime,
        score,
        summary: result.summary,
        nextAction: result.nextAction,
        raw: result,
      },
      update: {
        interestLevel: result.interestLevel,
        painPoint: result.painPoint,
        segment: result.segment,
        isDecisionMaker: result.isDecisionMaker,
        urgency: result.urgency,
        budget: result.budget,
        preferredMeetingTime: result.preferredMeetingTime,
        score,
        summary: result.summary,
        nextAction: result.nextAction,
        raw: result,
      },
    }),
    prisma.lead.update({
      where: { id: opts.leadId },
      data: { score, ...(email ? { email } : {}) },
    }),
  ]);

  return { ...result, score };
}
