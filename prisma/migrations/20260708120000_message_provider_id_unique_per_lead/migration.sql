-- providerMessageId deixa de ser único GLOBALMENTE e passa a ser único POR LEAD.
-- Motivo: o mesmo WA key.id é visto pelo remetente e pelo destinatário; quando dois
-- números conectados ao sistema conversam, a mesma id aparece em DUAS contas (outbound
-- de um, inbound do outro). A unique global derrubava o inbound legítimo com P2002 e a
-- IA nunca respondia. A unicidade correta é por lead.
--
-- Idempotente (IF EXISTS/IF NOT EXISTS): seguro se aplicado manualmente antes do
-- migrate deploy. A unicidade global antiga implica a por-lead, então o índice novo
-- não falha sobre os dados existentes.
DROP INDEX IF EXISTS "Message_providerMessageId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Message_leadId_providerMessageId_key"
  ON "Message" ("leadId", "providerMessageId");
