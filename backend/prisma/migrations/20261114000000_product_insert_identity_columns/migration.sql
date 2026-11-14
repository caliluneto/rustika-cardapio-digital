-- Fixes a gap left by 20261110000000_rf006_product_crud_privilege: Prisma's product.create() always
-- sends explicit values for `id` (Product.id uses @default(uuid()), a Prisma-side default, not a DB
-- default) and `updated_at` (@updatedAt is always set client-side, on create too). Neither column was
-- in RF006's column-level INSERT grant, so POST /api/admin/products failed with a Postgres column
-- permission error (surfaced by Prisma as PrismaClientUnknownRequestError).
-- Grants ONLY INSERT on products.id and products.updated_at to the runtime role. No table-level
-- INSERT/UPDATE, no TRUNCATE, no REFERENCES/TRIGGER, no GRANT OPTION, no other column, no other table.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $security$
DECLARE
  target_role text;
  other_role text;
BEGIN
  IF current_database() = 'cardapio_digital_test' THEN
    target_role := 'cardapio_test_app';
    other_role := 'cardapio_dev_app';
  ELSIF current_database() = 'cardapio_digital_dev' THEN
    target_role := 'cardapio_dev_app';
    other_role := 'cardapio_test_app';
  ELSE
    RAISE EXCEPTION 'Unauthorized database';
  END IF;
  IF current_user <> 'cardapio_migrator' OR session_user <> 'cardapio_migrator'
     OR current_setting('server_version_num')::int < 170000
     OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) <> current_user THEN
    RAISE EXCEPTION 'Unexpected migration identity or PostgreSQL version';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN (target_role, other_role)) <> 2
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN (target_role, other_role, current_user)
                AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member IN
                (SELECT oid FROM pg_roles WHERE rolname IN (target_role, other_role))) THEN
    RAISE EXCEPTION 'Unsafe role attributes or inherited privileges';
  END IF;
  IF to_regclass('public.products') IS NULL THEN
    RAISE EXCEPTION 'Missing dependency: products';
  END IF;
  -- Pre-condition: exactly the RF006 column-level ACL exists; id/updated_at INSERT not yet granted.
  IF NOT has_column_privilege(target_role, 'public.products', 'name', 'INSERT')
     OR NOT has_column_privilege(target_role, 'public.products', 'category_id', 'INSERT')
     OR has_column_privilege(target_role, 'public.products', 'id', 'INSERT')
     OR has_column_privilege(target_role, 'public.products', 'updated_at', 'INSERT')
     OR has_table_privilege(target_role, 'public.products', 'UPDATE')
     OR has_table_privilege(target_role, 'public.products', 'INSERT')
     OR NOT has_table_privilege(target_role, 'public.products', 'DELETE')
     OR NOT has_table_privilege(target_role, 'public.products', 'SELECT') THEN
    RAISE EXCEPTION 'Unexpected prior ACL: apply 20261110000000_rf006_product_crud_privilege first';
  END IF;

  -- Column-level INSERT on the two technical columns Prisma always sets on product.create().
  EXECUTE format('GRANT INSERT (id, updated_at) ON TABLE public.products TO %I', target_role);

  -- Post-condition inside the same transaction: any deviation aborts and rolls back.
  IF NOT has_column_privilege(target_role, 'public.products', 'id', 'INSERT')
     OR NOT has_column_privilege(target_role, 'public.products', 'updated_at', 'INSERT')
     OR has_column_privilege(target_role, 'public.products', 'id', 'INSERT WITH GRANT OPTION')
     OR has_column_privilege(target_role, 'public.products', 'updated_at', 'INSERT WITH GRANT OPTION')
     OR has_table_privilege(target_role, 'public.products', 'UPDATE')
     OR has_table_privilege(target_role, 'public.products', 'INSERT')
     OR NOT has_table_privilege(target_role, 'public.products', 'DELETE')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.products'::regclass AND a.attnum > 0
                AND NOT a.attisdropped AND a.attname NOT IN (
                  'public_key','source_code','source_name','source_group','name','description','ingredients',
                  'price','image_url','image_alt','category_id','is_active','availability_state',
                  'id','updated_at'
                )
                AND has_column_privilege(target_role, a.attrelid, a.attnum, 'INSERT')) THEN
    RAISE EXCEPTION 'Unexpected privileges after granting product id/updated_at INSERT';
  END IF;
END
$security$;
COMMIT;
