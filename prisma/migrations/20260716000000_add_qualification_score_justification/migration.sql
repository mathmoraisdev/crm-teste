-- Justificativa curta do score gerada pela IA (focada em vendas).
-- Espelha o campo Qualification.scoreJustification do schema (nullable).
ALTER TABLE "Qualification" ADD COLUMN IF NOT EXISTS "scoreJustification" TEXT;
