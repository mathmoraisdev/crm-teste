import crypto from "node:crypto";
import { prisma } from "@/server/db/client";
import type { AttendanceStatus } from "@prisma/client";
import type { ConversationTurn } from "@/server/ai/qualification.agent";
import { sessionWindow } from "@/server/ai/transcript";
import { generateAttendanceReply } from "@/server/ai/conversation.agent";
import { getAiClient } from "@/server/ai/resolve";
import { consumeAiCredit, resolveAiModelForUser } from "@/server/services/entitlements";
import { qualifyLead } from "./qualification.service";
import { decideInboundMode } from "./inbound-mode";
import { decidePipeline } from "./pipeline";
import { listActiveOffers } from "./offer.service";
import { sendOffer } from "./sales.service";
import { renderActiveOffers, renderCatalogForAI } from "@/server/ai/attendance-context";
import { listCatalogItems } from "./catalog.service";
import { interpretAndBook, proposeSlots } from "./scheduling.service";
import {
  sendWhatsAppMessage,
  enqueueManualReply,
  sendWhatsAppMedia,
  enqueueManualMedia,
} from "./messaging";
import { env } from "@/lib/env";
import { isOptOut } from "@/lib/optout";
import { brPhoneVariants } from "@/lib/phone";
import { shouldCreateContact } from "./inbound-resolve";
import { isAccountActiveByLead } from "@/server/services/account.service";
import { cached } from "@/server/cache/cache";
import { cacheKeys, invalidateConversation, invalidateLeadCaches } from "@/server/cache/keys";
import { MEDIA_PLACEHOLDERS } from "@/server/whatsapp/baileys/media";
import { uploadInboundMedia } from "@/server/storage/media-storage";
import { transcribeAudio } from "@/server/ai/transcribe";
import { shouldTranscribe } from "@/server/ai/transcribe-policy";

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
  /** Reply: id WA (stanzaId) da mensagem nossa que o lead citou. Resolvido p/
   *  Message.replyToId via providerMessageId. Nulo quando não é uma citação. */
  quotedProviderMessageId?: string | null;
}

/**
 * Resolve o lead da mensagem inbound respeitando o isolamento por conta:
 *  - leadId (+userId)         → dono direto (simulate-reply)
 *  - whatsAppNumberId + phone → conta dona do chip que recebeu
 *  - userId + phone           → conta explícita
 *  - phone só (sem escopo)    → NÃO resolve (evita vazamento entre contas)
 */
export async function resolveLead(input: InboundInput) {
  if (input.leadId) {
    return prisma.lead.findFirst({
      where: { id: input.leadId, ...(input.userId ? { userId: input.userId } : {}) },
    });
  }
  // Casa o telefone tolerando o 9º dígito BR: o JID canônico do WhatsApp (de onde
  // vem o inbound) pode não ter o 9 que o lead foi salvo, e vice-versa.
  if (input.whatsAppNumberId && input.phone) {
    // Identidade da conversa é por EMPRESA (número), não por operador: casa só o
    // lead DESTA empresa. Casar por (userId, phone) faria duas empresas do mesmo
    // operador compartilharem o contato. O whatsAppNumberId já é único e implica o
    // dono, então não precisa filtrar por userId aqui.
    return prisma.lead.findFirst({
      where: { whatsAppNumberId: input.whatsAppNumberId, phone: { in: brPhoneVariants(input.phone) } },
    });
  }
  if (input.userId && input.phone) {
    return prisma.lead.findFirst({
      where: { userId: input.userId, phone: { in: brPhoneVariants(input.phone) } },
    });
  }
  if (input.phone) {
    // Sem whatsAppNumberId nem userId não há como escopar a conta: buscar global
    // casaria o lead de QUALQUER tenant (vazamento). Melhor não resolver.
    return null;
  }
  return null;
}

/** Teto de mensagens enviadas à IA por resposta — controla custo de token em
 *  conversas longas. Reenviar o histórico inteiro a cada réplica cresce de forma
 *  quadrática ao longo da vida do lead; 12 turnos cobrem o contexto recente. É um
 *  limite de SEGURANÇA: a janela de sessão (silêncio) costuma cortar bem antes. */
const CONVERSATION_CONTEXT_LIMIT = 12;

/** Reset de contexto por silêncio (min) quando o número não define o seu. */
const DEFAULT_CONTEXT_RESET_MINUTES = 180;

// Mensagem enviada ao lead quando a cota de IA do mês (chave da plataforma) acaba.
// MVP: fixa. Follow-up: tornar configurável por número/conta.
const AI_QUOTA_EXCEEDED_MESSAGE =
  "Recebi sua mensagem! 🙌 Em instantes um de nossos atendentes vai continuar por aqui.";

/**
 * Monta o contexto enviado à IA. Duas camadas:
 *  1. teto de 25 turnos (custo de token);
 *  2. janela de SESSÃO: se o lead voltou após um silêncio > resetMinutes, a IA
 *     recebe só a conversa nova — o atendimento anterior (já resolvido) não
 *     contamina a resposta. `resetMinutes <= 0` desliga o corte por tempo.
 */
async function loadConversation(
  leadId: string,
  resetMinutes: number = DEFAULT_CONTEXT_RESET_MINUTES,
): Promise<ConversationTurn[]> {
  // Cache 300s por lead: o worker pode recarregar o mesmo contexto várias vezes
  // (debounce/agrupamento) sem nova ida ao banco. Invalida a cada Message nova
  // (invalidateConversation no inbound/outbound), então nunca serve histórico
  // defasado dentro da conversa.
  return cached(cacheKeys.conversation(leadId), 300, () =>
    computeConversation(leadId, resetMinutes),
  );
}

async function computeConversation(
  leadId: string,
  resetMinutes: number,
): Promise<ConversationTurn[]> {
  // Pega as últimas N (createdAt desc + take) e reverte p/ ordem cronológica.
  const messages = await prisma.message.findMany({
    where: { leadId },
    orderBy: { createdAt: "desc" },
    take: CONVERSATION_CONTEXT_LIMIT,
    select: { direction: true, content: true, createdAt: true },
  });
  // Exclui os placeholders de mídia ("📷 Imagem" etc.) em AMBAS as direções: a IA
  // não lê o arquivo do lead (INBOUND) e o rótulo de um arquivo que o operador
  // mandou pelo zap (OUTBOUND) não é uma resposta textual — em ambos só confunde/
  // gasta token. O operador continua vendo no inbox (que lê as Messages cruas).
  const chronological = messages
    .reverse()
    .filter((m) => !MEDIA_PLACEHOLDERS.has(m.content));
  return sessionWindow(chronological, resetMinutes).map((m) => ({
    direction: m.direction,
    content: m.content,
  }));
}

export interface IngestResult {
  leadId: string | null;
  deduped?: boolean;
  /** true se há lead válido e a resposta da IA deve ser gerada (na hora ou via debounce). */
  respond: boolean;
  /** atraso recomendado antes de responder (debounce), em ms. 0 = imediato. */
  delayMs: number;
}

/**
 * Resolve o lead da conversa ou cria o contato: inbound de um telefone
 * desconhecido CRIA o contato atrelado à empresa (número) que recebeu. Sem a
 * empresa (ex.: cloud-api sem mapa) não cria → devolve null. Compartilhado por
 * `ingestInbound` (texto) e `ingestInboundMedia` (placeholder).
 */
async function resolveOrCreateLead(input: InboundInput) {
  const lead = await resolveLead(input);
  if (lead) return lead;
  if (!shouldCreateContact({ matched: false, whatsAppNumberId: input.whatsAppNumberId, phone: input.phone })) {
    return null;
  }
  // Descobre o dono (operador) a partir da empresa (número) que recebeu.
  const num = await prisma.whatsAppNumber.findUnique({
    where: { id: input.whatsAppNumberId! },
    select: { userId: true },
  });
  if (!num) return null;
  return prisma.lead.create({
    data: {
      userId: num.userId,
      whatsAppNumberId: input.whatsAppNumberId!,
      phone: input.phone!,
      name: input.phone!, // sem nome ainda; o telefone é o rótulo inicial
      status: "EM_CONVERSA",
      consentSource: "inbound", // o cliente iniciou o contato (base legal p/ responder)
    },
  });
}

/**
 * Mídia recebida do lead (áudio/imagem/vídeo/doc...) SEM legenda. Não baixamos o
 * arquivo nem acionamos a IA — só persistimos um PLACEHOLDER textual ("📷 Imagem")
 * como Message(INBOUND) p/ o operador ver no inbox que algo chegou. O aviso "só
 * leio texto" ao lead é enviado à parte (pool.replyUnsupportedMedia). Dedupe por
 * providerMessageId p/ a reentrega do Baileys não duplicar o placeholder.
 */
export async function ingestInboundMedia(input: {
  phone?: string;
  whatsAppNumberId?: string;
  placeholder: string;
  providerMessageId: string | null;
  // Anexo baixado (imagem/áudio/PDF) — ausente p/ tipos que não baixamos.
  buffer?: Buffer;
  mediaType?: "image" | "audio" | "document";
  mime?: string;
  fileName?: string;
  audioSeconds?: number | null; // duração da nota de voz (guardrail de áudio longo)
}): Promise<{ respond: boolean; leadId: string | null; delayMs: number }> {
  if (input.providerMessageId) {
    const existing = await prisma.message.findUnique({
      where: { providerMessageId: input.providerMessageId },
      select: { leadId: true },
    });
    if (existing) return { respond: false, leadId: existing.leadId, delayMs: 0 };
  }
  const lead = await resolveOrCreateLead({
    phone: input.phone,
    whatsAppNumberId: input.whatsAppNumberId,
    text: input.placeholder,
  });
  if (!lead) return { respond: false, leadId: null, delayMs: 0 };

  // Se veio arquivo (imagem/PDF) e o storage está configurado, sobe pro bucket
  // privado e guarda só o caminho. Falha/sem storage → segue só com placeholder.
  let media: {
    mediaPath: string;
    mediaType: string;
    mediaMime?: string;
    fileName?: string;
  } | null = null;
  if (input.buffer && input.mediaType) {
    const ext = (input.fileName?.split(".").pop() || input.mime?.split("/")[1] || "bin")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase();
    const path = await uploadInboundMedia(input.buffer, {
      leadId: lead.id,
      messageKey: input.providerMessageId ?? `${lead.id}-${input.buffer.length}`,
      mime: input.mime ?? "application/octet-stream",
      ext: ext || "bin",
    });
    if (path) {
      media = {
        mediaPath: path,
        mediaType: input.mediaType,
        mediaMime: input.mime,
        fileName: input.fileName,
      };
    }
  }

  // Áudio: se elegível, transcreve para texto e trata como inbound de texto.
  // Mantém mediaPath (player do operador) E content=transcrição (contexto da IA).
  let transcript: string | null = null;
  if (
    input.mediaType === "audio" &&
    input.buffer &&
    input.mime &&
    shouldTranscribe(
      { seconds: input.audioSeconds ?? null },
      { enabled: env.TRANSCRIBE_ENABLED, maxSeconds: env.TRANSCRIBE_MAX_SECONDS },
    )
  ) {
    transcript = await transcribeAudio(input.buffer, input.mime);
  }

  await prisma.message.create({
    data: {
      leadId: lead.id,
      direction: "INBOUND",
      content: transcript ?? input.placeholder, // transcrição quando houver; senão "🎤 Áudio"
      providerMessageId: input.providerMessageId ?? undefined,
      ...(media ?? {}), // mediaPath/mediaType/... — player do operador continua
    },
  });
  // Nova mensagem → contexto da IA e contadores de inbox (não-lidas) mudaram.
  await invalidateConversation(lead.id);
  await invalidateLeadCaches(lead.userId);
  // Lead resolvido que manda mídia também reabre no inbox p/ o operador ver.
  await reopenIfResolved(lead);

  // Sem transcrição → comportamento antigo (não aciona IA).
  if (!transcript) return { respond: false, leadId: lead.id, delayMs: 0 };

  // Gate de billing: conta suspensa (inadimplência) → a IA silencia, igual ao
  // caminho de texto (ver ingestInbound). `respondToLead` não revalida billing por
  // conta própria, então o gate precisa ficar AQUI para o áudio não furar a regra.
  if (!(await isAccountActiveByLead(lead.id))) {
    return { respond: false, leadId: lead.id, delayMs: 0 };
  }

  // Com transcrição e conta ativa → segue a MESMA lógica de timing do texto.
  return { respond: true, leadId: lead.id, delayMs: await suggestReplyDelay(lead) };
}

/**
 * Camada 1 do inbound (SÍNCRONA, sempre roda na hora): dedupe → resolve/cria o
 * lead → persiste a Message(INBOUND) → trata opt-out (LGPD). NÃO gera a resposta
 * da IA — isso é `respondToLead`, que o worker pode adiar/agrupar (debounce).
 * Devolve se vale responder e o atraso sugerido (timing por número).
 */
/**
 * Lead RESOLVIDO que volta a falar → reabre a conversa no inbox. Sem isso ela fica
 * presa em RESOLVIDA (some das abas fila/minhas/todas) mesmo com o lead ativo.
 *  - IA no controle (aiPaused=false) → volta p/ "IA" (a IA segue respondendo).
 *  - Operador no controle (aiPaused=true) → volta p/ "FILA" p/ um humano reassumir.
 */
async function reopenIfResolved(lead: {
  id: string;
  userId: string;
  attendanceStatus: string;
  aiPaused: boolean;
}): Promise<void> {
  if (lead.attendanceStatus !== "RESOLVIDA") return;
  await prisma.lead.update({
    where: { id: lead.id },
    data: { attendanceStatus: lead.aiPaused ? "FILA" : "IA" },
  });
  // Mudou de aba (RESOLVIDA → IA/FILA) → atualiza contadores/facets do inbox.
  await invalidateLeadCaches(lead.userId);
}

/**
 * Atraso (debounce) sugerido antes da IA responder, em ms. A 1ª resposta da
 * conversa (sem nenhum OUTBOUND ainda) usa um tempo próprio; as demais usam o
 * padrão do número. Fonte única p/ `ingestInbound` (texto) e `ingestInboundMedia`
 * (áudio transcrito) — o timing precisa ser idêntico nos dois caminhos.
 */
async function suggestReplyDelay(lead: {
  id: string;
  whatsAppNumberId: string | null;
}): Promise<number> {
  const num = lead.whatsAppNumberId
    ? await prisma.whatsAppNumber.findUnique({
        where: { id: lead.whatsAppNumberId },
        select: { replyDelaySeconds: true, firstReplyDelaySeconds: true },
      })
    : null;
  // Existe pelo menos 1 OUTBOUND? findFirst para na 1ª linha (count varre tudo).
  const firstOutbound = await prisma.message.findFirst({
    where: { leadId: lead.id, direction: "OUTBOUND" },
    select: { id: true },
  });
  const seconds = firstOutbound ? num?.replyDelaySeconds ?? 0 : num?.firstReplyDelaySeconds ?? 0;
  return Math.max(0, seconds) * 1000;
}

export async function ingestInbound(input: InboundInput): Promise<IngestResult> {
  // 1. Dedupe
  if (input.providerMessageId) {
    const existing = await prisma.message.findUnique({
      where: { providerMessageId: input.providerMessageId },
      select: { leadId: true },
    });
    if (existing) return { leadId: existing.leadId, deduped: true, respond: false, delayMs: 0 };
  }

  // Localiza o lead (respeitando o isolamento por conta) ou cria o contato.
  const lead = await resolveOrCreateLead(input);
  if (!lead) {
    // NÃO fica mudo: um inbound sem empresa para criar contato (ex.: cloud-api
    // sem mapa) é a causa clássica de "a IA parou de responder". Logar dá o rastro.
    if (input.phone) {
      console.warn(
        `[inbound] descartado: sem empresa p/ criar contato telefone=${input.phone} chip=${input.whatsAppNumberId ?? "—"}`,
      );
    }
    return { leadId: null, respond: false, delayMs: 0 };
  }

  // 1b. Salva inbound. Se o lead citou (reply) uma msg nossa, resolve o stanzaId
  // → providerMessageId → Message.replyToId (mesmo lead). Citada ausente/de outro
  // lead → ignora silenciosamente (a mensagem chega, só sem o vínculo).
  let replyToId: string | undefined;
  if (input.quotedProviderMessageId) {
    const quoted = await prisma.message.findFirst({
      where: { providerMessageId: input.quotedProviderMessageId, leadId: lead.id },
      select: { id: true },
    });
    replyToId = quoted?.id;
  }
  await prisma.message.create({
    data: {
      leadId: lead.id,
      direction: "INBOUND",
      content: input.text,
      providerMessageId: input.providerMessageId ?? undefined,
      replyToId,
    },
  });
  // Nova mensagem → contexto da IA e contadores de inbox (não-lidas) mudaram.
  await invalidateConversation(lead.id);
  await invalidateLeadCaches(lead.userId);

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
    return { leadId: lead.id, respond: false, delayMs: 0 };
  }

  // Lead resolvido voltou a falar → reabre no inbox (antes do gate de billing,
  // pois mesmo com conta suspensa o operador precisa ver a conversa reativa).
  await reopenIfResolved(lead);

  // Gate de billing: conta suspensa (inadimplência) → a IA silencia. O inbound
  // JÁ foi persistido acima (operador continua vendo o que chegou); só não
  // geramos resposta automática. Reativar volta a responder mensagens NOVAS,
  // sem responder retroativamente o acúmulo.
  if (!(await isAccountActiveByLead(lead.id))) {
    return { leadId: lead.id, respond: false, delayMs: 0 };
  }

  // Timing: calcula o atraso (debounce) sugerido. O worker usa isso pra agrupar
  // mensagens picadas; chamadores síncronos (webhook/dev/smoke) ignoram e
  // respondem na hora via handleInbound.
  return { leadId: lead.id, respond: true, delayMs: await suggestReplyDelay(lead) };
}

/**
 * Compat/síncrono: ingere o inbound e, se for o caso, gera a resposta na hora
 * (sem debounce). Usado por webhook cloud-api, simulate-reply (dev) e smoke.
 * O worker Baileys usa ingestInbound + respondToLead (debounce/agrupamento).
 */
export async function handleInbound(
  input: InboundInput,
): Promise<{ leadId: string | null; deduped?: boolean }> {
  const r = await ingestInbound(input);
  if (r.respond && r.leadId) await respondToLead(r.leadId);
  return { leadId: r.leadId, deduped: r.deduped };
}

/**
 * Camada 2 do inbound: gera e envia a resposta da IA. Recarrega o estado FRESCO
 * (o operador pode ter assumido durante a janela de debounce) e:
 *  - reativa a IA se o handoff esfriou (inactivityResumeMinutes do número);
 *  - respeita aiPaused (handoff humano ativo) → silêncio;
 *  - escolha de horário (reunião PROPOSED), qualificação e atendimento.
 */
export async function respondToLead(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;

  // Handoff humano: por padrão a IA fica em silêncio. Mas se a conversa esfriou
  // por mais de inactivityResumeMinutes (config do número), devolvemos o controle
  // à IA — evita lead órfão quando o operador esquece de retomar.
  if (lead.aiPaused) {
    const cfg = lead.whatsAppNumberId
      ? await prisma.whatsAppNumber.findUnique({
          where: { id: lead.whatsAppNumberId },
          select: { inactivityResumeMinutes: true },
        })
      : null;
    const mins = cfg?.inactivityResumeMinutes ?? 0;
    // Idle = tempo desde a ÚLTIMA atividade do humano (aiPausedAt, renovado a cada
    // resposta manual). Mensagens do cliente NÃO zeram o relógio — se o operador
    // sumiu por N min com o lead esperando, a IA reassume. Robusto a msgs picadas.
    const since = lead.aiPausedAt?.getTime() ?? 0;
    const idleMs = since ? Date.now() - since : 0;
    if (mins > 0 && since && idleMs >= mins * 60_000) {
      // Resume por inatividade: devolve o controle à IA e tira do inbox humano.
      await prisma.lead.update({
        where: { id: lead.id },
        data: { aiPaused: false, aiPausedAt: null, attendanceStatus: "IA", assignedToId: null },
      });
      lead.aiPaused = false;
    } else {
      return; // operador no controle
    }
  }

  // 2. NOVO/CONTATADO → EM_CONVERSA
  let status = lead.status;
  if (status === "NOVO" || status === "CONTATADO") {
    status = "EM_CONVERSA";
    await prisma.lead.update({ where: { id: lead.id }, data: { status } });
  }

  if (status === "DESCARTADO") return;

  // 3. Aguardando escolha de horário? Usa a mensagem inbound mais recente.
  const meeting = await prisma.meeting.findUnique({
    where: { leadId: lead.id },
    select: { status: true },
  });
  if (meeting?.status === "PROPOSED") {
    if (!(await aiStillActive(lead.id))) return; // operador assumiu durante o debounce
    // PROPOSED não carrega company aqui; passa null = padrão econômico (peso 1).
    const effectiveModel = await resolveAiModelForUser(lead.userId, null);
    if (!(await ensureAiCredit(lead, effectiveModel))) return; // cota estourada → fila humana
    const lastInbound = await prisma.message.findFirst({
      where: { leadId: lead.id, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    });
    if (lastInbound) await interpretAndBook(lead.id, lastInbound.content);
    return;
  }
  if (status === "REUNIAO_AGENDADA") {
    // Reunião já confirmada — não reprocessa qualificação.
    return;
  }

  // Config da empresa (número) dona da conversa. Default seguro se faltar número.
  const company = lead.whatsAppNumberId
    ? await prisma.whatsAppNumber.findUnique({
        where: { id: lead.whatsAppNumberId },
        select: {
          displayName: true, label: true, aiModel: true, systemPromptOverride: true,
          persona: true, knowledgeBase: true,
          businessHours: true, customInstructions: true,
          autoReplyEnabled: true, qualifyEnabled: true, scheduleEnabled: true,
          salesEnabled: true,
          contextResetMinutes: true,
        },
      })
    : null;

  const mode = decideInboundMode({
    autoReplyEnabled: company?.autoReplyEnabled ?? true,
    qualifyEnabled: company?.qualifyEnabled ?? false,
    scheduleEnabled: company?.scheduleEnabled ?? false,
  });

  // 4. Atendimento é o respondedor padrão. Qualificação/agendamento são opcionais
  //    (toggles da empresa) e apenas pontuam/desviam o fluxo. O modelo configurado
  //    no número (aiModel) vale p/ TODAS as chamadas deste client (qualificação,
  //    próxima pergunta, atendimento).
  // Só cobra crédito quando a IA realmente vai rodar (qualificação ou resposta).
  // Número em handoff total (autoReply + qualify desligados) não aciona a IA → não
  // cobra nem dispara a mensagem de cota; o inbound só fica persistido p/ o humano.
  // Modelo efetivo = override do número, clampado pelo plano (strong só em plano que permite).
  const effectiveModel = await resolveAiModelForUser(lead.userId, company?.aiModel ?? null);
  if (mode.qualify || mode.reply) {
    if (!(await ensureAiCredit(lead, effectiveModel))) return; // cota estourada → fila humana
  }
  const ai = await getAiClient(lead.userId, effectiveModel ?? undefined);
  const conversation = await loadConversation(
    lead.id,
    company?.contextResetMinutes ?? DEFAULT_CONTEXT_RESET_MINUTES,
  );

  let shouldSchedule = false;
  let shouldDiscard = false;

  // Modo vendas: só quando o número tem `salesEnabled`. Carrega as ofertas ATIVAS
  // (fonte do preço + catálogo p/ a IA escolher) e injeta no contexto da
  // qualificação. Sem número não há como escopar ofertas.
  const salesOn = (company?.salesEnabled ?? false) && !!lead.whatsAppNumberId;
  const activeOffers = salesOn && mode.qualify ? await listActiveOffers(lead.whatsAppNumberId!) : [];
  const offersBlock = activeOffers.length ? renderActiveOffers(activeOffers) : undefined;

  // 4a. Qualificação opcional — atualiza score/funil e pode pedir descarte/agenda/venda.
  if (mode.qualify) {
    const qual = await qualifyLead({ ai, leadId: lead.id, leadName: lead.name, conversation, offersBlock });
    const d = decidePipeline({ current: status, score: qual.score, nextAction: qual.nextAction });

    // 4a-i. Venda: a IA sinalizou intenção de compra. Precede agenda/resposta.
    // Só dispara se o modo vendas está ligado E há uma oferta resolvível (a
    // escolhida pela IA, ou a única ativa). Sem isso, cai na resposta livre.
    if (d.shouldOffer) {
      if (salesOn) {
        const offerId = qual.offerId ?? (activeOffers.length === 1 ? activeOffers[0].id : null);
        if (offerId) {
          if (!(await aiStillActive(lead.id))) return; // operador assumiu durante a geração
          const r = await sendOffer(lead, offerId);
          if (r.sent) return; // Pix enviado (lead → OFERTA_ENVIADA); encerra o turno
        }
      }
      // sem oferta resolvível / vendas off / falha → NÃO move o status; segue p/
      // a resposta livre (a IA pede esclarecimento no atendimento).
    } else {
      shouldSchedule = d.shouldSchedule && mode.allowSchedule;
      shouldDiscard = d.shouldDiscard;
      if (d.status !== status) {
        await prisma.lead.update({ where: { id: lead.id }, data: { status: d.status } });
      }
    }
  }

  // 4b. Descartado pela qualificação → silêncio.
  if (shouldDiscard) return;

  // 4c. Agendamento opcional tem precedência sobre a resposta livre.
  if (shouldSchedule) {
    if (!(await aiStillActive(lead.id))) return; // operador assumiu durante a geração
    await proposeSlots(lead.id);
    return;
  }

  // 4d. Atendimento: responde a dúvida no contexto da empresa (sempre que autoReply).
  if (mode.reply) {
    const catalogBlock = await loadCatalogBlock(lead.userId);
    const reply = await generateAttendanceReply({
      ai,
      company: {
        displayName: company?.displayName ?? company?.label ?? null,
        systemPromptOverride: company?.systemPromptOverride ?? null,
        persona: company?.persona ?? null,
        knowledgeBase: company?.knowledgeBase ?? null,
        businessHours: company?.businessHours ?? null,
        customInstructions: company?.customInstructions ?? null,
      },
      catalogBlock,
      conversation,
    });
    // Recheck pós-geração: a chamada da IA leva segundos; nesse meio o operador
    // pode ter assumido (auto-pause/handoff manual, possivelmente em outro
    // processo). Relê o estado fresco e NÃO envia por cima do humano.
    if (!(await aiStillActive(lead.id))) return;
    await sendWhatsAppMessage(lead, reply);
  }
  // !mode.reply → handoff total: só persiste o inbound (humano responde via /reply).
}

/** Bloco de catálogo ativo da conta p/ o contexto da IA (vazio se não há itens). */
async function loadCatalogBlock(accountId: string): Promise<string | undefined> {
  const items = await listCatalogItems(accountId, { activeOnly: true });
  const block = renderCatalogForAI(
    items.map((i) => ({
      name: i.name,
      priceCents: i.priceCents,
      kind: i.kind,
      trackStock: i.trackStock,
      stockQty: i.stockQty,
    })),
  );
  return block || undefined;
}

/**
 * Gera um RASCUNHO de resposta para o operador (botão "Sugerir resposta"),
 * reusando o MESMO motor da resposta automática (mesma persona/base/contexto).
 * NÃO envia nem persiste nada — só devolve o texto para a caixa de resposta
 * manual, que o operador edita e envia (ou descarta).
 *
 * Custo: consome 1 crédito de IA como uma resposta normal — BYOK não conta
 * (chave do cliente); na chave da plataforma debita da cota mensal e respeita o
 * teto (lança se estourou). Escopado por conta (`userId` = dono).
 */
export async function suggestAttendanceReply(
  leadId: string,
  userId: string,
): Promise<string> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, userId },
    select: { id: true, userId: true, whatsAppNumberId: true },
  });
  if (!lead) throw new Error("Conversa não encontrada.");

  // Mesma config do número usada pela resposta automática.
  const company = lead.whatsAppNumberId
    ? await prisma.whatsAppNumber.findUnique({
        where: { id: lead.whatsAppNumberId },
        select: {
          displayName: true, label: true, aiModel: true, systemPromptOverride: true,
          persona: true, knowledgeBase: true, businessHours: true,
          customInstructions: true, contextResetMinutes: true,
        },
      })
    : null;

  // Modelo efetivo (plataforma → econômico) + débito de crédito ANTES de gerar.
  // Teto estourado: lança sem enviar nada (a rota traduz em erro amigável).
  const effectiveModel = await resolveAiModelForUser(lead.userId, company?.aiModel ?? null);
  const credit = await consumeAiCredit(lead.userId, effectiveModel);
  if (!credit.allowed) {
    throw new Error("Cota de IA do mês esgotada — não é possível sugerir agora.");
  }

  const ai = await getAiClient(lead.userId, effectiveModel ?? undefined);
  const conversation = await computeConversation(
    lead.id,
    company?.contextResetMinutes ?? DEFAULT_CONTEXT_RESET_MINUTES,
  );

  const catalogBlock = await loadCatalogBlock(lead.userId);

  return generateAttendanceReply({
    ai,
    company: {
      displayName: company?.displayName ?? company?.label ?? null,
      systemPromptOverride: company?.systemPromptOverride ?? null,
      persona: company?.persona ?? null,
      knowledgeBase: company?.knowledgeBase ?? null,
      businessHours: company?.businessHours ?? null,
      customInstructions: company?.customInstructions ?? null,
    },
    catalogBlock,
    conversation,
  });
}

/**
 * Garante 1 crédito de IA antes de gerar resposta na chave da plataforma.
 * BYOK/grandfather/admin sempre passam. Se a cota estourou: manda a mensagem
 * fixa, joga o lead pra fila humana (aiPaused) e devolve false — o chamador
 * deve abortar a geração. `lead` precisa dos campos de envio + SLA do inbox.
 */
async function ensureAiCredit(
  lead: {
    id: string;
    userId: string;
    phone: string;
    whatsAppNumberId: string | null;
    queuedAt: Date | null;
  },
  model: string | null,
): Promise<boolean> {
  const credit = await consumeAiCredit(lead.userId, model);
  if (credit.allowed) return true;
  // Teto atingido → handoff suave: humano assume, sem deixar o lead no vácuo.
  // SYSTEM: mensagem canned de cota estourada, não conta como resposta da IA.
  await sendWhatsAppMessage(lead, AI_QUOTA_EXCEEDED_MESSAGE, { source: "SYSTEM" });
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      aiPaused: true,
      aiPausedAt: new Date(),
      attendanceStatus: "FILA",
      // Só inicia o SLA do inbox se o lead ainda não estava na fila (igual setHandoff).
      ...(lead.queuedAt ? {} : { queuedAt: new Date() }),
    },
  });
  return false;
}

/** True se a IA ainda pode responder (não foi pausada). Recheck fresco anti-corrida. */
async function aiStillActive(leadId: string): Promise<boolean> {
  const l = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { aiPaused: true },
  });
  return !l?.aiPaused;
}

/**
 * Handoff humano: pausa (paused=true) ou retoma (paused=false) a IA para o lead.
 * Com aiPaused=true, handleInbound só persiste o inbound e o operador responde
 * manualmente via sendManualReply. Escopado por conta (userId).
 */
export async function setHandoff(leadId: string, userId: string, paused: boolean) {
  const exists = await prisma.lead.findFirst({
    where: { id: leadId, userId },
    select: { id: true, queuedAt: true },
  });
  if (!exists) throw new Error("Lead não encontrado");
  // Handoff também movimenta a camada de atendimento (inbox): pausar = entra na
  // FILA (marcando o início do SLA); retomar = volta à IA e libera a atribuição.
  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: paused
      ? {
          aiPaused: true,
          aiPausedAt: new Date(),
          attendanceStatus: "FILA",
          aiResumePendingAt: null, // operador reassumiu → descarta sinal pendente
          ...(exists.queuedAt ? {} : { queuedAt: new Date() }),
        }
      : {
          aiPaused: false,
          aiPausedAt: null,
          attendanceStatus: "IA",
          assignedToId: null,
          // Sinaliza o worker p/ responder a backlog (se houver) sem esperar novo
          // inbound. O worker consome, revalida e só responde se o lead aguarda.
          aiResumePendingAt: new Date(),
        },
  });
  await invalidateLeadCaches(userId); // FILA/IA mudou os contadores de inbox
  return updated;
}

/**
 * O lead está aguardando uma resposta da IA? = a mensagem textual mais recente é
 * INBOUND, sem nenhuma OUTBOUND depois. Placeholders de mídia não contam (a IA não
 * lê o arquivo; mídia sozinha nunca aciona resposta hoje). Usado p/ decidir se a
 * devolução à IA / o resume por inatividade deve responder a backlog na hora.
 */
export async function isLeadAwaitingAiReply(leadId: string): Promise<boolean> {
  const recent = await prisma.message.findMany({
    where: { leadId },
    orderBy: { createdAt: "desc" },
    take: CONVERSATION_CONTEXT_LIMIT,
    select: { direction: true, content: true },
  });
  for (const m of recent) {
    if (m.direction === "OUTBOUND") return false; // último turno já respondido
    if (MEDIA_PLACEHOLDERS.has(m.content)) continue; // mídia não conta como pergunta
    return true; // INBOUND textual sem resposta depois
  }
  return false;
}

/**
 * Reconciliação periódica (worker): retorna os leadIds que devem RECEBER uma
 * resposta da IA agora, mesmo sem inbound novo. Dois gatilhos:
 *  1. Devolução manual à IA: `aiResumePendingAt` setado pela rota web (handback/
 *     resolve). É consumido e limpo aqui (one-shot).
 *  2. Resume por inatividade: handoff humano esfriou além de
 *     `inactivityResumeMinutes` (config do número) e o lead ainda aguarda.
 * Em ambos só nudga se `isLeadAwaitingAiReply`. O chamador agenda
 * `scheduleResponse(id, 0)`; o `respondToLead` revalida todo o estado fresco
 * (aiPaused, status, cota) — esta função só seleciona candidatos.
 */
export async function reconcileAiResume(now: Date): Promise<string[]> {
  const ids = new Set<string>();

  // 1. Sinais de devolução manual à IA (web grava no banco; worker consome).
  const pending = await prisma.lead.findMany({
    where: { aiResumePendingAt: { not: null } },
    select: { id: true },
  });
  if (pending.length > 0) {
    await prisma.lead.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { aiResumePendingAt: null },
    });
    for (const p of pending) {
      if (await isLeadAwaitingAiReply(p.id)) ids.add(p.id);
    }
  }

  // 2. Resume por inatividade: o relógio do handoff (aiPausedAt) passou do limite
  //    do número. Sem número não há config de inatividade → não entra.
  const paused = await prisma.lead.findMany({
    where: { aiPaused: true, aiPausedAt: { not: null }, whatsAppNumberId: { not: null } },
    select: { id: true, aiPausedAt: true, whatsAppNumberId: true },
  });
  if (paused.length > 0) {
    const numberIds = [...new Set(paused.map((l) => l.whatsAppNumberId as string))];
    const nums = await prisma.whatsAppNumber.findMany({
      where: { id: { in: numberIds } },
      select: { id: true, inactivityResumeMinutes: true },
    });
    const minsById = new Map(nums.map((n) => [n.id, n.inactivityResumeMinutes]));
    for (const l of paused) {
      const mins = minsById.get(l.whatsAppNumberId as string) ?? 0;
      if (mins <= 0 || !l.aiPausedAt) continue;
      if (now.getTime() - l.aiPausedAt.getTime() < mins * 60_000) continue;
      if (await isLeadAwaitingAiReply(l.id)) ids.add(l.id);
    }
  }

  return [...ids];
}

/**
 * Resposta manual do operador: envia uma mensagem OUTBOUND ao lead pelo mesmo
 * chip e persiste como Message(OUTBOUND) — reaproveita sendWhatsAppMessage, a
 * fonte única de verdade de envio. Escopado por conta (userId).
 */
export async function sendManualReply(
  leadId: string,
  userId: string,
  content: string,
  replyToMessageId?: string | null,
) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, userId },
    select: {
      id: true, phone: true, userId: true, whatsAppNumberId: true, aiPaused: true,
      queuedAt: true, firstResponseAt: true, attendanceStatus: true,
    },
  });
  if (!lead) throw new Error("Lead não encontrado");
  // No Baileys o socket vive só no worker; o web não envia direto (no_socket).
  // Enfileira a intenção e o worker drena/envia. Mock/cloud-api enviam por HTTP,
  // então rodam direto no web. A citação (reply) viaja em ambos os caminhos.
  if (env.WHATSAPP_MODE === "baileys") {
    await enqueueManualReply(lead, content, { replyToMessageId });
  } else {
    await sendWhatsAppMessage(lead, content, { replyToMessageId, source: "OPERATOR" });
  }
  // Operador respondeu pela tela do CRM: renova o relógio de inatividade p/ o
  // resume automático medir o silêncio a partir de agora (não desde a pausa) e
  // atualiza a camada de atendimento (SLA + estado).
  const data: Record<string, unknown> = {};
  if (lead.aiPaused) data.aiPausedAt = new Date();
  applyManualResponseAttendance(lead, data);
  if (Object.keys(data).length > 0) {
    await prisma.lead.update({ where: { id: lead.id }, data });
  }
  await invalidateLeadCaches(userId); // ATENDENDO→AGUARDANDO / SLA → contadores
}

/**
 * Envio manual de ANEXO pelo operador (imagem/documento/áudio pela inbox). O
 * arquivo já foi subido ao storage pela rota (media.mediaPath); o buffer viaja
 * junto só p/ o caminho direto (mock/cloud-api). No Baileys enfileira (o worker
 * envia); nos demais envia na hora. Espelha sendManualReply nos efeitos de
 * atendimento (SLA, relógio de inatividade, contadores). Escopado por conta.
 */
export async function sendManualMedia(
  leadId: string,
  userId: string,
  media: {
    buffer: Buffer;
    mediaPath: string;
    mediaType: "image" | "document" | "audio";
    mediaMime: string;
    fileName?: string | null;
  },
  opts: { caption?: string; replyToMessageId?: string | null } = {},
) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, userId },
    select: {
      id: true, phone: true, userId: true, whatsAppNumberId: true, aiPaused: true,
      queuedAt: true, firstResponseAt: true, attendanceStatus: true,
    },
  });
  if (!lead) throw new Error("Lead não encontrado");
  const meta = {
    mediaPath: media.mediaPath,
    mediaType: media.mediaType,
    mediaMime: media.mediaMime,
    fileName: media.fileName ?? null,
  };
  if (env.WHATSAPP_MODE === "baileys") {
    await enqueueManualMedia(lead, meta, opts);
  } else {
    await sendWhatsAppMedia(lead, { ...meta, buffer: media.buffer }, { ...opts, source: "OPERATOR" });
  }
  // Mesmos efeitos de uma resposta manual de texto: renova o relógio de
  // inatividade (lead pausado) e movimenta o atendimento (SLA + estado).
  const data: Record<string, unknown> = {};
  if (lead.aiPaused) data.aiPausedAt = new Date();
  applyManualResponseAttendance(lead, data);
  if (Object.keys(data).length > 0) {
    await prisma.lead.update({ where: { id: lead.id }, data });
  }
  await invalidateLeadCaches(userId);
}

/**
 * Efeitos de uma resposta humana sobre a camada de atendimento (mutável `data`):
 *  - fecha o SLA (firstResponseAt) na 1ª resposta após entrar na fila;
 *  - ATENDENDO → AGUARDANDO (operador respondeu, bola com o cliente).
 */
function applyManualResponseAttendance(
  lead: { queuedAt: Date | null; firstResponseAt: Date | null; attendanceStatus: AttendanceStatus },
  data: Record<string, unknown>,
) {
  if (lead.queuedAt && !lead.firstResponseAt) data.firstResponseAt = new Date();
  if (lead.attendanceStatus === "ATENDENDO") data.attendanceStatus = "AGUARDANDO";
}

/**
 * Mensagem `fromMe` que NÃO é do bot: o operador respondeu manualmente pelo
 * próprio WhatsApp do número. Registra como OUTBOUND (histórico do CRM) e, se o
 * número tiver autoPauseOnHumanReply, pausa a IA (handoff automático). O pool já
 * filtra os ecos das mensagens que o próprio bot enviou (set sentByBot), então
 * aqui só chega texto digitado por humano. Devolve o leadId p/ o worker cancelar
 * qualquer resposta em debounce pendente.
 */
export async function handleOperatorMessage(input: {
  toPhone: string;
  text: string;
  providerMessageId: string | null;
  whatsAppNumberId: string;
}): Promise<{ leadId: string | null }> {
  // Backup ao filtro em memória do pool: se o id já está gravado, é o nosso
  // próprio envio (ou já processado) — não duplica nem auto-pausa.
  if (input.providerMessageId) {
    const existing = await prisma.message.findUnique({
      where: { providerMessageId: input.providerMessageId },
      select: { leadId: true },
    });
    if (existing) return { leadId: existing.leadId };
  }
  const lead = await resolveLead({
    whatsAppNumberId: input.whatsAppNumberId,
    phone: input.toPhone,
    text: input.text,
  });
  if (!lead) return { leadId: null };

  try {
    await prisma.message.create({
      data: {
        leadId: lead.id,
        direction: "OUTBOUND",
        content: input.text,
        providerMessageId: input.providerMessageId ?? undefined,
        status: "SENT",
        whatsAppNumberId: input.whatsAppNumberId,
        source: "OPERATOR", // operador respondeu digitando no próprio WhatsApp
      },
    });
  } catch (e) {
    // Race com o eco do próprio bot: o envio do bot persistiu o mesmo
    // providerMessageId entre o findUnique acima e aqui. É mensagem NOSSA,
    // não do operador — não auto-pausa. (P2002 = unique constraint do Prisma.)
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      return { leadId: lead.id };
    }
    throw e;
  }
  await applyOperatorHandoff(lead, input.whatsAppNumberId);
  return { leadId: lead.id };
}

/**
 * Arquivo enviado pelo operador pelo PRÓPRIO WhatsApp do número (fromMe mídia):
 * grava como Message(OUTBOUND) com o anexo (mediaPath/mediaType/...) p/ aparecer
 * no inbox, igual ao que o lead manda — fechando o buraco de histórico. Reaproveita
 * o mesmo uploader e o mesmo handoff da resposta de texto (handleOperatorMessage).
 * NÃO transcreve (é resposta humana de saída, não pergunta) nem avisa "só leio texto".
 */
export async function handleOperatorMedia(input: {
  toPhone: string;
  placeholder: string;
  providerMessageId: string | null;
  whatsAppNumberId: string;
  caption?: string | null;
  buffer?: Buffer;
  mediaType?: "image" | "audio" | "document";
  mime?: string;
  fileName?: string;
}): Promise<{ leadId: string | null }> {
  // Backup ao filtro em memória do pool (sentByBot): id já gravado = nosso envio.
  if (input.providerMessageId) {
    const existing = await prisma.message.findUnique({
      where: { providerMessageId: input.providerMessageId },
      select: { leadId: true },
    });
    if (existing) return { leadId: existing.leadId };
  }
  const lead = await resolveLead({
    whatsAppNumberId: input.whatsAppNumberId,
    phone: input.toPhone,
    text: input.placeholder,
  });
  if (!lead) return { leadId: null };

  // Sobe o arquivo (se baixável e o storage estiver configurado) — mesmo uploader
  // do inbound; falha/sem storage → segue só com o placeholder textual.
  let media: {
    mediaPath: string;
    mediaType: string;
    mediaMime?: string;
    fileName?: string;
  } | null = null;
  if (input.buffer && input.mediaType) {
    const ext = (input.fileName?.split(".").pop() || input.mime?.split("/")[1] || "bin")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase();
    const path = await uploadInboundMedia(input.buffer, {
      leadId: lead.id,
      // providerMessageId é único; sem ele (raro), UUID evita colisão de path.
      messageKey: input.providerMessageId ?? `out-${crypto.randomUUID()}`,
      mime: input.mime ?? "application/octet-stream",
      ext: ext || "bin",
    });
    if (path) {
      media = {
        mediaPath: path,
        mediaType: input.mediaType,
        mediaMime: input.mime,
        fileName: input.fileName,
      };
    }
  }

  try {
    await prisma.message.create({
      data: {
        leadId: lead.id,
        direction: "OUTBOUND",
        // legenda quando o operador digitou junto; senão o placeholder ("📷 Imagem").
        content: input.caption?.trim() ? input.caption : input.placeholder,
        providerMessageId: input.providerMessageId ?? undefined,
        status: "SENT",
        whatsAppNumberId: input.whatsAppNumberId,
        source: "OPERATOR",
        ...(media ?? {}),
      },
    });
  } catch (e) {
    // Race com o eco do próprio bot (mesmo providerMessageId) → não duplica.
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      return { leadId: lead.id };
    }
    throw e;
  }
  await applyOperatorHandoff(lead, input.whatsAppNumberId);
  return { leadId: lead.id };
}

/**
 * Efeitos de uma resposta manual do operador FEITA PELO ZAP (texto ou mídia) sobre
 * o estado da conversa. Fonte única p/ handleOperatorMessage e handleOperatorMedia:
 *  - invalida o contexto da IA (novo OUTBOUND);
 *  - pausa a IA (handoff automático) só se o número tiver autoPauseOnHumanReply;
 *  - renova o relógio de inatividade quando o lead já estava pausado (senão o
 *    resume automático reativaria a IA no meio do atendimento humano pelo zap);
 *  - fecha o SLA e move ATENDENDO→AGUARDANDO (applyManualResponseAttendance).
 */
async function applyOperatorHandoff(
  lead: {
    id: string;
    aiPaused: boolean;
    queuedAt: Date | null;
    firstResponseAt: Date | null;
    attendanceStatus: AttendanceStatus;
  },
  whatsAppNumberId: string,
): Promise<void> {
  await invalidateConversation(lead.id);
  const num = await prisma.whatsAppNumber.findUnique({
    where: { id: whatsAppNumberId },
    select: { autoPauseOnHumanReply: true },
  });
  const data: Record<string, unknown> = {};
  if (num?.autoPauseOnHumanReply) {
    data.aiPaused = true;
    data.aiPausedAt = new Date();
  } else if (lead.aiPaused) {
    data.aiPausedAt = new Date();
  }
  applyManualResponseAttendance(lead, data);
  if (Object.keys(data).length > 0) {
    await prisma.lead.update({ where: { id: lead.id }, data });
  }
}
