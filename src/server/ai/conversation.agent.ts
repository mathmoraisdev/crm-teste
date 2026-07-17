import { ATTENDANCE_SYSTEM, CONVERSATION_SYSTEM, SLOT_CHOICE_SYSTEM } from "./prompts";
import {
  buildAttendanceContext,
  buildNowBlock,
  renderSystemPromptOverride,
} from "./attendance-context";
import {
  slotChoiceJsonSchema,
  slotChoiceSchema,
  apptReplyJsonSchema,
  apptReplySchema,
  type ApptReply,
  type QualificationResult,
  type SlotChoice,
} from "./schemas";
import { formatTranscript, type ConversationTurn } from "./transcript";
import { stripMarkdownLinks, stripSpeakerLabel } from "./sanitize";
import type { AiClient, LoopMessage, ToolDef } from "./provider";

/**
 * Agente de conversa (tier "cheap") — gera a PRÓXIMA pergunta de qualificação.
 * Usa o resumo da qualificação atual como contexto do que ainda falta saber.
 */
export async function generateNextQuestion(opts: {
  ai: AiClient;
  leadName: string;
  conversation: ConversationTurn[];
  qualification: QualificationResult;
}): Promise<string> {
  const text = await opts.ai.generateText({
    tier: "cheap",
    maxTokens: 300,
    system: CONVERSATION_SYSTEM,
    user:
      `Lead: ${opts.leadName}\n` +
      `Leitura atual da IA: ${opts.qualification.summary} (score ${opts.qualification.score})\n\n` +
      `Conversa:\n${formatTranscript(opts.conversation)}\n\n` +
      `Escreva a próxima mensagem.`,
  });
  return stripSpeakerLabel(
    stripMarkdownLinks(text || "Pode me contar um pouco mais sobre o seu cenário atual?"),
  );
}

/**
 * Interpreta a escolha de horário do lead (tier "cheap", function calling forçado).
 * Recebe os slots propostos (formatados, já numerados) e a resposta do lead.
 */
export async function interpretSlotChoice(opts: {
  ai: AiClient;
  formattedSlots: string[]; // legíveis, índice = posição
  leadMessage: string;
  nowLabel?: string; // data/hora atual legível — base p/ resolver "amanhã/semana que vem"
}): Promise<SlotChoice> {
  const list = opts.formattedSlots.map((s, i) => `[${i}] ${s}`).join("\n");
  const dateLine = opts.nowLabel ? `Data/hora atual: ${opts.nowLabel}\n\n` : "";
  const input = await opts.ai.forcedToolCall({
    tier: "cheap",
    maxTokens: 256,
    system: SLOT_CHOICE_SYSTEM,
    user: `${dateLine}Horários oferecidos:\n${list}\n\nMensagem do lead: "${opts.leadMessage}"`,
    toolName: "registrar_escolha",
    toolDescription: "Registra qual horário o lead escolheu.",
    jsonSchema: slotChoiceJsonSchema as unknown as Record<string, unknown>,
  });
  if (input == null) return { chosenIndex: null, confident: false, preferredStartIso: null };
  const parsed = slotChoiceSchema.safeParse(input);
  return parsed.success
    ? parsed.data
    : { chosenIndex: null, confident: false, preferredStartIso: null };
}

const APPT_REPLY_SYSTEM =
  "Você classifica a resposta de um cliente a um lembrete de agendamento de serviço. " +
  "Responda SÓ com a tool. intent=confirm quando ele confirma presença (ex.: 'confirmo', 'pode marcar', 'estarei lá', 'ok', '👍'); " +
  "intent=decline quando não vai / quer desmarcar (ex.: 'não vou poder', 'cancela', 'não consigo ir'); " +
  "intent=reschedule quando quer OUTRA data/horário (ex.: 'dá pra passar pra sexta?', 'tem horário de manhã?'); " +
  "intent=unclear quando fala de outro assunto, faz pergunta, ou não dá pra saber. Na dúvida entre confirm e unclear, escolha unclear.";

/**
 * Classifica a última mensagem do cliente em relação a um agendamento já lembrado.
 * Mesma forma de `interpretSlotChoice`: tool-call forçado, modelo barato, degrada
 * para "unclear" (não-confiante) em qualquer falha — nunca deixa o fluxo travar.
 */
export async function interpretAppointmentReply(opts: {
  ai: AiClient;
  serviceName: string | null;
  whenLabel: string; // data/hora formatada do agendamento (contexto p/ a IA)
  leadMessage: string;
}): Promise<ApptReply> {
  const servico = opts.serviceName?.trim() || "atendimento";
  const input = await opts.ai.forcedToolCall({
    tier: "cheap",
    maxTokens: 256,
    system: APPT_REPLY_SYSTEM,
    user: `Agendamento: ${servico} em ${opts.whenLabel}.\n\nMensagem do cliente: "${opts.leadMessage}"`,
    toolName: "classificar_resposta",
    toolDescription: "Classifica a resposta do cliente ao lembrete de agendamento.",
    jsonSchema: apptReplyJsonSchema as unknown as Record<string, unknown>,
  });
  if (input == null) return { intent: "unclear", confident: false };
  const parsed = apptReplySchema.safeParse(input);
  return parsed.success ? parsed.data : { intent: "unclear", confident: false };
}

/**
 * Bloco de data/hora ATUAL injetado no prompt de atendimento, no fuso do número.
 * O modelo não recebe timestamps no transcript, então sem isto ele não sabe que
 * dia/hora são — o que quebra avisos com validade ("válido até DD/MM"), perguntas
 * tipo "abrem hoje?" e, principalmente, a regra de expediente (aberto/fechado).
 *
 * Diferente da versão antiga (só DATA em fuso fixo Brasília), agora envia DATA +
 * HORA + dia da semana + fuso + expediente no fuso real do número — assim o mesmo
 * prompt funciona para qualquer empresa/estado. `now` injetável p/ testes.
 *
 * O fuso deve vir RESOLVIDO (string IANA válida) do chamador de servidor
 * (`conversation.service`, via `resolveTimezone`) — este módulo é importado por
 * testes de agent puros que não carregam `@/lib/env`, então evitamos importá-lo
 * aqui. Fallback local só p/ testes diretos sem número.
 */
function attendanceNowBlock(
  tz: string | null | undefined,
  businessHours: string | null | undefined,
  now?: Date,
): string {
  return buildNowBlock({ tz: tz || DEFAULT_TZ, businessHours, now });
}

/** Fuso de segurança quando o chamador de teste não resolve (runtime usa o do número). */
const DEFAULT_TZ = "America/Sao_Paulo";

interface AttendanceCompany {
  displayName?: string | null;
  systemPromptOverride?: string | null;
  persona?: string | null;
  knowledgeBase?: string | null;
  businessHours?: string | null;
  businessAddress?: string | null;
  customInstructions?: string | null;
  /** Fuso IANA já RESOLVIDO pelo chamador de servidor (resolveTimezone). */
  timezone?: string | null;
}

/**
 * Monta (PURA) o `system` base + o prefixo de contexto (empresa/catálogo/extra)
 * comum aos dois caminhos de atendimento — a resposta livre (`generateText`) e o
 * loop de tools (`runToolLoop`). Prompt mestre da empresa (override), quando
 * setado, SUBSTITUI o padrão. Antes o override zera todo o contexto; agora ele
 * ainda recebe: (a) substituição de placeholders de data/hora/fuso/expediente
 * (ex.: {{DATA_E_HORA_DO_SISTEMA}}) e (b) o bloco de contexto "agora" injetado à
 * parte pelo chamador — garantindo que a IA saiba a hora real mesmo no override.
 * Extrai o trecho para não duplicar entre os dois caminhos.
 */
function buildAttendancePrompt(opts: {
  company: AttendanceCompany;
  catalogBlock?: string;
  now?: Date;
}): { system: string; contextPrefix: string; nowBlock: string } {
  const tz = opts.company.timezone || DEFAULT_TZ;
  const overrideRaw = opts.company.systemPromptOverride?.trim();
  // Override tem placeholders de data/hora/fuso/expediente resolvidos no fuso do
  // número — antes iam cru para o LLM (bug "cartório fechado": a IA não sabia a hora).
  const override = overrideRaw
    ? renderSystemPromptOverride(overrideRaw, {
        tz,
        businessHours: opts.company.businessHours,
        now: opts.now,
      })
    : null;
  const system = override || ATTENDANCE_SYSTEM;
  const context = override ? "" : buildAttendanceContext(opts.company);
  const catalog = !override && opts.catalogBlock ? `\n\n${opts.catalogBlock}` : "";
  const extra =
    !override && opts.company.customInstructions
      ? `\n\nInstruções adicionais da empresa:\n${opts.company.customInstructions}`
      : "";
  const contextPrefix = context || catalog || extra ? `${context}${catalog}${extra}\n\n` : "";
  const nowBlock = attendanceNowBlock(tz, opts.company.businessHours, opts.now);
  return { system, contextPrefix, nowBlock };
}

/**
 * Agente de ATENDIMENTO — gera a próxima mensagem respondendo o cliente no
 * contexto da empresa (persona + base de conhecimento + horário).
 */
export async function generateAttendanceReply(opts: {
  ai: AiClient;
  company: AttendanceCompany;
  catalogBlock?: string;
  conversation: ConversationTurn[];
  /** Instante de referência (default agora). Injetável p/ testes determinísticos. */
  now?: Date;
}): Promise<string> {
  const { system, contextPrefix, nowBlock } = buildAttendancePrompt(opts);
  const text = await opts.ai.generateText({
    tier: "cheap",
    maxTokens: 700,
    system,
    user:
      `${nowBlock}\n\n` +
      `${contextPrefix}` +
      `Conversa:\n${formatTranscript(opts.conversation)}\n\n` +
      `Escreva a próxima mensagem ao cliente.`,
  });
  return stripSpeakerLabel(stripMarkdownLinks(text || "Oi! Como posso te ajudar?"));
}

/** Converte o transcript em mensagens do loop (INBOUND→user, OUTBOUND→assistant). */
function conversationToLoopMessages(turns: ConversationTurn[]): LoopMessage[] {
  return turns.map((t) => ({
    role: t.direction === "INBOUND" ? "user" : "assistant",
    content: t.content,
  }));
}

export interface AgenticReplyResult {
  text: string;
  toolsUsed: string[];
  stopped: boolean;
}

/**
 * Agente de ATENDIMENTO com AÇÕES (caminho agêntico) — espelha
 * `generateAttendanceReply`, mas roda o loop de tools em vez de uma geração de
 * texto. O bloco de contexto (empresa/catálogo) vai no `system` porque as
 * `messages` carregam o transcript turno-a-turno. A sanitização do texto final é
 * idêntica; devolve também as tools usadas e se um handler encerrou o turno.
 */
export async function generateAgenticReply(opts: {
  ai: AiClient;
  company: AttendanceCompany;
  catalogBlock?: string;
  conversation: ConversationTurn[];
  tools: ToolDef[];
  /** Bloco de mídias disponíveis (assetId + label) p/ a IA escolher em enviar_midia. */
  mediaBlock?: string;
  /** Bloco de ofertas ativas (offerId + preço) p/ a IA escolher em enviar_oferta. */
  offersBlock?: string;
  /** Bloco AGENDAMENTO (serviceId/professionalId + link) p/ a IA usar em agendar. */
  bookingBlock?: string;
  /** Instante de referência (default agora). Injetável p/ testes determinísticos. */
  now?: Date;
}): Promise<AgenticReplyResult> {
  const { system: baseSystem, contextPrefix, nowBlock } = buildAttendancePrompt(opts);
  const contextBlock = contextPrefix.trimEnd();
  const offers = opts.offersBlock?.trim() ? `\n\n${opts.offersBlock.trim()}` : "";
  const media = opts.mediaBlock?.trim() ? `\n\n${opts.mediaBlock.trim()}` : "";
  const booking = opts.bookingBlock?.trim() ? `\n\n${opts.bookingBlock.trim()}` : "";
  const system =
    `${baseSystem}\n\n${nowBlock}` +
    (contextBlock ? `\n\n${contextBlock}` : "") +
    offers +
    media +
    booking;
  const messages = conversationToLoopMessages(opts.conversation);
  const result = await opts.ai.runToolLoop({
    tier: "cheap",
    maxTokens: 700,
    maxSteps: 4,
    system,
    messages,
    tools: opts.tools,
  });
  // Texto vazio quando uma tool encerrou o turno (stop) — mantém "" nesse caso.
  const text = result.text ? stripSpeakerLabel(stripMarkdownLinks(result.text)) : "";
  return { text, toolsUsed: result.toolsUsed, stopped: result.stopped };
}
