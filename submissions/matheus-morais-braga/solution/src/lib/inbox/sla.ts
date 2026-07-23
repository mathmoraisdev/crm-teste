// Cálculo puro do estado de SLA de uma conversa do inbox. Reusa os dados que já
// existem no Lead (queuedAt/firstResponseAt) — a única entrada nova é a meta
// (targetMinutes) do dono. Sem efeitos, sem I/O; testável isoladamente.

export type SlaStatus = "ok" | "warning" | "breached";

export interface SlaState {
  status: SlaStatus;
  /** Tempo (ms) de espera medido: até a 1ª resposta, ou até `now` se ainda na fila. */
  waitingMs: number;
}

export interface SlaInput {
  queuedAt: Date | null;
  firstResponseAt: Date | null;
  /** Meta em minutos (do dono). null/<=0 = sem meta → sempre "ok". */
  targetMinutes: number | null;
  now: Date;
}

// Abaixo desta fração da meta = "ok"; acima = "warning"; acima da meta = "breached".
const WARNING_FRACTION = 0.7;

/**
 * Estado de SLA:
 * - Sem meta (null/<=0) ou sem `queuedAt` → sempre `ok` (nada a cobrar).
 * - Já respondida (`firstResponseAt`) → `ok`; mede firstResponseAt - queuedAt.
 * - Ainda na fila → mede now - queuedAt: > meta = breached; > 0.7×meta = warning.
 */
export function slaState(input: SlaInput): SlaState {
  const { queuedAt, firstResponseAt, targetMinutes, now } = input;

  if (queuedAt == null) return { status: "ok", waitingMs: 0 };

  const end = firstResponseAt ?? now;
  const waitingMs = Math.max(0, end.getTime() - queuedAt.getTime());

  // Sem meta: reporta o tempo mas nunca marca estouro.
  if (targetMinutes == null || targetMinutes <= 0) {
    return { status: "ok", waitingMs };
  }

  // Respondida: o SLA está fechado — não fica "vermelho" no histórico.
  if (firstResponseAt != null) {
    return { status: "ok", waitingMs };
  }

  const targetMs = targetMinutes * 60_000;
  if (waitingMs > targetMs) return { status: "breached", waitingMs };
  if (waitingMs > targetMs * WARNING_FRACTION) return { status: "warning", waitingMs };
  return { status: "ok", waitingMs };
}
