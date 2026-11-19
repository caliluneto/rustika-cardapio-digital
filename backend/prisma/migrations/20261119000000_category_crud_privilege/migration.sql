-- Category management: minimum column grants to the local Dev/Test runtime role.
-- Historical migrations are untouched. Replay in a new isolated Dev/Test database only.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $security$
DECLARE
  target_role text;
  other_role text;
BEGIN
  IF current_database() = 'cardapio_digital_dev' THEN
    target_role := 'cardapio_dev_app';
    other_role := 'cardapio_test_app';
  ELSIF current_database() = 'cardapio_digital_test' THEN
    target_role := 'cardapio_test_app';
    other_role := 'cardapio_dev_app';
  ELSE
    RAISE EXCEPTION 'Unauthorized database';
  END IF;
  IF current_user <> 'cardapio_migrator' OR session_user <> 'cardapio_migrator'
     OR current_setting('server_version_num')::int < 180000
     OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) <> current_user
     OR (SELECT count(*) FROM pg_roles WHERE rolname IN (target_role, other_role)) <> 2
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN (target_role, other_role, current_user)
                AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member IN
                (SELECT oid FROM pg_roles WHERE rolname IN (target_role, other_role, current_user))) THEN
    RAISE EXCEPTION 'Unexpected migration identity or unsafe roles';
  END IF;
  IF to_regclass('public.categories') IS NULL
     OR NOT has_table_privilege(target_role, 'public.categories', 'SELECT')
     OR has_table_privilege(target_role, 'public.categories', 'INSERT')
     OR has_table_privilege(target_role, 'public.categories', 'UPDATE')
     OR has_table_privilege(target_role, 'public.categories', 'DELETE')
     OR has_column_privilege(target_role, 'public.categories', 'name', 'INSERT')
     OR has_column_privilege(target_role, 'public.categories', 'name', 'UPDATE') THEN
    RAISE EXCEPTION 'Unexpected prior category ACL';
  END IF;

  EXECUTE format('GRANT INSERT (id, public_key, name, description, display_order, is_active, updated_at) ON TABLE public.categories TO %I', target_role);
  EXECUTE format('GRANT UPDATE (name, description, display_order, updated_at) ON TABLE public.categories TO %I', target_role);

  IF NOT has_column_privilege(target_role, 'public.categories', 'id', 'INSERT')
     OR NOT has_column_privilege(target_role, 'public.categories', 'name', 'INSERT')
     OR NOT has_column_privilege(target_role, 'public.categories', 'description', 'UPDATE')
     OR NOT has_column_privilege(target_role, 'public.categories', 'display_order', 'UPDATE')
     OR has_column_privilege(target_role, 'public.categories', 'public_key', 'UPDATE')
     OR has_column_privilege(target_role, 'public.categories', 'is_active', 'UPDATE')
     OR has_table_privilege(target_role, 'public.categories', 'INSERT')
     OR has_table_privilege(target_role, 'public.categories', 'UPDATE')
     OR has_table_privilege(target_role, 'public.categories', 'DELETE')
     OR has_column_privilege(target_role, 'public.categories', 'name', 'INSERT WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'Category grants postcondition failed';
  END IF;
END
$security$;
COMMIT;
