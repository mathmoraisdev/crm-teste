-- Avisos para o admin da plataforma (cancelamento/exclusão de conta).
-- Append-only e sem FK para User: precisa sobreviver ao delete em cascade da conta.
CREATE TYPE "AccountNoticeKind" AS ENUM ('CANCELAMENTO', 'EXCLUSAO');

CREATE TABLE "AccountNotice" (
    "id" TEXT NOT NULL,
    "kind" "AccountNoticeKind" NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountEmail" TEXT NOT NULL,
    "plan" "Plan",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "AccountNotice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountNotice_seenAt_idx" ON "AccountNotice"("seenAt");
CREATE INDEX "AccountNotice_createdAt_idx" ON "AccountNotice"("createdAt");
