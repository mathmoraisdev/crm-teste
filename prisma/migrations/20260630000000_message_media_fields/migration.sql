-- Mídia recebida do lead (imagem/PDF): caminho no Supabase Storage + metadados.
-- Colunas nuláveis: texto e linhas existentes ficam NULL (sem backfill).
ALTER TABLE "Message" ADD COLUMN "mediaPath" TEXT;
ALTER TABLE "Message" ADD COLUMN "mediaType" TEXT;
ALTER TABLE "Message" ADD COLUMN "mediaMime" TEXT;
ALTER TABLE "Message" ADD COLUMN "fileName" TEXT;
