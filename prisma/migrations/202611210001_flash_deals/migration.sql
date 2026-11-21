-- AlterTable
ALTER TABLE "products" ADD COLUMN     "flash_ends_at" TIMESTAMPTZ(6),
ADD COLUMN     "flash_price" DECIMAL(10,2),
ADD COLUMN     "flash_starts_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "products_flash_ends_at_idx" ON "products"("flash_ends_at");

