-- Reply/citação (quote) de mensagens do WhatsApp.
-- Message.replyToId: self-relation — a mensagem desta thread que esta responde.
--   OUTBOUND = operador citou pelo CRM; INBOUND = lead citou uma msg nossa
--   (resolvida pelo contextInfo.stanzaId → providerMessageId). SetNull preserva
--   a resposta caso a citada seja apagada.
-- OutboundJob.replyToMessageId: carrega a citação (id interno da Message) até o
--   worker, que resolve o providerMessageId/conteúdo p/ montar o `quoted` Baileys.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "replyToId" TEXT;

-- AlterTable
ALTER TABLE "OutboundJob" ADD COLUMN     "replyToMessageId" TEXT;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
