import { prisma } from "@/server/db/client";
import type { AttendanceStatus } from "@prisma/client";
import type { ConversationTurn } from "@/server/ai/qualification.agent";
import { sessionWindow } from "@/server/ai/transcript";
import { generateAttendanceReply } from "@/server/ai/conversation.agent";
import { getAiClient } from "@/server/ai/resolve";
import { qualifyLead } from "./qualification.service";
import { decideInboundMode } from "./inbound-mode";
import { decidePipeline } from "./pipeline";
import { interpretAndBook, proposeSlots } from "./scheduling.service";
import { sendWhatsAppMessage } from "./messaging";
import { isOptOut } from "@/lib/optout";
import { brPhoneVariants } from "@/lib/phone";
import { shouldCreateContact } from "./inbound-resolve";
import { isAccountActiveByLead } from "@/server/services/account.service";

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
 *  quadrática ao longo da vida do lead; 25 turnos cobrem o contexto recente. É um
 *  limite de SEGURANÇA: a janela de sessão (silêncio) costuma cortar bem antes. */
const CONVERSATION_CONTEXT_LIMIT = 25;

/** Reset de contexto por silêncio (min) quando o número não define o seu. */
const DEFAULT_CONTEXT_RESET_MINUTES = 180;

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
  // Pega as últimas N (createdAt desc + take) e reverte p/ ordem cronológica.
  const messages = await prisma.message.findMany({
    where: { leadId },
    orderBy: { createdAt: "desc" },
    take: CONVERSATION_CONTEXT_LIMIT,
    select: { direction: true, content: true, createdAt: true },
  });
  const chronological = messages.reverse();
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
 * Camada 1 do inbound (SÍNCRONA, sempre roda na hora): dedupe → resolve/cria o
 * lead → persiste a Message(INBOUND) → trata opt-out (LGPD). NÃO gera a resposta
 * da IA — isso é `respondToLead`, que o worker pode adiar/agrupar (debounce).
 * Devolve se vale responder e o atraso sugerido (timing por número).
 */
export async function ingestInbound(input: InboundInput): Promise<IngestResult> {
  // 1. Dedupe
  if (input.providerMessageId) {
    const existing = await prisma.message.findUnique({
      where: { providerMessageId: input.providerMessageId },
      select: { leadId: true },
    });
    if (existing) return { leadId: existing.leadId, deduped: true, respond: false, delayMs: 0 };
  }

  // Localiza o lead (respeitando o isolamento por conta)
  let lead = await resolveLead(input);

  if (!lead) {
    // Atendimento: inbound de um telefone desconhecido CRIA o contato atrelado à
    // empresa (número) que recebeu. Sem a empresa (cloud-api sem mapa) não criamos.
    if (shouldCreateContact({ matched: false, whatsAppNumberId: input.whatsAppNumberId, phone: input.phone })) {
      // Descobre o dono (operador) a partir da empresa (número) que recebeu.
      const num = await prisma.whatsAppNumber.findUnique({
        where: { id: input.whatsAppNumberId! },
        select: { userId: true },
      });
      if (num) {
        lead = await prisma.lead.create({
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
    }
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
    return { leadId: lead.id, respond: false, delayMs: 0 };
  }

  // Gate de billing: conta suspensa (inadimplência) → a IA silencia. O inbound
  // JÁ foi persistido acima (operador continua vendo o que chegou); só não
  // geramos resposta automática. Reativar volta a responder mensagens NOVAS,
  // sem responder retroativamente o acúmulo.
  if (!(await isAccountActiveByLead(lead.id))) {
    return { leadId: lead.id, respond: false, delayMs: 0 };
  }

  // Timing: calcula o atraso (debounce) sugerido. A 1ª resposta da conversa usa
  // um tempo próprio; as demais usam o padrão. O worker usa isso pra agrupar
  // mensagens picadas; chamadores síncronos (webhook/dev/smoke) ignoram e
  // respondem na hora via handleInbound.
  const num = lead.whatsAppNumberId
    ? await prisma.whatsAppNumber.findUnique({
        where: { id: lead.whatsAppNumberId },
        select: { replyDelaySeconds: true, firstReplyDelaySeconds: true },
      })
    : null;
  const hasOutbound =
    (await prisma.message.count({ where: { leadId: lead.id, direction: "OUTBOUND" } })) > 0;
  const seconds = hasOutbound ? num?.replyDelaySeconds ?? 0 : num?.firstReplyDelaySeconds ?? 0;
  return { leadId: lead.id, respond: true, delayMs: Math.max(0, seconds) * 1000 };
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
  const ai = await getAiClient(lead.userId, company?.aiModel ?? undefined);
  const conversation = await loadConversation(
    lead.id,
    company?.contextResetMinutes ?? DEFAULT_CONTEXT_RESET_MINUTES,
  );

  let shouldSchedule = false;
  let shouldDiscard = false;

  // 4a. Qualificação opcional — atualiza score/funil e pode pedir descarte/agenda.
  if (mode.qualify) {
    const qual = await qualifyLead({ ai, leadId: lead.id, leadName: lead.name, conversation });
    const d = decidePipeline({ current: status, score: qual.score, nextAction: qual.nextAction });
    shouldSchedule = d.shouldSchedule && mode.allowSchedule;
    shouldDiscard = d.shouldDiscard;
    if (d.status !== status) {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: d.status } });
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
  return prisma.lead.update({
    where: { id: leadId },
    data: paused
      ? {
          aiPaused: true,
          aiPausedAt: new Date(),
          attendanceStatus: "FILA",
          ...(exists.queuedAt ? {} : { queuedAt: new Date() }),
        }
      : {
          aiPaused: false,
          aiPausedAt: null,
          attendanceStatus: "IA",
          assignedToId: null,
        },
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
    select: {
      id: true, phone: true, userId: true, whatsAppNumberId: true, aiPaused: true,
      queuedAt: true, firstResponseAt: true, attendanceStatus: true,
    },
  });
  if (!lead) throw new Error("Lead não encontrado");
  await sendWhatsAppMessage(lead, content);
  // Operador respondeu pela tela do CRM: renova o relógio de inatividade p/ o
  // resume automático medir o silêncio a partir de agora (não desde a pausa) e
  // atualiza a camada de atendimento (SLA + estado).
  const data: Record<string, unknown> = {};
  if (lead.aiPaused) data.aiPausedAt = new Date();
  applyManualResponseAttendance(lead, data);
  if (Object.keys(data).length > 0) {
    await prisma.lead.update({ where: { id: lead.id }, data });
  }
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

  const num = await prisma.whatsAppNumber.findUnique({
    where: { id: input.whatsAppNumberId },
    select: { autoPauseOnHumanReply: true },
  });
  try {
    await prisma.message.create({
      data: {
        leadId: lead.id,
        direction: "OUTBOUND",
        content: input.text,
        providerMessageId: input.providerMessageId ?? undefined,
        status: "SENT",
        whatsAppNumberId: input.whatsAppNumberId,
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
  // Duas responsabilidades distintas:
  //  - pausar a IA (handoff automático) só se o número tiver autoPauseOnHumanReply;
  //  - renovar o relógio de inatividade SEMPRE que o humano falar com um lead já
  //    pausado (senão o resume automático reativaria a IA no meio do atendimento
  //    humano feito pelo zap). Espelha sendManualReply.
  // Resposta humana pelo zap conta no inbox: fecha o SLA e move ATENDENDO→AGUARDANDO.
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
  return { leadId: lead.id };
}
