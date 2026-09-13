BEGIN;

CREATE TYPE "ProductSizeType" AS ENUM ('NONE', 'SHOE_EU', 'CLOTHING', 'CUSTOM');

ALTER TABLE "products"
ADD COLUMN "size_type" "ProductSizeType" NOT NULL DEFAULT 'NONE',
ADD COLUMN "sizes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "inquiries"
ADD COLUMN "selected_size" TEXT;

ALTER TABLE "products"
ADD CONSTRAINT "products_none_size_type_has_no_sizes"
CHECK ("size_type" <> 'NONE' OR CARDINALITY("sizes") = 0);

COMMIT;
