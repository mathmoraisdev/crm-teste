-- Adiciona User.businessTemplateId (ramo do negócio por conta).
-- Aplicar em PROD manualmente (Supabase SQL Editor). Idempotente e ADITIVO.
-- Coluna nullable → não quebra linhas existentes. Em prod o app conecta como
-- `postgres` (owner), então NÃO precisa GRANT.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "businessTemplateId" TEXT;
