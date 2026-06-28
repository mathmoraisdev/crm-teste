import pino from "pino";

/**
 * Logger estruturado (pino). Nível por `LOG_LEVEL` (default: info em produção,
 * debug fora). Sem transports/pretty-print: evita problemas de bundling no Next
 * e mantém saída JSON (uma linha por log) — fácil de ingerir em Railway/agregador.
 *
 * Uso: `logger.info({ leadId, campaignId, action }, "mensagem")`. O contexto vai
 * como campos estruturados (não interpolar no texto).
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
});
