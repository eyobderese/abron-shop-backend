BEGIN;

-- Repair legacy rows where image_views contains empty arrays instead of
-- objects. The canonical images array already contains the working URLs.
UPDATE "products" AS product
SET "image_views" = (
  SELECT JSONB_AGG(
    JSONB_BUILD_OBJECT(
      'url', image.url,
      'label', CASE image.position
        WHEN 1 THEN 'front'
        WHEN 2 THEN 'back'
        WHEN 3 THEN 'side'
        WHEN 4 THEN 'detail'
        WHEN 5 THEN 'lifestyle'
        ELSE 'other'
      END
    )
    ORDER BY image.position
  )
  FROM UNNEST(product."images") WITH ORDINALITY AS image(url, position)
)
WHERE CARDINALITY(product."images") > 0
  AND NOT EXISTS (
    SELECT 1
    FROM JSONB_ARRAY_ELEMENTS(
      CASE
        WHEN JSONB_TYPEOF(product."image_views") = 'array'
          THEN product."image_views"
        ELSE '[]'::JSONB
      END
    ) AS view(value)
    WHERE JSONB_TYPEOF(view.value) = 'object'
      AND view.value ? 'url'
      AND JSONB_TYPEOF(view.value->'url') = 'string'
  );

COMMIT;
