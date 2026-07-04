-- Controle de estoque: colunas em CatalogItem + StockMovement (ledger).
-- Aplicar em PROD manualmente (Supabase SQL Editor). Idempotente e ADITIVO.

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

-- Validar: select to_regclass('public."StockMovement"');
-- Conferir colunas: select column_name from information_schema.columns where table_name='CatalogItem' and column_name in ('trackStock','sku','stockQty','minStock','costCents');
