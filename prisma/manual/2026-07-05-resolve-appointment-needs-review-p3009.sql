-- P3009: a 1ª tentativa de `migrate deploy` falhou (P3018/42701 — coluna
-- "needsReview" já existia, criada pelo SQL manual). Isso deixou um registro de
-- migration FALHA em `_prisma_migrations`, e o Prisma trava todos os deploys
-- seguintes até ser resolvido.
--
-- A coluna/índice JÁ EXISTEM em PROD e a migration agora é idempotente
-- (IF NOT EXISTS). Basta remover o registro da tentativa falha: o próximo
-- `migrate deploy` re-executa a migration (no-op) e a registra como aplicada.
--
-- Rodar no Supabase (SQL editor) ANTES de redeployar.
DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260705030000_appointment_needs_review';
