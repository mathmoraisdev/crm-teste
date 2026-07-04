import { ATTENDANCE_SYSTEM, CONVERSATION_SYSTEM, SLOT_CHOICE_SYSTEM } from "./prompts";
import { buildAttendanceContext } from "./attendance-context";
import {
  slotChoiceJsonSchema,
  slotChoiceSchema,
  type QualificationResult,
  type SlotChoice,
} from "./schemas";
import { formatTranscript, type ConversationTurn } from "./transcript";
import { stripMarkdownLinks, stripSpeakerLabel } from "./sanitize";
import type { AiClient } from "./provider";

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

/**
 * Agente de ATENDIMENTO — gera a próxima mensagem respondendo o cliente no
 * contexto da empresa (persona + base de conhecimento + horário).
 */
export async function generateAttendanceReply(opts: {
  ai: AiClient;
  company: {
    displayName?: string | null;
    systemPromptOverride?: string | null;
    persona?: string | null;
    knowledgeBase?: string | null;
    businessHours?: string | null;
    customInstructions?: string | null;
  };
  catalogBlock?: string;
  conversation: ConversationTurn[];
}): Promise<string> {
  // Prompt mestre da empresa (quando setado) SUBSTITUI o padrão fixo. Nesse modo
  // o operador escreve tudo inline, então NÃO injetamos o bloco de contexto
  // (persona/base/horário/instruções/catálogo) — ficam a cargo do próprio prompt.
  const override = opts.company.systemPromptOverride?.trim();
  const system = override || ATTENDANCE_SYSTEM;
  const context = override ? "" : buildAttendanceContext(opts.company);
  const catalog = !override && opts.catalogBlock ? `\n\n${opts.catalogBlock}` : "";
  const extra =
    !override && opts.company.customInstructions
      ? `\n\nInstruções adicionais da empresa:\n${opts.company.customInstructions}`
      : "";
  const prefix = context || catalog || extra ? `${context}${catalog}${extra}\n\n` : "";
  const text = await opts.ai.generateText({
    tier: "cheap",
    maxTokens: 700,
    system,
    user:
      `${brazilTodayLine()}\n\n` +
      `${prefix}` +
      `Conversa:\n${formatTranscript(opts.conversation)}\n\n` +
      `Escreva a próxima mensagem ao cliente.`,
  });
  return stripSpeakerLabel(stripMarkdownLinks(text || "Oi! Como posso te ajudar?"));
}
