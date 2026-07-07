-- Separa "Financeiro & fiscal" do gate de configurações do operador.
-- Idempotente (build é dono via migrate deploy — ver prod-schema-drift-destravar).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canFinance" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: preserva o comportamento atual. Hoje toda ação financeira exigia
-- canSettings=true; espelhar garante que operador que NÃO podia (canSettings=false)
-- continua sem acesso ao financeiro. Só afeta linhas existentes uma vez.
UPDATE "User" SET "canFinance" = "canSettings" WHERE "canFinance" IS DISTINCT FROM "canSettings";
