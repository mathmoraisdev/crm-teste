export type DisconnectAction = "BANNED" | "FATAL" | "RECONNECT";

/**
 * Mapeia o statusCode de `lastDisconnect.error` (Boom) do Baileys numa ação.
 * - 401/403 → conta deslogada/proibida = ban efetivo → tira da rotação.
 * - 440     → sessão substituída por outra → não reconectar sozinho.
 * - resto   → queda transitória → reconectar com backoff.
 */
export function classifyDisconnect(statusCode: number | undefined): DisconnectAction {
  if (statusCode === 401 || statusCode === 403) return "BANNED";
  if (statusCode === 440) return "FATAL";
  return "RECONNECT";
}
