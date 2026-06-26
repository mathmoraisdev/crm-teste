import { ATTENDANCE_SYSTEM, CONVERSATION_SYSTEM, SLOT_CHOICE_SYSTEM } from "./prompts";
import { buildAttendanceContext } from "./attendance-context";
import {
  slotChoiceJsonSchema,
  slotChoiceSchema,
  type QualificationResult,
  type SlotChoice,
} from "./schemas";
import { formatTranscript, type ConversationTurn } from "./transcript";
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
  return text || "Pode me contar um pouco mais sobre o seu cenário atual?";
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
  conversation: ConversationTurn[];
}): Promise<string> {
  // Prompt mestre da empresa (quando setado) SUBSTITUI o padrão fixo. Nesse modo
  // o operador escreve tudo inline, então NÃO injetamos o bloco de contexto
  // (persona/base/horário/instruções) — eles ficam a cargo do próprio prompt.
  const override = opts.company.systemPromptOverride?.trim();
  const system = override || ATTENDANCE_SYSTEM;
  const context = override ? "" : buildAttendanceContext(opts.company);
  const extra =
    !override && opts.company.customInstructions
      ? `\n\nInstruções adicionais da empresa:\n${opts.company.customInstructions}`
      : "";
  const prefix = context || extra ? `${context}${extra}\n\n` : "";
  const text = await opts.ai.generateText({
    tier: "cheap",
    maxTokens: 400,
    system,
    user:
      `${prefix}` +
      `Conversa:\n${formatTranscript(opts.conversation)}\n\n` +
      `Escreva a próxima mensagem ao cliente.`,
  });
  return text || "Oi! Como posso te ajudar?";
}
