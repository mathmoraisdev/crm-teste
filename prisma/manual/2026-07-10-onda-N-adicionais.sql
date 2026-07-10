-- 2026-07-10-onda-N-adicionais.sql — Adicionais precificados (modifiers)
-- Aplicar no Supabase SQL Editor. Idempotente. NÃO criar migration versionada
-- (schema entra por AQUI, precedente da onda-L). Ver [[prod-schema-drift-destravar]].

-- 1) OrderItem: snapshot da seleção (preço já somado em unitPriceCents)
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "modifiersSnapshot" JSONB;

-- 2) ModifierGroup (por item)
CREATE TABLE IF NOT EXISTS "ModifierGroup" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "catalogItemId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "minSelect" INTEGER NOT NULL DEFAULT 0,
  "maxSelect" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ModifierGroup_catalogItemId_fkey"
    FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "ModifierGroup_catalogItemId_sortOrder_idx"
  ON "ModifierGroup" ("catalogItemId","sortOrder");
CREATE INDEX IF NOT EXISTS "ModifierGroup_accountId_idx"
  ON "ModifierGroup" ("accountId");

-- 3) ModifierOption
CREATE TABLE IF NOT EXISTS "ModifierOption" (
  "id" TEXT PRIMARY KEY,
  "groupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priceDeltaCents" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ModifierOption_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "ModifierOption_groupId_sortOrder_idx"
  ON "ModifierOption" ("groupId","sortOrder");
