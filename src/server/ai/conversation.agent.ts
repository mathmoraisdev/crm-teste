import { getAnthropic, MODELS } from "./provider";
import { CONVERSATION_SYSTEM, SLOT_CHOICE_SYSTEM } from "./prompts";
import {
  slotChoiceJsonSchema,
  slotChoiceSchema,
  type QualificationResult,
  type SlotChoice,
} from "./schemas";
import type { ConversationTurn } from "./qualification.agent";

function transcript(turns: ConversationTurn[]): string {
  return turns
    .map((t) => `${t.direction === "INBOUND" ? "Lead" : "Vendedor"}: ${t.content}`)
    .join("\n");
}

/**
 * Agente de conversa (Haiku) — gera a PRÓXIMA pergunta de qualificação.
 * Usa o resumo da qualificação atual como contexto do que ainda falta saber.
 */
export async function generateNextQuestion(opts: {
  leadName: string;
  conversation: ConversationTurn[];
  qualification: QualificationResult;
}): Promise<string> {
  const client = getAnthropic();

  const res = await client.messages.create({
    model: MODELS.cheap,
    max_tokens: 300,
    system: CONVERSATION_SYSTEM,
    messages: [
      {
        role: "user",
        content:
          `Lead: ${opts.leadName}\n` +
          `Leitura atual da IA: ${opts.qualification.summary} (score ${opts.qualification.score})\n\n` +
          `Conversa:\n${transcript(opts.conversation)}\n\n` +
          `Escreva a próxima mensagem.`,
      },
    ],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  return text || "Pode me contar um pouco mais sobre o seu cenário atual?";
}

/**
 * Interpreta a escolha de horário do lead (Haiku, tool-use forçado).
 * Recebe os slots propostos (formatados, já numerados) e a resposta do lead.
 */
export async function interpretSlotChoice(opts: {
  formattedSlots: string[]; // legíveis, índice = posição
  leadMessage: string;
}): Promise<SlotChoice> {
  const client = getAnthropic();

  const list = opts.formattedSlots
    .map((s, i) => `[${i}] ${s}`)
    .join("\n");

  const res = await client.messages.create({
    model: MODELS.cheap,
    max_tokens: 256,
    system: SLOT_CHOICE_SYSTEM,
    tools: [
      {
        name: "registrar_escolha",
        description: "Registra qual horário o lead escolheu.",
        input_schema: slotChoiceJsonSchema as never,
      },
    ],
    tool_choice: { type: "tool", name: "registrar_escolha" },
    messages: [
      {
        role: "user",
        content: `Horários oferecidos:\n${list}\n\nMensagem do lead: "${opts.leadMessage}"`,
      },
    ],
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return { chosenIndex: null, confident: false };
  }
  const parsed = slotChoiceSchema.safeParse(toolUse.input);
  return parsed.success ? parsed.data : { chosenIndex: null, confident: false };
}
