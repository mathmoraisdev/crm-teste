-- Cria a tabela AccountBranding (branding multivertical: tema/logo/nome por conta).
--
-- Contexto: em DEV a tabela foi criada por `prisma db push`. Em PROD o cutover
-- para `prisma migrate` ainda está pendente (ver memória crm-inbox-db-push-pending),
-- então esta mudança foi aplicada MANUALMENTE no Postgres de produção via este
-- script (Supabase SQL Editor). Mantido no repo como registro versionado.
--
-- Idempotente (pode rodar 2x) e ADITIVO: só cria a tabela nova + índice + FK,
-- não altera User nem qualquer outra tabela. Bate com o DDL gerado pelo Prisma.
--
-- Aplicar (uma das opções):
--   Supabase → SQL Editor → colar e Run
--   ou:  npx prisma db execute --url "<DIRECT_URL_de_prod>" --file prisma/manual/2026-07-03-account-branding.sql

CREATE TABLE IF NOT EXISTS "AccountBranding" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "presetId" TEXT,
    "brandScale" JSONB,
    "logoUrl" TEXT,
    "appName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountBranding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccountBranding_accountId_key" ON "AccountBranding"("accountId");

DO $$ BEGIN
    ALTER TABLE "AccountBranding" ADD CONSTRAINT "AccountBranding_accountId_fkey"
        FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
