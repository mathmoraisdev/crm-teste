-- Onda A — impressão de comanda + POS financeiro. Idempotente.
-- Aplicar no Supabase SQL Editor (env do DB é Sensitive, não alcança daqui).
-- Ver [[prod-schema-drift-destravar]]: NÃO duplicar com migration versionada;
-- mudança de schema da Onda A entra por AQUI (catch-up manual sem migration).

-- Task N1.1: nº sequencial do cupom por conta (null = comanda antiga).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "number" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "Order_accountId_number_key" ON "Order"("accountId","number");

-- Fase N2: config opt-in de impressão ESC/POS via QZ Tray (por conta).
ALTER TABLE "AccountBranding" ADD COLUMN IF NOT EXISTS "printMode" TEXT;
ALTER TABLE "AccountBranding" ADD COLUMN IF NOT EXISTS "printerName" TEXT;
ALTER TABLE "AccountBranding" ADD COLUMN IF NOT EXISTS "openDrawer" BOOLEAN NOT NULL DEFAULT false;

-- Fase N3: setor de impressão do item (comanda de cozinha).
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "printSector" TEXT;

-- POS Fase 2: ajustes financeiros da comanda (total continua derivado).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "discountCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "surchargeCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "tipCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "amountTenderedCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "changeCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "tableLabel" TEXT;
