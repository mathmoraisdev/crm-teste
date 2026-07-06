import { ATTENDANCE_SYSTEM, CONVERSATION_SYSTEM, SLOT_CHOICE_SYSTEM } from "./prompts";
import { buildAttendanceContext } from "./attendance-context";
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
}): Promise<SlotChoice> {
  const list = opts.formattedSlots.map((s, i) => `[${i}] ${s}`).join("\n");
  const input = await opts.ai.forcedToolCall({
    tier: "cheap",
    maxTokens: 256,
    system: SLOT_CHOICE_SYSTEM,
    user: `Horários oferecidos:\n${list}\n\nMensagem do lead: "${opts.leadMessage}"`,
    toolName: "registrar_escolha",
    toolDescription: "Registra qual horário o lead escolheu.",
    jsonSchema: slotChoiceJsonSchema as unknown as Record<string, unknown>,
  });
  if (input == null) return { chosenIndex: null, confident: false };
  const parsed = slotChoiceSchema.safeParse(input);
  return parsed.success ? parsed.data : { chosenIndex: null, confident: false };
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
 * Linha "Data de hoje" injetada no prompt de atendimento. O modelo não recebe
 * timestamps no transcript, então sem isto ele não sabe que dia é hoje — o que
 * quebra avisos com validade ("válido até DD/MM") e perguntas tipo "abrem hoje?".
 * Só a DATA (não a hora): o atendimento nunca decide "aberto agora" — isso é regra
 * do próprio prompt. Timezone padrão Brasília; a data só diverge de outros fusos
 * BR na janela de ~1h em torno da meia-noite, irrelevante p/ validade de aviso.
 */
function brazilTodayLine(): string {
  const hoje = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
  return `Data de hoje: ${hoje}.`;
}

interface AttendanceCompany {
  displayName?: string | null;
  systemPromptOverride?: string | null;
  persona?: string | null;
  knowledgeBase?: string | null;
  businessHours?: string | null;
  customInstructions?: string | null;
}

/**
 * Monta (PURA) o `system` base + o prefixo de contexto (empresa/catálogo/extra)
 * comum aos dois caminhos de atendimento — a resposta livre (`generateText`) e o
 * loop de tools (`runToolLoop`). Prompt mestre da empresa (override), quando
 * setado, SUBSTITUI o padrão e zera o bloco de contexto (o operador escreve tudo
 * inline). Extrai o trecho para não duplicar entre os dois caminhos.
 */
function buildAttendancePrompt(opts: {
  company: AttendanceCompany;
  catalogBlock?: string;
}): { system: string; contextPrefix: string } {
  const override = opts.company.systemPromptOverride?.trim();
  const system = override || ATTENDANCE_SYSTEM;
  const context = override ? "" : buildAttendanceContext(opts.company);
  const catalog = !override && opts.catalogBlock ? `\n\n${opts.catalogBlock}` : "";
  const extra =
    !override && opts.company.customInstructions
      ? `\n\nInstruções adicionais da empresa:\n${opts.company.customInstructions}`
      : "";
  const contextPrefix = context || catalog || extra ? `${context}${catalog}${extra}\n\n` : "";
  return { system, contextPrefix };
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
}): Promise<string> {
  const { system, contextPrefix } = buildAttendancePrompt(opts);
  const text = await opts.ai.generateText({
    tier: "cheap",
    maxTokens: 700,
    system,
    user:
      `${brazilTodayLine()}\n\n` +
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
}): Promise<AgenticReplyResult> {
  const { system: baseSystem, contextPrefix } = buildAttendancePrompt(opts);
  const contextBlock = contextPrefix.trimEnd();
  const offers = opts.offersBlock?.trim() ? `\n\n${opts.offersBlock.trim()}` : "";
  const media = opts.mediaBlock?.trim() ? `\n\n${opts.mediaBlock.trim()}` : "";
  const system =
    `${baseSystem}\n\n${brazilTodayLine()}` + (contextBlock ? `\n\n${contextBlock}` : "") + offers + media;
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
