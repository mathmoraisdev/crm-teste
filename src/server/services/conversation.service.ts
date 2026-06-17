import { prisma } from "@/server/db/client";
import type { ConversationTurn } from "@/server/ai/qualification.agent";
import { generateNextQuestion } from "@/server/ai/conversation.agent";
import { qualifyLead } from "./qualification.service";
import { decidePipeline } from "./pipeline";
import { interpretAndBook, proposeSlots } from "./scheduling.service";
import { sendWhatsAppMessage } from "./messaging";
import { isOptOut } from "@/lib/optout";

export interface InboundInput {
  /** Localiza o lead por id (mock/dev) ou por telefone E.164 (webhook real). */
  leadId?: string;
  phone?: string;
  text: string;
  /** Id do provedor para dedupe. Pode ser nulo no mock. */
  providerMessageId?: string | null;
}

async function loadConversation(leadId: string): Promise<ConversationTurn[]> {
  const messages = await prisma.message.findMany({
    where: { leadId },
    orderBy: { createdAt: "asc" },
    select: { direction: true, content: true },
  });
  return messages.map((m) => ({ direction: m.direction, content: m.content }));
}

/**
 * Orquestra o loop do agente a cada mensagem inbound:
 *  1. dedupe por providerMessageId → salva Message(INBOUND)
 *  2. NOVO/CONTATADO → EM_CONVERSA
 *  3. se há reunião PROPOSED → interpreta a escolha de horário (subfluxo)
 *  4. senão → qualifica (Sonnet) → aplica pipeline.ts → agenda / responde / descarta
 */
export async function handleInbound(
  input: InboundInput,
): Promise<{ leadId: string | null; deduped?: boolean }> {
  // 1. Dedupe
  if (input.providerMessageId) {
    const existing = await prisma.message.findUnique({
      where: { providerMessageId: input.providerMessageId },
      select: { leadId: true },
    });
    if (existing) return { leadId: existing.leadId, deduped: true };
  }

  // Localiza o lead
  const lead = input.leadId
    ? await prisma.lead.findUnique({ where: { id: input.leadId } })
    : input.phone
      ? await prisma.lead.findUnique({ where: { phone: input.phone } })
      : null;

  if (!lead) {
    // Webhook de número desconhecido: ignora silenciosamente (não cria lead solto).
    return { leadId: null };
  }

  // 1b. Salva inbound
  await prisma.message.create({
    data: {
      leadId: lead.id,
      direction: "INBOUND",
      content: input.text,
      providerMessageId: input.providerMessageId ?? undefined,
    },
  });

  // Opt-out: encerra o lead, cancela jobs pendentes, não qualifica nem responde.
  if (isOptOut(input.text)) {
    await prisma.$transaction([
      prisma.lead.update({
        where: { id: lead.id },
        data: { status: "DESCARTADO", optOut: true, optOutAt: new Date() },
      }),
      prisma.outboundJob.updateMany({
        where: { leadId: lead.id, status: { in: ["PENDING", "SENDING"] } },
        data: { status: "CANCELLED", lastError: "opt-out do lead" },
      }),
    ]);
    return { leadId: lead.id };
  }

  // 2. NOVO/CONTATADO → EM_CONVERSA
  let status = lead.status;
  if (status === "NOVO" || status === "CONTATADO") {
    status = "EM_CONVERSA";
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status },
    });
  }

  if (status === "DESCARTADO") return { leadId: lead.id };

  // 3. Aguardando escolha de horário?
  const meeting = await prisma.meeting.findUnique({
    where: { leadId: lead.id },
    select: { status: true },
  });
  if (meeting?.status === "PROPOSED") {
    await interpretAndBook(lead.id, input.text);
    return { leadId: lead.id };
  }
  if (status === "REUNIAO_AGENDADA") {
    // Reunião já confirmada — não reprocessa qualificação.
    return { leadId: lead.id };
  }

  // 4. Qualifica → decide → age
  const conversation = await loadConversation(lead.id);
  const qual = await qualifyLead({
    leadId: lead.id,
    leadName: lead.name,
    conversation,
  });

  const decision = decidePipeline({
    current: status,
    score: qual.score,
    nextAction: qual.nextAction,
  });

  if (decision.status !== status) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: decision.status },
    });
  }

  if (decision.shouldSchedule) {
    await proposeSlots(lead.id);
  } else if (decision.shouldReply) {
    const reply = await generateNextQuestion({
      leadName: lead.name,
      conversation,
      qualification: qual,
    });
    await sendWhatsAppMessage(lead, reply);
  }
  // decision.shouldDiscard → silêncio (não responde a lead descartado)

  return { leadId: lead.id };
}
