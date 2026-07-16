-- Auditoria de custo por chamada de IA (tokens + custo estimado por lead/conta).
-- Append-only; o worker poda via AUDIT_RETENTION_DAYS (mesmo ciclo da AuditLog).
-- Espelha a model AiCallLog do schema.prisma.
CREATE TABLE "AiCallLog" (
    "id"               TEXT             NOT NULL,
    "userId"           TEXT             NOT NULL,
    "leadId"           TEXT,
    "provider"         TEXT             NOT NULL,
    "model"            TEXT             NOT NULL,
    "tier"             TEXT             NOT NULL,
    "purpose"          TEXT             NOT NULL,
    "promptTokens"     INTEGER          NOT NULL,
    "completionTokens" INTEGER          NOT NULL,
    "totalTokens"      INTEGER          NOT NULL,
    "costCents"        INTEGER          NOT NULL,
    "error"            BOOLEAN          NOT NULL DEFAULT false,
    "createdAt"        TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCallLog_pkey" PRIMARY KEY ("id")
);

-- FKs: conta (Cascade — some com a conta) e lead (SetNull — conserva o histórico
-- de custo mesmo se a conversa for apagada).
CREATE INDEX "AiCallLog_userId_createdAt_idx"        ON "AiCallLog"("userId", "createdAt");
CREATE INDEX "AiCallLog_leadId_createdAt_idx"        ON "AiCallLog"("leadId", "createdAt");
CREATE INDEX "AiCallLog_userId_leadId_createdAt_idx" ON "AiCallLog"("userId", "leadId", "createdAt");

ALTER TABLE "AiCallLog"
  ADD CONSTRAINT "AiCallLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiCallLog"
  ADD CONSTRAINT "AiCallLog_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
