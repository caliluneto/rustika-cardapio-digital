-- Primeiro removemos a constraint antiga
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_source_identity_consistent";

-- Adicionamos a constraint com suporte a códigos alfanuméricos (`^[A-Za-z0-9]+$`)
ALTER TABLE "products" ADD CONSTRAINT "products_source_identity_consistent" CHECK (
 ("public_key" IS NULL AND "source_code" IS NULL AND "source_name" IS NULL AND "source_group" IS NULL)
 OR
 ("public_key" IS NOT NULL AND "source_code" IS NOT NULL AND "source_code" ~ '^[A-Za-z0-9]+$'
   AND "source_name" IS NOT NULL AND length(btrim("source_name")) > 0
   AND "source_group" IS NOT NULL AND length(btrim("source_group")) > 0
   AND "public_key" = 'rustika-' || "source_code"
 )
);