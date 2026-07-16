export type NoChipAction = { action: "defer" } | { action: "pause_campaign" };

/**
 * Quando a conta não tem chip elegível, adiamos o job. Mas adiar infinitamente
 * é livelock — após `maxDefers` deferimentos consecutivos, a campanha é pausada
 * e o operador é avisado p/ repor chips. A fila NÃO é perdida: ao despausar (ou
 * conectar um chip novo), os PENDING voltam a fluir.
 */
export function decideNoChipAction(deferCount: number, maxDefers: number): NoChipAction {
  return deferCount >= maxDefers ? { action: "pause_campaign" } : { action: "defer" };
}
