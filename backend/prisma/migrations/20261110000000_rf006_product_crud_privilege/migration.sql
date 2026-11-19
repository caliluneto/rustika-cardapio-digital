-- RF006: prepared only. NOT applied. Apply through the authorized migrate-test wrapper after review.
-- Bytes are immutable after approval/application; migrations/** -text preserves LF.
-- Grants the runtime role column-level privileges on public.products so the administrative CRUD
-- (POST/PATCH/DELETE) can run. No table-level UPDATE, no TRUNCATE, no REFERENCES/TRIGGER,
-- no GRANT OPTION, no other column (source_code, source_name, source_group, public_key, category_id,
-- is_active, availability_state, legacy is_available, ...), no other table.
-- DELETE on products is granted but blocked at the DB level by onDelete: Restrict on order_items
-- when the product has references; the service also checks order_items before attempting DELETE.
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
  IF to_regclass('public.products') IS NULL
     OR to_regclass('public.categories') IS NULL
     OR to_regclass('public.order_items') IS NULL THEN
    RAISE EXCEPTION 'Missing dependency: products / categories / order_items';
  END IF;
  -- Pre-condition: only the availability_state/updated_at UPDATE grant from 20261106000000 exists on
  -- products for the target role, plus SELECT on products/categories/order_items from the base migration.
  IF NOT has_column_privilege(target_role, 'public.products', 'availability_state', 'UPDATE')
     OR NOT has_column_privilege(target_role, 'public.products', 'updated_at', 'UPDATE')
     OR has_table_privilege(target_role, 'public.products', 'UPDATE')
     OR has_table_privilege(target_role, 'public.products', 'DELETE')
     OR has_table_privilege(target_role, 'public.products', 'TRUNCATE')
     OR has_column_privilege(target_role, 'public.products', 'availability_state', 'UPDATE WITH GRANT OPTION')
     OR NOT has_table_privilege(target_role, 'public.products', 'SELECT')
     OR NOT has_table_privilege(target_role, 'public.categories', 'SELECT')
     OR NOT has_table_privilege(target_role, 'public.order_items', 'SELECT') THEN
    RAISE EXCEPTION 'Unexpected prior ACL: apply 20261106000000_product_availability_update_privilege first';
  END IF;

  -- Column-level INSERT on products (business columns the admin form sets).
  EXECUTE format('GRANT INSERT (public_key, source_code, source_name, source_group, name, description, ingredients, price, image_url, image_alt, category_id, is_active, availability_state) ON TABLE public.products TO %I', target_role);

  -- Column-level UPDATE on products (only fields the admin can edit; identity columns excluded).
  EXECUTE format('GRANT UPDATE (name, description, ingredients, price, image_url, image_alt, updated_at) ON TABLE public.products TO %I', target_role);

  -- Table-level DELETE on products (blocked by onDelete: Restrict when order_items reference exists).
  EXECUTE format('GRANT DELETE ON TABLE public.products TO %I', target_role);

  -- Post-condition inside the same transaction: any deviation aborts and rolls back.
  IF NOT has_column_privilege(target_role, 'public.products', 'name', 'INSERT')
     OR NOT has_column_privilege(target_role, 'public.products', 'price', 'INSERT')
     OR NOT has_column_privilege(target_role, 'public.products', 'category_id', 'INSERT')
     OR NOT has_column_privilege(target_role, 'public.products', 'name', 'UPDATE')
     OR NOT has_column_privilege(target_role, 'public.products', 'price', 'UPDATE')
     OR NOT has_column_privilege(target_role, 'public.products', 'updated_at', 'UPDATE')
     OR has_table_privilege(target_role, 'public.products', 'UPDATE')
     OR has_table_privilege(target_role, 'public.products', 'INSERT')
     OR NOT has_table_privilege(target_role, 'public.products', 'DELETE')
     OR has_table_privilege(target_role, 'public.products', 'TRUNCATE')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.products'::regclass AND a.attnum > 0
                AND NOT a.attisdropped AND a.attname NOT IN (
                  'public_key','source_code','source_name','source_group','name','description','ingredients',
                  'price','image_url','image_alt','category_id','is_active','availability_state',
                  'updated_at'
                )
                AND has_column_privilege(target_role, a.attrelid, a.attnum, 'INSERT'))
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.products'::regclass AND a.attnum > 0
                AND NOT a.attisdropped AND a.attname NOT IN (
                  'availability_state','updated_at','name','description','ingredients','price',
                  'image_url','image_alt'
                )
                AND has_column_privilege(target_role, a.attrelid, a.attnum, 'UPDATE'))
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.products'::regclass AND a.attnum > 0
                AND NOT a.attisdropped AND a.attname IN (
                  'id','public_key','source_code','source_name','source_group','category_id',
                  'is_active','is_available','created_at','description_source'
                )
                AND has_column_privilege(target_role, a.attrelid, a.attnum, 'UPDATE'))
     OR EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                CROSS JOIN LATERAL aclexplode(a.attacl) acl
                WHERE n.nspname = 'public' AND a.attacl IS NOT NULL
                  AND NOT (
                    (c.relname = 'products' AND (
                      (a.attname IN (
                        'availability_state','updated_at','name','description','ingredients','price',
                        'image_url','image_alt'
                      ) AND acl.privilege_type = 'UPDATE')
                      OR (a.attname IN (
                        'public_key','source_code','source_name','source_group','name','description',
                        'ingredients','price','image_url','image_alt','category_id','is_active',
                        'availability_state'
                      ) AND acl.privilege_type = 'INSERT')
                    ) AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = target_role)
                      AND NOT acl.is_grantable)
                    OR (c.relname = 'orders' AND a.attname IN ('status','updated_at')
                      AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = target_role)
                      AND acl.privilege_type = 'UPDATE' AND NOT acl.is_grantable)
                  )) THEN
    RAISE EXCEPTION 'Unexpected privileges after granting RF006 product CRUD';
  END IF;
END
$security$;
COMMIT;
