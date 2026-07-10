-- 2026-07-10-onda-O-menu-category-order.sql — Ordem manual das categorias do cardápio
-- Aplicar no Supabase SQL Editor. Idempotente. NÃO criar migration versionada
-- (schema entra por AQUI, precedente das ondas L/N). Ver [[prod-schema-drift-destravar]].

-- Ordem dos tópicos do cardápio público: array JSON de nomes de menuCategory na
-- ordem desejada. Categoria fora da lista vai depois (alfabética); "Outros" por último.
ALTER TABLE "DeliverySettings" ADD COLUMN IF NOT EXISTS "categoryOrderJson" JSONB;
