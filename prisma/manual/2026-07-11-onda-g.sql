-- Onda G (idempotente) — iniciativa 12 (Catálogo/estoque++). Três fases COMPÕEM este
-- arquivo (12.1 custo-snapshot · 12.2 barcode · 12.3 variantGroup). NÃO sobrescreva;
-- acrescente. Tudo IF NOT EXISTS → ordem de aplicação não importa. [[prod-schema-drift-destravar]]

-- ── 12.1: snapshot de custo por linha (margem realizada) ──────────────────────
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "unitCostCents" INTEGER;

-- ── 12.2: código de barras/EAN (único por conta; NULLs coexistem) ─────────────
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "barcode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogItem_accountId_barcode_key"
  ON "CatalogItem"("accountId", "barcode");
