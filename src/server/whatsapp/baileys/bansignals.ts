export type DisconnectAction = "BANNED" | "LOGGED_OUT" | "FATAL" | "RECONNECT";

/**
 * Mapeia o statusCode de `lastDisconnect.error` (Boom) do Baileys numa ação.
 * - 401 → aparelho deslogado/removido (logout manual ou pelo WhatsApp). NÃO é
 *         ban: as credenciais morreram e precisa reescanear o QR. Reconectável
 *         pelo botão "Reconectar" (apaga as creds mortas → QR novo), sem perder
 *         nenhuma config do número.
 * - 403 → proibido → ban efetivo → tira da rotação.
 * - 440 → sessão substituída por outra → não reconectar sozinho.
 * - resto → queda transitória → reconectar com backoff.
 */
export function classifyDisconnect(statusCode: number | undefined): DisconnectAction {
  if (statusCode === 401) return "LOGGED_OUT";
  if (statusCode === 403) return "BANNED";
  if (statusCode === 440) return "FATAL";
  return "RECONNECT";
}
