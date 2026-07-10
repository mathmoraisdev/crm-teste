-- 2026-07-10-onda-P-branding-address.sql — Endereço físico do estabelecimento
-- Aplicar no Supabase SQL Editor. Idempotente. NÃO criar migration versionada
-- (schema entra por AQUI, precedente das ondas L/N/O). Ver [[prod-schema-drift-destravar]].

-- Texto livre (uma linha), universal a todo ramo. Mostrado na RETIRADA (cardápio
-- + acompanhamento) e no agendamento presencial; injetado no contexto da IA.
ALTER TABLE "AccountBranding" ADD COLUMN IF NOT EXISTS "businessAddress" TEXT;
