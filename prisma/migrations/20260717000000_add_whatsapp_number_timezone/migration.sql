-- Fuso horário (IANA) por número de WhatsApp. A IA de atendimento usa para saber
-- a data/hora real do expediente (resolve o bug "cartório fechado" em fusos != SP).
-- null = cai em SCHEDULING_TIMEZONE (default da conta/plataforma). Aditivo.
ALTER TABLE "WhatsAppNumber"
  ADD COLUMN "timezone" TEXT;
