-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('PF', 'PJ');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "document" TEXT,
ADD COLUMN     "personType" "PersonType" NOT NULL DEFAULT 'PF';
