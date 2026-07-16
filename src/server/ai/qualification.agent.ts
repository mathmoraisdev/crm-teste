import { QUALIFICATION_SYSTEM } from "./prompts";
import { formatTranscript, type ConversationTurn } from "./transcript";
import {
  qualificationJsonSchema,
  qualificationSchema,
  type QualificationResult,
} from "./schemas";
import type { AiClient } from "./provider";

// Re-export p/ compatibilidade com quem importava ConversationTurn daqui.
export type { ConversationTurn };

/** Número de turnos recentes usados como base para o scoreJustification. */
const JUSTIFICATION_WINDOW = 5;

/**
 * Agente de qualificação (tier "strong", function calling forçado → JSON estruturado).
 * Analisa a conversa inteira e devolve a qualificação validada por zod.
 * O `ai` (AiClient) é resolvido por-usuário pelo chamador (BYOK).
 *
 * O transcript completo é passado como contexto histórico, mas os últimos
 * `JUSTIFICATION_WINDOW` turnos são destacados em bloco separado para que
 * o modelo fundamente o `scoreJustification` nos sinais mais recentes.
 */
export async function runQualification(opts: {
  ai: AiClient;
  leadName: string;
  conversation: ConversationTurn[];
  /** Bloco de ofertas ativas (renderActiveOffers). Vazio = número sem vendas. */
  offersBlock?: string;
}): Promise<QualificationResult> {
  const offers = opts.offersBlock?.trim() ? `\n\n${opts.offersBlock.trim()}` : "";

  const recentTurns = opts.conversation.slice(-JUSTIFICATION_WINDOW);
  const recentBlock =
    recentTurns.length > 0
      ? `\n\nÚltimos ${recentTurns.length} turnos (base para scoreJustification):\n${formatTranscript(recentTurns)}`
      : "";

  const input = await opts.ai.forcedToolCall({
    tier: "strong",
    maxTokens: 1024,
    system: QUALIFICATION_SYSTEM,
    user: `Lead: ${opts.leadName}\n\nConversa completa:\n${formatTranscript(opts.conversation)}${recentBlock}${offers}`,
    toolName: "registrar_qualificacao",
    toolDescription: "Registra a qualificação estruturada do lead.",
    jsonSchema: qualificationJsonSchema as unknown as Record<string, unknown>,
  });

  if (input == null) {
    throw new Error("Agente de qualificação não retornou tool_call.");
  }
  const parsed = qualificationSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Saída de qualificação inválida: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return parsed.data;
}
