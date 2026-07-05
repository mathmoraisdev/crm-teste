-- HOTFIX 2026-07-05 — Destravar PROD (login 500: User.businessTemplateId ausente).
--
-- Causa: o schema deployado espera colunas/tabelas que nunca foram criadas em PROD
-- (o cutover p/ `migrate deploy` marcou a catch-up como aplicada SEM rodar o DDL, e
-- estoque/caixa nem têm migration — só SQL manual). Ver prisma/manual/CUTOVER-migrate-deploy.md.
--
-- Este arquivo é a UNIÃO, em ordem de dependência, de todos os prisma/manual/*.sql
-- pendentes. Tudo idempotente (IF NOT EXISTS / guards) e ADITIVO — seguro rodar
-- inteiro mesmo que parte já exista. Cole no Supabase → SQL Editor (PROD) → Run.
-- Nenhum redeploy é necessário depois: o deployment atual passa a funcionar na hora.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) User.businessTemplateId  (2026-07-04-user-business-template.sql) — CORRIGE O LOGIN
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "businessTemplateId" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) AccountBranding  (2026-07-03-account-branding.sql)
-- ─────────────────────────────────────────────────────────────────────────────
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
DO $$ BEGIN ALTER TABLE "AccountBranding" ADD CONSTRAINT "AccountBranding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Vendas: CatalogItem / Order / OrderItem  (2026-07-03-vendas.sql)
--    Deve vir ANTES do estoque (StockMovement tem FK p/ CatalogItem e Order).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "CatalogItemKind" AS ENUM ('SERVICO', 'PRODUTO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "OrderStatus" AS ENUM ('ABERTA', 'FECHADA'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "OrderPayment" AS ENUM ('DINHEIRO', 'PIX', 'CARTAO', 'OUTRO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "CatalogItem" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "CatalogItemKind" NOT NULL DEFAULT 'SERVICO',
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CatalogItem_accountId_active_idx" ON "CatalogItem"("accountId", "active");

CREATE TABLE IF NOT EXISTS "Order" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "leadId" TEXT,
    "customerName" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'ABERTA',
    "openedById" TEXT NOT NULL,
    "payment" "OrderPayment",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Order_accountId_status_idx" ON "Order"("accountId", "status");
CREATE INDEX IF NOT EXISTS "Order_accountId_closedAt_idx" ON "Order"("accountId", "closedAt");

CREATE TABLE IF NOT EXISTS "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "nameSnapshot" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");

DO $$ BEGIN ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Order" ADD CONSTRAINT "Order_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Order" ADD CONSTRAINT "Order_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Order" ADD CONSTRAINT "Order_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Caixa: Expense / RecurringExpense  (2026-07-04-caixa-despesas.sql)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "ExpenseCategory" AS ENUM ('ALUGUEL','FORNECEDOR','PESSOAL','CONTAS','IMPOSTOS','OUTRO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ExpenseStatus" AS ENUM ('PENDENTE','PAGA'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "RecurringExpense" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OUTRO',
    "dayOfMonth" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RecurringExpense_accountId_active_idx" ON "RecurringExpense"("accountId", "active");

CREATE TABLE IF NOT EXISTS "Expense" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OUTRO',
    "status" "ExpenseStatus" NOT NULL DEFAULT 'PENDENTE',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "recurringId" TEXT,
    "competenceMonth" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Expense_recurringId_competenceMonth_key" ON "Expense"("recurringId", "competenceMonth");
CREATE INDEX IF NOT EXISTS "Expense_accountId_status_dueDate_idx" ON "Expense"("accountId", "status", "dueDate");
CREATE INDEX IF NOT EXISTS "Expense_accountId_paidAt_idx" ON "Expense"("accountId", "paidAt");

DO $$ BEGIN ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Estoque: colunas em CatalogItem + StockMovement  (2026-07-04-estoque.sql)
--    Precisa da seção 3 (CatalogItem/Order) já criada acima.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "trackStock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "sku" TEXT;
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "stockQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "minStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "costCents" INTEGER;
CREATE INDEX IF NOT EXISTS "CatalogItem_accountId_trackStock_idx" ON "CatalogItem"("accountId", "trackStock");

DO $$ BEGIN CREATE TYPE "StockMovementKind" AS ENUM ('ENTRADA','SAIDA','AJUSTE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "StockMovement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "orderId" TEXT,
    "unitCostCents" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StockMovement_accountId_catalogItemId_createdAt_idx" ON "StockMovement"("accountId", "catalogItemId", "createdAt");
CREATE INDEX IF NOT EXISTS "StockMovement_orderId_idx" ON "StockMovement"("orderId");

DO $$ BEGIN ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Validação (todos devem retornar o nome do objeto, nenhum NULL) ──
-- select
--   to_regclass('public."AccountBranding"') as branding,
--   to_regclass('public."CatalogItem"')     as catalog,
--   to_regclass('public."Order"')           as orders,
--   to_regclass('public."Expense"')         as expense,
--   to_regclass('public."StockMovement"')   as stock;
-- select column_name from information_schema.columns
--   where table_name='User' and column_name='businessTemplateId';
-- select column_name from information_schema.columns
--   where table_name='CatalogItem' and column_name in ('trackStock','stockQty','minStock','sku','costCents');
