-- Onda G (idempotente) — iniciativa 12 (Catálogo/estoque++). Três fases COMPÕEM este
-- arquivo (12.1 custo-snapshot · 12.2 barcode · 12.3 variantGroup). NÃO sobrescreva;
-- acrescente. Tudo IF NOT EXISTS → ordem de aplicação não importa. [[prod-schema-drift-destravar]]

-- ── 12.1: snapshot de custo por linha (margem realizada) ──────────────────────
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "unitCostCents" INTEGER;
