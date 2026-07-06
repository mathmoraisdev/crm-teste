-- Onda B — sessão de caixa (turno conferível) + estorno de comanda. Idempotente.
-- Aplicar no Supabase SQL Editor (env do DB é Sensitive, não alcança daqui).
-- Ver [[prod-schema-drift-destravar]]: NÃO duplicar com migration versionada;
-- mudança de schema da Onda B entra por AQUI (catch-up manual sem migration).
-- COMPARTILHADO com o plano de Estorno (2026-07-06-estorno-comanda.md): ACRESCENTE
-- neste arquivo, não sobrescreva.

-- ── Sessão de caixa ──────────────────────────────────────────────────────────
-- Enums (guarda idempotente p/ CREATE TYPE — Postgres não tem IF NOT EXISTS aqui).
DO $$ BEGIN CREATE TYPE "CashSessionStatus" AS ENUM ('ABERTA','FECHADA'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CashMovementKind" AS ENUM ('SANGRIA','SUPRIMENTO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "CashSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'ABERTA',
    "openingFloatCents" INTEGER NOT NULL DEFAULT 0,
    "closingCountedCents" INTEGER,
    "openedById" TEXT NOT NULL,
    "closedById" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "note" TEXT,
    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CashSession_accountId_status_idx" ON "CashSession"("accountId", "status");

CREATE TABLE IF NOT EXISTS "CashMovement" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" "CashMovementKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CashMovement_sessionId_idx" ON "CashMovement"("sessionId");

-- FKs (guardadas: duplicate_object se já existirem).
DO $$ BEGIN ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CashSession"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Comanda carrega a sessão em que foi fechada (null = fora de sessão).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cashSessionId" TEXT;
DO $$ BEGIN ALTER TABLE "Order" ADD CONSTRAINT "Order_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Validar: select to_regclass('public."CashSession"'), to_regclass('public."CashMovement"');
-- Conferir coluna: select column_name from information_schema.columns where table_name='Order' and column_name='cashSessionId';

-- ── Estorno / reabertura de comanda ──────────────────────────────────────────
-- ⚠️ ORDEM DE APLICAÇÃO: rode a linha do ALTER TYPE ... ADD VALUE ISOLADA e ANTES
-- das outras. Em algumas versões do Postgres ADD VALUE não roda dentro de um bloco
-- de transação com outros comandos ([[prod-schema-drift-destravar]]). É idempotente
-- (IF NOT EXISTS), então pode reaplicar sem erro.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'CANCELADA';

-- Auditoria do estorno (quem anulou a venda e por quê). canceledById sem FK (mínimo).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "canceledReason" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "canceledById" TEXT;

-- Conferir: select column_name from information_schema.columns where table_name='Order' and column_name like 'canceled%';
-- Conferir enum: select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='OrderStatus';
