import { invalidate, invalidatePrefix } from "./cache";
import { publishTenantEvent } from "@/server/events/bus";

/**
 * Chaves de cache de leitura por CONTA. Centralizadas aqui para que produtores
 * (quem cacheia) e consumidores (quem invalida) usem exatamente o mesmo prefixo.
 *
 * Sufixo por operador/escopo (`:${sessionUserId}` / `:${assignedToId}`) porque
 * alguns contadores são por operador; a invalidação varre o prefixo da conta.
 */
export const cacheKeys = {
  inboxCounts: (tenantUserId: string, sessionUserId: string, whatsAppNumberId?: string) =>
    `inbox:counts:${tenantUserId}:${sessionUserId}:${whatsAppNumberId ?? "_"}`,
  leadFacets: (userId: string, assignedToId?: string) =>
    `leads:facets:${userId}:${assignedToId ?? "_"}`,
  // Contexto de conversa montado p/ a IA (por lead). resetMinutes é estável por
  // lead (config do número), então não entra na chave.
  conversation: (leadId: string) => `conv:${leadId}`,
};

/** Invalida o contexto de conversa cacheado de um lead (após gravar Message). */
export async function invalidateConversation(leadId: string): Promise<void> {
  await invalidate(cacheKeys.conversation(leadId));
}

/**
 * Invalida os caches de leitura derivados dos leads de uma conta (contadores de
 * inbox + facetas do funil), em todas as variantes por operador. Chamar após
 * qualquer mutação que mude contagem/status/atribuição/mensagem.
 */
export async function invalidateLeadCaches(tenantUserId: string): Promise<void> {
  await Promise.all([
    invalidatePrefix(`inbox:counts:${tenantUserId}:`),
    invalidatePrefix(`leads:facets:${tenantUserId}:`),
    // Mesmos eventos que invalidam o cache também notificam o front via SSE
    // (revalidação dirigida em vez de polling agressivo). No-op sem Redis.
    publishTenantEvent(tenantUserId, { type: "tenant:changed" }),
  ]);
}
