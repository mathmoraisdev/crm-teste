/**
 * Formatação pura do transcript da conversa para os prompts dos agentes.
 * Sem I/O — fácil de testar e estável (a saída entra direto no prompt do modelo).
 */

export interface ConversationTurn {
  direction: "INBOUND" | "OUTBOUND";
  content: string;
}

/**
 * Recorta a "sessão atual" da conversa: a partir da mensagem mais recente, mantém
 * as mensagens enquanto o intervalo de silêncio até a anterior for <= resetMinutes.
 * No primeiro gap MAIOR que isso, corta — o que veio antes é de um atendimento já
 * encerrado e não deve contaminar o contexto da IA quando o lead volta depois.
 *
 * Entrada em ordem CRONOLÓGICA (mais antiga → mais nova). `resetMinutes <= 0`
 * desliga o corte (mantém tudo). Função pura (sem I/O) p/ ser testável.
 */
export function sessionWindow<T extends { createdAt: Date }>(
  turns: T[],
  resetMinutes: number,
): T[] {
  if (resetMinutes <= 0 || turns.length <= 1) return turns;
  const gapMs = resetMinutes * 60_000;
  // anda do mais recente p/ o mais antigo; o primeiro gap > limite marca o início
  // da sessão atual (tudo antes dele é descartado).
  for (let i = turns.length - 1; i > 0; i--) {
    const delta = turns[i].createdAt.getTime() - turns[i - 1].createdAt.getTime();
    if (delta > gapMs) return turns.slice(i);
  }
  return turns;
}

/** Lead → "Lead:", Vendedor → "Vendedor:". Uma linha por turno. */
export function formatTranscript(turns: ConversationTurn[]): string {
  return turns
    .map((t) => `${t.direction === "INBOUND" ? "Lead" : "Vendedor"}: ${t.content}`)
    .join("\n");
}
