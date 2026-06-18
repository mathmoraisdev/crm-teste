import { getOpenAI, MODELS } from "./provider";
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
 * Agente de conversa (gpt-4o-mini) — gera a PRÓXIMA pergunta de qualificação.
 * Usa o resumo da qualificação atual como contexto do que ainda falta saber.
 */
export async function generateNextQuestion(opts: {
  leadName: string;
  conversation: ConversationTurn[];
  qualification: QualificationResult;
}): Promise<string> {
  const client = getOpenAI();

  const res = await client.chat.completions.create({
    model: MODELS.cheap,
    max_completion_tokens: 300,
    messages: [
      { role: "system", content: CONVERSATION_SYSTEM },
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

  const text = (res.choices[0]?.message?.content ?? "").trim();
  return text || "Pode me contar um pouco mais sobre o seu cenário atual?";
}

/**
 * Interpreta a escolha de horário do lead (gpt-4o-mini, function calling forçado).
 * Recebe os slots propostos (formatados, já numerados) e a resposta do lead.
 */
export async function interpretSlotChoice(opts: {
  formattedSlots: string[]; // legíveis, índice = posição
  leadMessage: string;
}): Promise<SlotChoice> {
  const client = getOpenAI();

  const list = opts.formattedSlots
    .map((s, i) => `[${i}] ${s}`)
    .join("\n");

  const res = await client.chat.completions.create({
    model: MODELS.cheap,
    max_completion_tokens: 256,
    messages: [
      { role: "system", content: SLOT_CHOICE_SYSTEM },
      {
        role: "user",
        content: `Horários oferecidos:\n${list}\n\nMensagem do lead: "${opts.leadMessage}"`,
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "registrar_escolha",
          description: "Registra qual horário o lead escolheu.",
          parameters: slotChoiceJsonSchema as unknown as Record<string, unknown>,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "registrar_escolha" } },
  });

  const call = res.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.type !== "function") {
    return { chosenIndex: null, confident: false };
  }
  try {
    const parsed = slotChoiceSchema.safeParse(JSON.parse(call.function.arguments));
    return parsed.success ? parsed.data : { chosenIndex: null, confident: false };
  } catch {
    return { chosenIndex: null, confident: false };
  }
}
