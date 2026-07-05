-- RESOLVE P3009 (2026-07-05) — destrava o deploy do Vercel.
--
-- Causa: `prisma migrate deploy` (no build command) tentou RODAR o DDL da migration
-- 20260705000000_catchup_ai_credits_caixa_estoque, mas em PROD os objetos já existem
-- (db push + hotfix 2026-07-05) → "type/column already exists" → migration marcada
-- FAILED em _prisma_migrations → P3009 aborta todo deploy seguinte.
--
-- Esta migration é PURAMENTE ADITIVA e deve ser MARCADA aplicada, sem rodar o DDL.
-- Cole no Supabase → SQL Editor (PROD) → Run. Idempotente e seguro.
-- Pré-requisito: o hotfix 2026-07-05-hotfix-destravar-prod.sql já rodou (estoque/caixa/etc).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Colunas que a catch-up cria e que o hotfix NÃO cobria (cota de IA + resume).
--    IF NOT EXISTS → no-op se já existirem via db push.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "aiCreditMonth" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "aiCreditUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "aiResumePendingAt" TIMESTAMP(3);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Limpa o P3009: marca a catch-up como APLICADA sem rodar o DDL.
--    (equivale a `prisma migrate resolve --applied 20260705000000_catchup_ai_credits_caixa_estoque`)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "_prisma_migrations"
SET finished_at = now(),
    rolled_back_at = NULL,
    applied_steps_count = 1,
    logs = NULL
WHERE migration_name = '20260705000000_catchup_ai_credits_caixa_estoque';

-- ── Validação (deve retornar 1 linha, finished_at preenchido, rolled_back_at NULL) ──
-- select migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
--   from "_prisma_migrations"
--   where migration_name = '20260705000000_catchup_ai_credits_caixa_estoque';
