-- Onda E (idempotente). Iniciativa 7 (IA tool-calling): flag + biblioteca de mídia.
-- Iniciativa 10 (automação) ACRESCENTA Lead.lastEngagedAt neste mesmo arquivo — não sobrescreva, compõe.
-- Regra de ouro da Onda: em PROD só o dono aplica ESTE arquivo idempotente no Supabase
-- SQL Editor; nunca rode SQL manual redundante com uma migration versionada.

-- Iniciativa 7 · Fase 2 — flag por número (default false = fluxo de hoje byte-idêntico).
ALTER TABLE "WhatsAppNumber" ADD COLUMN IF NOT EXISTS "aiToolCallingEnabled" BOOLEAN NOT NULL DEFAULT false;
