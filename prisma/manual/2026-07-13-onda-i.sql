-- Onda I — Anúncios no catálogo (fotos + ficha técnica).
-- Idempotente. Aplicar no Supabase SQL Editor (produção) ANTES do deploy de código.
-- NÃO duplicar com migration versionada em prisma/migrations. Ver [[prod-schema-drift-destravar]].

-- 1) Novo valor no enum de escopo de campo customizado (specs do produto/anúncio).
--    ADD VALUE IF NOT EXISTS é idempotente; roda fora de transação.
ALTER TYPE "CustomFieldScope" ADD VALUE IF NOT EXISTS 'PRODUCT';

-- 2) Coluna de specs no item de catálogo (valores dos CustomFieldDef scope=PRODUCT).
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "customFields" JSONB;

-- 3) Tabela da galeria de fotos do anúncio.
CREATE TABLE IF NOT EXISTS "CatalogItemPhoto" (
  "id"            TEXT NOT NULL,
  "catalogItemId" TEXT NOT NULL,
  "mediaPath"     TEXT NOT NULL,
  "mediaMime"     TEXT NOT NULL,
  "order"         INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogItemPhoto_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "CatalogItemPhoto"
    ADD CONSTRAINT "CatalogItemPhoto_catalogItemId_fkey"
    FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "CatalogItemPhoto_catalogItemId_order_idx"
  ON "CatalogItemPhoto" ("catalogItemId", "order");
