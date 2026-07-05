-- CreateEnum
CREATE TYPE "CustomFieldScope" AS ENUM ('LEAD', 'ORDER', 'ORDER_ITEM');

-- DropIndex
DROP INDEX "CustomFieldDef_userId_key_key";

-- AlterTable
ALTER TABLE "CustomFieldDef" ADD COLUMN     "scope" "CustomFieldScope" NOT NULL DEFAULT 'LEAD';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customFields" JSONB;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "customFields" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDef_userId_scope_key_key" ON "CustomFieldDef"("userId", "scope", "key");
