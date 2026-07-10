-- 2026-07-10-onda-M.sql — Numeração sequencial por conta (pedidos online + agendamentos)
-- Aplicar no Supabase SQL Editor (env do DB é Sensitive, não alcança do CI).
-- Idempotente. NÃO duplicar com migration versionada — schema da Onda entra por AQUI.

-- 1) Order: nº sequencial do PEDIDO ONLINE por conta, atribuído na CRIAÇÃO
--    (distinto do `number`/cupom, que é do PDV e sai no fechamento).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "onlineNumber" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "Order_accountId_onlineNumber_key"
  ON "Order" ("accountId","onlineNumber");

-- 2) Appointment: nº sequencial do AGENDAMENTO por conta, atribuído na CRIAÇÃO.
--    O @@unique cobre walk-ins (accountId preenchido); agendamentos com lead
--    (accountId null) são serializados por advisory lock no serviço.
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "number" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_accountId_number_key"
  ON "Appointment" ("accountId","number");
