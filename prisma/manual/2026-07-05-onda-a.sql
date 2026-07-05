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

-- POS Fase 3: multi-pagamento (N tenders por comanda). "OrderPayment" já existe.
CREATE TABLE IF NOT EXISTS "OrderTender" (
  "id"          TEXT NOT NULL,
  "orderId"     TEXT NOT NULL,
  "method"      "OrderPayment" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderTender_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OrderTender_orderId_idx" ON "OrderTender"("orderId");
-- FK só se ainda não existir (idempotente — Postgres não tem ADD CONSTRAINT IF NOT EXISTS).
DO $$ BEGIN
  ALTER TABLE "OrderTender" ADD CONSTRAINT "OrderTender_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
