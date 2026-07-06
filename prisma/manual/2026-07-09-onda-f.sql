-- Onda F (idempotente). Iniciativa 8 (agendamento online): slug público + config de booking.
-- Iniciativa 9 (comissão) ACRESCENTA CommissionRule + OrderItem.commissionCents neste mesmo
-- arquivo — não sobrescreva, compõe (padrão da Onda A/E). [[prod-schema-drift-destravar]]
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "publicSlug" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bookingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bookingLeadMinutes" INTEGER NOT NULL DEFAULT 120;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bookingHorizonDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bookingSlotStep" INTEGER NOT NULL DEFAULT 15;
-- @unique do Prisma vira índice único; nulos são distintos no Postgres (contas sem slug coexistem).
CREATE UNIQUE INDEX IF NOT EXISTS "User_publicSlug_key" ON "User"("publicSlug");
