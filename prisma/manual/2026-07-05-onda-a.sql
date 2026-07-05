-- Onda A — impressão de comanda + POS financeiro. Idempotente.
-- Aplicar no Supabase SQL Editor (env do DB é Sensitive, não alcança daqui).
-- Ver [[prod-schema-drift-destravar]]: NÃO duplicar com migration versionada;
-- mudança de schema da Onda A entra por AQUI (catch-up manual sem migration).

-- Task N1.1: nº sequencial do cupom por conta (null = comanda antiga).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "number" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "Order_accountId_number_key" ON "Order"("accountId","number");
