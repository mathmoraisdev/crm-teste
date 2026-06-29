-- Origem da mensagem OUTBOUND, p/ separar métrica de tempo de resposta da IA
-- vs. do atendente humano no painel.
-- Coluna nullable de propósito: INBOUND e linhas anteriores a esta migração
-- ficam NULL (a métrica de IA passa a valer a partir do deploy, sem rotular
-- erroneamente o histórico).

-- CreateEnum
CREATE TYPE "MessageSource" AS ENUM ('AI', 'OPERATOR', 'CAMPAIGN', 'SYSTEM');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "source" "MessageSource";
