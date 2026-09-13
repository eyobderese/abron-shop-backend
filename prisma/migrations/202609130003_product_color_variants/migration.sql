BEGIN;

CREATE TABLE "product_families" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "model_code" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_families_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_families_key_key" ON "product_families"("key");
CREATE INDEX "product_families_brand_idx" ON "product_families"("brand");

ALTER TABLE "products"
ADD COLUMN "family_id" UUID,
ADD COLUMN "color_name" TEXT,
ADD COLUMN "color_code" TEXT,
ADD COLUMN "color_hex" TEXT,
ADD COLUMN "variant_key" TEXT,
ADD COLUMN "variant_sort_order" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "products_family_id_variant_key_key"
ON "products"("family_id", "variant_key");

ALTER TABLE "products"
ADD CONSTRAINT "products_family_id_fkey"
FOREIGN KEY ("family_id") REFERENCES "product_families"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inquiries" ADD COLUMN "selected_color" TEXT;

COMMIT;
