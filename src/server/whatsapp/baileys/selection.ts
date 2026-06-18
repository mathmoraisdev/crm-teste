export interface NumberState {
  id: string;
  status: string; // WhatsAppNumberStatus
  dailyCap: number;
  sentToday: number;
}

const SENDABLE = new Set(["CONNECTED", "WARMING"]);

/**
 * Escolhe o chip elegível menos carregado. Elegível = status enviável e ainda
 * abaixo do próprio cap diário. Espalhar a carga (least-loaded) reduz a
 * "assinatura" de rajada num único número. Retorna null se nada elegível.
 */
export function selectNumber(numbers: NumberState[]): NumberState | null {
  const eligible = numbers.filter(
    (n) => SENDABLE.has(n.status) && n.sentToday < n.dailyCap,
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((best, n) => (n.sentToday < best.sentToday ? n : best));
}
