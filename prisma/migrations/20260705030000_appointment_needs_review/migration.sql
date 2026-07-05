-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewReason" TEXT;

-- CreateIndex
CREATE INDEX "Appointment_needsReview_idx" ON "Appointment"("needsReview");
