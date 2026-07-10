-- 2026-07-08-onda-L.sql — Delivery / Cardápio online (iniciativa 15)
-- Aplicar no Supabase SQL Editor (env do DB é Sensitive, não alcança do CI).
-- Idempotente. NÃO duplicar com migration versionada — schema da Onda entra por AQUI.

-- 1) Enums
DO $$ BEGIN CREATE TYPE "OrderType" AS ENUM ('MESA','DELIVERY','RETIRADA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "OrderSource" AS ENUM ('POS','ONLINE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "FulfillmentStatus"
  AS ENUM ('PENDENTE','CONFIRMADO','EM_PREPARO','PRONTO','SAIU_ENTREGA','ENTREGUE','RECUSADO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2) Order: tipo, origem, fulfillment, entrega, cobrança online
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "orderType" "OrderType";
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "source" "OrderSource";
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fulfillmentStatus" "FulfillmentStatus";
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryAddress" JSONB;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryFeeCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryZoneId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "onlineChargeProvider" "PaymentProvider";
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "onlineChargeId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "onlinePixCopiaECola" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "onlinePaidAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Order_accountId_fulfillmentStatus_idx"
  ON "Order" ("accountId","fulfillmentStatus");
CREATE UNIQUE INDEX IF NOT EXISTS "Order_onlineChargeProvider_onlineChargeId_key"
  ON "Order" ("onlineChargeProvider","onlineChargeId");

-- 3) CatalogItem: campos de cardápio
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "menuCategory" TEXT;
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "menuVisible" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "menuDescription" TEXT;
CREATE INDEX IF NOT EXISTS "CatalogItem_accountId_menuCategory_idx"
  ON "CatalogItem" ("accountId","menuCategory");

-- 4) User: gate do link público + flag do add-on de delivery
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "menuEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deliveryAddon" BOOLEAN NOT NULL DEFAULT false;

-- 5) DeliverySettings (1:1 conta)
CREATE TABLE IF NOT EXISTS "DeliverySettings" (
  "accountId" TEXT PRIMARY KEY,
  "deliveryEnabled" BOOLEAN NOT NULL DEFAULT true,
  "pickupEnabled" BOOLEAN NOT NULL DEFAULT true,
  "payOnlineEnabled" BOOLEAN NOT NULL DEFAULT true,
  "payOnDeliveryEnabled" BOOLEAN NOT NULL DEFAULT true,
  "minOrderCents" INTEGER NOT NULL DEFAULT 0,
  "defaultPrepMinutes" INTEGER NOT NULL DEFAULT 30,
  "hoursJson" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "DeliverySettings_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- 6) DeliveryZone (bairros/taxas)
CREATE TABLE IF NOT EXISTS "DeliveryZone" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "feeCents" INTEGER NOT NULL DEFAULT 0,
  "minOrderCents" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "DeliveryZone_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "DeliveryZone_accountId_active_idx"
  ON "DeliveryZone" ("accountId","active");

-- 7) FK Order.deliveryZoneId -> DeliveryZone (onDelete: SetNull, como no schema).
-- Precisa vir DEPOIS do CREATE TABLE "DeliveryZone" acima. Guardada p/ idempotência.
DO $$ BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryZoneId_fkey"
    FOREIGN KEY ("deliveryZoneId") REFERENCES "DeliveryZone"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
