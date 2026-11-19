-- 3D.4.2: prepared only. NOT applied. Apply through the authorized migrate-test wrapper after review.
-- Bytes are immutable after approval/application; migrations/** -text preserves LF.
-- Grants the runtime role exactly UPDATE (availability_state, updated_at) on public.products so the
-- administrative availability change (compare-and-set) can run. Column-level grant: no table-level UPDATE,
-- no DELETE, no TRUNCATE, no REFERENCES/TRIGGER, no GRANT OPTION, no other column (price, is_active,
-- category_id, public_key, source_*, legacy is_available, ...), no other table.
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
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.products'::regclass AND attname = 'availability_state' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.products'::regclass AND attname = 'updated_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Missing dependency: products.availability_state / products.updated_at';
  END IF;
  -- The previous migration (20261105000000_order_status_update_privilege) must have been applied: the only
  -- column ACL in public is UPDATE (status, updated_at) on orders for the runtime role, and products has
  -- no UPDATE/DELETE at table level for the runtime role.
  IF EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             CROSS JOIN LATERAL aclexplode(a.attacl) acl
             WHERE n.nspname = 'public' AND a.attacl IS NOT NULL
               AND NOT (c.relname = 'orders' AND a.attname IN ('status', 'updated_at')
                        AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = target_role)
                        AND acl.privilege_type = 'UPDATE' AND NOT acl.is_grantable))
     OR NOT has_column_privilege(target_role, 'public.orders', 'status', 'UPDATE')
     OR NOT has_column_privilege(target_role, 'public.orders', 'updated_at', 'UPDATE')
     OR has_table_privilege(target_role, 'public.products', 'UPDATE')
     OR has_table_privilege(target_role, 'public.products', 'DELETE')
     OR has_any_column_privilege(target_role, 'public.products', 'UPDATE')
     OR NOT has_table_privilege(target_role, 'public.products', 'SELECT') THEN
    RAISE EXCEPTION 'Unexpected prior ACL: apply 20261105000000_order_status_update_privilege first';
  END IF;

  EXECUTE format('GRANT UPDATE (availability_state, updated_at) ON TABLE public.products TO %I', target_role);

  -- Post-condition inside the same transaction: any deviation aborts and rolls back the grant.
  IF NOT has_column_privilege(target_role, 'public.products', 'availability_state', 'UPDATE')
     OR NOT has_column_privilege(target_role, 'public.products', 'updated_at', 'UPDATE')
     OR has_table_privilege(target_role, 'public.products', 'UPDATE')
     OR has_table_privilege(target_role, 'public.products', 'DELETE')
     OR has_table_privilege(target_role, 'public.products', 'TRUNCATE')
     OR has_column_privilege(target_role, 'public.products', 'availability_state', 'UPDATE WITH GRANT OPTION')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.products'::regclass AND a.attnum > 0
                AND NOT a.attisdropped AND a.attname NOT IN ('availability_state', 'updated_at')
                AND has_column_privilege(target_role, a.attrelid, a.attnum, 'UPDATE'))
     OR EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                CROSS JOIN LATERAL aclexplode(a.attacl) acl
                WHERE n.nspname = 'public' AND a.attacl IS NOT NULL
                  AND NOT ((c.relname = 'products' AND a.attname IN ('availability_state', 'updated_at')
                            OR c.relname = 'orders' AND a.attname IN ('status', 'updated_at'))
                           AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = target_role)
                           AND acl.privilege_type = 'UPDATE' AND NOT acl.is_grantable))
     OR EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = other_role
                AND (has_any_column_privilege(r.oid, 'public.products', 'UPDATE')
                     OR has_any_column_privilege(r.oid, 'public.orders', 'UPDATE'))) THEN
    RAISE EXCEPTION 'Unexpected privileges after granting products availability update';
  END IF;
END
$security$;
COMMIT;
