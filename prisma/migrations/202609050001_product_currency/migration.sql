BEGIN;

CREATE TYPE "ProductCurrency" AS ENUM ('ETB', 'USD');

ALTER TABLE "products"
ADD COLUMN "currency" "ProductCurrency" NOT NULL DEFAULT 'ETB';

COMMIT;
