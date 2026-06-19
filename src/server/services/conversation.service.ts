import { prisma } from "@/server/db/client";
import type { ConversationTurn } from "@/server/ai/qualification.agent";
import { generateNextQuestion } from "@/server/ai/conversation.agent";
import { getAiClient } from "@/server/ai/resolve";
import { qualifyLead } from "./qualification.service";
import { decidePipeline } from "./pipeline";
import { interpretAndBook, proposeSlots } from "./scheduling.service";
import { sendWhatsAppMessage } from "./messaging";
import { isOptOut } from "@/lib/optout";
import { brPhoneVariants } from "@/lib/phone";

export interface InboundInput {
  /** Localiza o lead por id (mock/dev) ou por telefone E.164 (webhook real). */
  leadId?: string;
  phone?: string;
  /** Conta dona da conversa (simulate-reply passa a sessão; webhook cloud-api pode omitir). */
  userId?: string;
  /** Chip que recebeu a mensagem (Baileys) — resolve a conta dona p/ achar o lead. */
  whatsAppNumberId?: string;
  text: string;
  /** Id do provedor para dedupe. Pode ser nulo no mock. */
  providerMessageId?: string | null;
}

/**
 * Resolve o lead da mensagem inbound respeitando o isolamento por conta:
 *  - leadId (+userId)         → dono direto (simulate-reply)
 *  - whatsAppNumberId + phone → conta dona do chip que recebeu
 *  - userId + phone           → conta explícita
 *  - phone (fallback)         → global (cloud-api sem mapa de número→conta)
 */
async function resolveLead(input: InboundInput) {
  if (input.leadId) {
    return prisma.lead.findFirst({
      where: { id: input.leadId, ...(input.userId ? { userId: input.userId } : {}) },
    });
  }
  // Casa o telefone tolerando o 9º dígito BR: o JID canônico do WhatsApp (de onde
  // vem o inbound) pode não ter o 9 que o lead foi salvo, e vice-versa.
  if (input.whatsAppNumberId && input.phone) {
    const num = await prisma.whatsAppNumber.findUnique({
      where: { id: input.whatsAppNumberId },
      select: { userId: true },
    });
    if (!num) return null;
    return prisma.lead.findFirst({
      where: { userId: num.userId, phone: { in: brPhoneVariants(input.phone) } },
    });
  }
  if (input.userId && input.phone) {
    return prisma.lead.findFirst({
      where: { userId: input.userId, phone: { in: brPhoneVariants(input.phone) } },
    });
  }
  if (input.phone) {
    return prisma.lead.findFirst({ where: { phone: { in: brPhoneVariants(input.phone) } } });
  }
  return null;
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

  // Localiza o lead (respeitando o isolamento por conta)
  const lead = await resolveLead(input);

  if (!lead) {
    // Não cria lead solto, mas NÃO fica mudo: um inbound de um telefone que não
    // casa com nenhum lead (ex.: 9º dígito divergente) é a causa clássica de
    // "a IA parou de responder". Logar dá o rastro que produção precisa.
    if (input.phone) {
      console.warn(
        `[inbound] descartado: nenhum lead casou telefone=${input.phone} chip=${input.whatsAppNumberId ?? "—"} userId=${input.userId ?? "—"}`,
      );
    }
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

  // Opt-out (LGPD): tem precedência sobre tudo — inclusive sobre o handoff humano.
  // Mesmo com a IA pausada (operador no controle), um "PARAR/SAIR" precisa encerrar
  // o lead e cancelar os jobs pendentes; é requisito legal, não pode ser ignorado.
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

  // Handoff humano: o operador assumiu a conversa (aiPaused=true). Apenas
  // persistimos o inbound acima e paramos aqui — não rodamos os agentes de IA
  // nem respondemos automaticamente. O operador responde manualmente via /reply.
  if (lead.aiPaused) {
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
  // BYOK: resolve o AiClient do dono do lead (chave própria ou fallback da plataforma).
  const ai = await getAiClient(lead.userId);
  const conversation = await loadConversation(lead.id);
  const qual = await qualifyLead({
    ai,
    leadId: lead.id,
    leadName: lead.name,
    conversation,
  });

  const decision = decidePipeline({
    current: status,
    score: qual.score,
    nextAction: qual.nextAction,
  });

  // TRACE: prova que o inbound chegou na IA e qual a decisão (responder/agendar/
  // descartar). Some na fonte do "silêncio sem erro".
  console.log(
    `[inbound] lead=${lead.id} status=${status} score=${qual.score} ` +
      `nextAction=${qual.nextAction} → schedule=${decision.shouldSchedule} ` +
      `reply=${decision.shouldReply} discard=${decision.shouldDiscard}`,
  );

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
      ai,
      leadName: lead.name,
      conversation,
      qualification: qual,
    });
    await sendWhatsAppMessage(lead, reply);
  }
  // decision.shouldDiscard → silêncio (não responde a lead descartado)

  return { leadId: lead.id };
}

/**
 * Handoff humano: pausa (paused=true) ou retoma (paused=false) a IA para o lead.
 * Com aiPaused=true, handleInbound só persiste o inbound e o operador responde
 * manualmente via sendManualReply. Escopado por conta (userId).
 */
export async function setHandoff(leadId: string, userId: string, paused: boolean) {
  const exists = await prisma.lead.findFirst({
    where: { id: leadId, userId },
    select: { id: true },
  });
  if (!exists) throw new Error("Lead não encontrado");
  return prisma.lead.update({
    where: { id: leadId },
    data: { aiPaused: paused, aiPausedAt: paused ? new Date() : null },
  });
}

/**
 * Resposta manual do operador: envia uma mensagem OUTBOUND ao lead pelo mesmo
 * chip e persiste como Message(OUTBOUND) — reaproveita sendWhatsAppMessage, a
 * fonte única de verdade de envio. Escopado por conta (userId).
 */
export async function sendManualReply(leadId: string, userId: string, content: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, userId },
    select: { id: true, phone: true, userId: true, whatsAppNumberId: true },
  });
  if (!lead) throw new Error("Lead não encontrado");
  await sendWhatsAppMessage(lead, content);
}
