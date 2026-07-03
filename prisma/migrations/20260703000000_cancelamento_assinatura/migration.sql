-- Cancelamento self-service da assinatura pelo dono da conta.
-- Aditivo e nullable: não corta acesso nem apaga dados; só registra a intenção.
ALTER TABLE "User" ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);
