-- Add permanent, human-readable product URLs without changing internal UUIDs.
ALTER TABLE "products" ADD COLUMN "slug" TEXT;

-- Backfill existing products. Duplicate or colliding names receive stable
-- numeric suffixes, including cases such as "Shoe", "Shoe", and "Shoe 2".
DO $$
DECLARE
  product_row RECORD;
  base_slug TEXT;
  candidate_slug TEXT;
  suffix INTEGER;
BEGIN
  FOR product_row IN
    SELECT "id", "name"
    FROM "products"
    ORDER BY "created_at", "id"
  LOOP
    base_slug := LEFT(
      COALESCE(
        NULLIF(
          TRIM(BOTH '-' FROM REGEXP_REPLACE(
            LOWER(REPLACE(REPLACE(REPLACE(product_row."name", '&', ' and '), '''', ''), '’', '')),
            '[^a-z0-9]+',
            '-',
            'g'
          )),
          ''
        ),
        'product'
      ),
      180
    );
    candidate_slug := base_slug;
    suffix := 2;

    WHILE EXISTS (
      SELECT 1 FROM "products" WHERE "slug" = candidate_slug
    ) LOOP
      candidate_slug := LEFT(base_slug, 180 - LENGTH(suffix::TEXT) - 1)
        || '-' || suffix::TEXT;
      suffix := suffix + 1;
    END LOOP;

    UPDATE "products"
    SET "slug" = candidate_slug
    WHERE "id" = product_row."id";
  END LOOP;
END $$;

ALTER TABLE "products" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");
