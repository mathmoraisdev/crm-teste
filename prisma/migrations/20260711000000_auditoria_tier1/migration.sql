-- Log de auditoria central e imutável (Tier 1). Tabela nova e isolada, SEM FKs
-- (sobrevive a delete de operador e a cascade de conta). `action`/`entityType`
-- são TEXT p/ não exigir migration a cada ação nova.
-- Idempotente: PROD roda `migrate deploy` no boot e não pode colidir com estado
-- prévio (dev já aplicou via `db push`).
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "diff" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuditLog_accountId_createdAt_idx" ON "AuditLog"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_accountId_entityType_entityId_idx" ON "AuditLog"("accountId", "entityType", "entityId");
