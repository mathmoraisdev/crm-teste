-- Anexo de saída (operador envia arquivo pela inbox): caminho no Supabase Storage
-- + metadados no OutboundJob. O worker baixa o buffer e envia pelo chip.
-- Colunas nuláveis: jobs de texto/campanha e linhas existentes ficam NULL.
ALTER TABLE "OutboundJob" ADD COLUMN "mediaPath" TEXT;
ALTER TABLE "OutboundJob" ADD COLUMN "mediaType" TEXT;
ALTER TABLE "OutboundJob" ADD COLUMN "mediaMime" TEXT;
ALTER TABLE "OutboundJob" ADD COLUMN "fileName" TEXT;
