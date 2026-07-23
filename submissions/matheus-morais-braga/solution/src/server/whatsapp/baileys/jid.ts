/**
 * Resolução de JID do WhatsApp — módulo PURO (sem env/IO) p/ ser testável.
 */

/** JID a partir de um telefone E.164: "+5541999999999" → "5541999999999@s.whatsapp.net". */
export const jidOf = (phone: string) => `${phone.replace(/^\+/, "")}@s.whatsapp.net`;

/**
 * Escolhe o JID de envio. Dado o JID montado na mão (fallback) e a resposta do
 * `onWhatsApp`, devolve o JID CANÔNICO do WhatsApp + se a conta existe.
 *
 * Crucial no Brasil: `onWhatsApp("...9XXXXXXXX")` frequentemente devolve o JID
 * registrado SEM o 9º dígito. Enviar pro JID montado na mão entrega no vazio —
 * a mensagem "sai" (sendMessage não dá erro) mas não chega. Sempre confie no
 * `jid` retornado pelo WhatsApp.
 */
export function pickSendJid(
  fallbackJid: string,
  hits: Array<{ exists?: unknown; jid?: string }> | undefined | null,
): { exists: boolean; jid: string } {
  const hit = hits?.[0];
  if (!hit?.exists) return { exists: false, jid: fallbackJid };
  return { exists: true, jid: hit.jid ?? fallbackJid };
}
