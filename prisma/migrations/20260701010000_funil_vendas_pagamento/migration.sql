-- Funil de vendas com cobrança Pix (BYOK de pagamento).
-- Novos enums, credencial de pagamento cifrada no User, catálogo de ofertas
-- (Offer) e cobranças (Sale). Novos status do funil no LeadStatus.

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MERCADO_PAGO', 'ASAAS');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELED');

-- AlterEnum: novos estágios do funil (antes de DESCARTADO, p/ manter a ordem lógica).
ALTER TYPE "LeadStatus" ADD VALUE 'OFERTA_ENVIADA' BEFORE 'DESCARTADO';
ALTER TYPE "LeadStatus" ADD VALUE 'PAGO' BEFORE 'DESCARTADO';

-- AlterTable: credencial de pagamento BYOK no dono da conta.
ALTER TABLE "User" ADD COLUMN "paymentProvider" "PaymentProvider";
ALTER TABLE "User" ADD COLUMN "paymentKeyEnc" TEXT;
ALTER TABLE "User" ADD COLUMN "paymentKeyLast4" TEXT;
ALTER TABLE "User" ADD COLUMN "paymentKeyVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "whatsAppNumberId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerChargeId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'PENDING',
    "pixCopiaECola" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Offer_whatsAppNumberId_active_idx" ON "Offer"("whatsAppNumberId", "active");

-- CreateIndex
CREATE INDEX "Sale_leadId_idx" ON "Sale"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_provider_providerChargeId_key" ON "Sale"("provider", "providerChargeId");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_whatsAppNumberId_fkey" FOREIGN KEY ("whatsAppNumberId") REFERENCES "WhatsAppNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
