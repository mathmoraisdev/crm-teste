-- Onda D — Inbox produtivo (respostas rápidas + SLA + notas internas). Idempotente.
-- Aplicar no Supabase SQL Editor (env do DB é Sensitive, não alcança daqui).
-- Ver [[prod-schema-drift-destravar]]: NÃO duplicar com migration versionada;
-- mudança de schema da Onda D entra por AQUI (catch-up manual sem migration).
-- Este arquivo é da iniciativa 6 (Inbox produtivo). ACRESCENTE, não sobrescreva.

-- ── Fase 1: Respostas rápidas (QuickReply) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "QuickReply" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "shortcut" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuickReply_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "QuickReply_userId_shortcut_key" ON "QuickReply"("userId", "shortcut");
CREATE INDEX IF NOT EXISTS "QuickReply_userId_idx" ON "QuickReply"("userId");
DO $$ BEGIN ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Validar: select to_regclass('public."QuickReply"');

-- ── Fase 2: Meta de SLA do inbox (no dono) ───────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "inboxSlaMinutes" INTEGER;
-- Conferir: select column_name from information_schema.columns where table_name='User' and column_name='inboxSlaMinutes';

-- ── Fase 3: Notas internas (InternalNote) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "InternalNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InternalNote_leadId_createdAt_idx" ON "InternalNote"("leadId", "createdAt");
DO $$ BEGIN ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Validar: select to_regclass('public."InternalNote"');
