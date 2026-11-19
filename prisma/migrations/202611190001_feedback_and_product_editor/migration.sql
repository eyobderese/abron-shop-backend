-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'PRODUCT_EDITOR';

-- CreateTable
CREATE TABLE "inquiry_feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inquiry_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "allow_public" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inquiry_feedback_inquiry_id_key" ON "inquiry_feedback"("inquiry_id");

-- CreateIndex
CREATE INDEX "inquiry_feedback_created_at_idx" ON "inquiry_feedback"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "inquiry_feedback" ADD CONSTRAINT "inquiry_feedback_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

