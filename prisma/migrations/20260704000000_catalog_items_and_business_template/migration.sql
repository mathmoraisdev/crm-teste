-- Catch-up: alinha o HISTÓRICO de migrations ao schema.prisma.
--
-- Contexto: depois de `20260703020000_account_branding`, duas mudanças de schema
-- entraram em PROD só via SQL manual (prisma/manual/2026-07-03-vendas.sql e
-- 2026-07-04-user-business-template.sql), sem migration correspondente. Sem esta
-- migration, `prisma migrate deploy` nunca cria CatalogItem/Order/OrderItem nem
-- User.businessTemplateId — foi a causa dos 500 de 2026-07-04.
--
-- Esta migration é o UNIÃO exata daqueles dois manuais, mantida IDEMPOTENTE
-- (IF NOT EXISTS / guards) porque em PROD as tabelas já existem: no cutover ela é
-- marcada como aplicada via `prisma migrate resolve --applied` (não roda o SQL).
-- Em bancos novos, roda uma vez e cria tudo.

-- ── User.businessTemplateId (ramo do negócio por conta) ──
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "businessTemplateId" TEXT;

-- ── Módulo de registro de vendas: CatalogItem / Order / OrderItem ──
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
