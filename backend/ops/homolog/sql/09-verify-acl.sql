-- NAO EXECUTADO. Somente leitura. Via psql no banco cardapio_digital_homolog (migrator definitivo ou administrador).
-- Aborta se algo divergir da identidade e das ACLs esperadas.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
\ir contracts/expected-migrations.sql
DO $verify$
BEGIN
  IF current_database() <> 'cardapio_digital_homolog' THEN RAISE EXCEPTION 'ABORT: banco inesperado'; END IF;
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname IN ('cardapio_digital_test', 'cardapio_digital_dev', 'cardapio_digital_shadow')) THEN
    RAISE EXCEPTION 'IDENTIDADE: o cluster contem bancos Dev/Test/Shadow';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('cardapio_migrator', 'cardapio_test_app', 'cardapio_dev_app')) THEN
    RAISE EXCEPTION 'IDENTIDADE: roles legadas ainda existem; finalize a renomeacao';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rustika_homolog_marker') THEN RAISE EXCEPTION 'IDENTIDADE: cluster sem marca'; END IF;
  IF (SELECT count(*) FROM public._prisma_migrations) <> 9 OR EXISTS (
    WITH expected AS (
      SELECT * FROM jsonb_to_recordset(current_setting('rustika.expected_migrations')::jsonb)
        AS x(ord integer, migration_name text, checksum text)
    ), actual AS (
      SELECT m.*, row_number() OVER (ORDER BY started_at, migration_name)::integer AS ord
        FROM public._prisma_migrations m
    )
    SELECT 1 FROM expected e FULL OUTER JOIN actual m USING (migration_name)
     WHERE e.migration_name IS NULL OR m.migration_name IS NULL OR m.checksum <> e.checksum OR m.ord <> e.ord
        OR m.started_at IS NULL OR m.finished_at IS NULL OR m.finished_at < m.started_at
        OR m.rolled_back_at IS NOT NULL OR m.applied_steps_count <> 1 OR m.logs IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SCHEMA: o baseline exato de nove migrations nao esta concluido';
  END IF;
  IF (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) <> 'cardapio_homolog_migrator' THEN
    RAISE EXCEPTION 'ACL: o dono do banco deve ser cardapio_homolog_migrator';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S','v','m','i','f')
                AND pg_get_userbyid(c.relowner) <> 'cardapio_homolog_migrator')
     OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'public' AND t.typtype IN ('e','c','d','r') AND t.typrelid = 0
                   AND pg_get_userbyid(t.typowner) <> 'cardapio_homolog_migrator') THEN
    RAISE EXCEPTION 'ACL: ownership de objetos public diverge';
  END IF;
  IF has_table_privilege('cardapio_homolog_app', 'public.admins', 'INSERT')
     OR has_table_privilege('cardapio_homolog_app', 'public.admins', 'UPDATE')
     OR has_table_privilege('cardapio_homolog_app', 'public.admins', 'DELETE')
     OR NOT has_table_privilege('cardapio_homolog_app', 'public.admins', 'SELECT')
     OR has_table_privilege('cardapio_homolog_app', 'public._prisma_migrations', 'SELECT')
     OR NOT has_column_privilege('cardapio_homolog_app', 'public.orders', 'status', 'UPDATE')
     OR NOT has_column_privilege('cardapio_homolog_app', 'public.products', 'availability_state', 'UPDATE')
     OR NOT has_column_privilege('cardapio_homolog_app', 'public.products', 'name', 'INSERT')
     OR NOT has_column_privilege('cardapio_homolog_app', 'public.products', 'id', 'INSERT')
     OR NOT has_column_privilege('cardapio_homolog_app', 'public.products', 'updated_at', 'INSERT')
     OR NOT has_table_privilege('cardapio_homolog_app', 'public.products', 'DELETE')
     OR has_table_privilege('cardapio_homolog_app', 'public.products', 'INSERT')
     OR has_table_privilege('cardapio_homolog_app', 'public.products', 'UPDATE') THEN
    RAISE EXCEPTION 'ACL: o runtime diverge do conjunto minimo aprovado';
  END IF;
  IF has_schema_privilege('cardapio_homolog_app', 'public', 'CREATE')
     OR has_any_column_privilege('cardapio_homolog_app', 'public.products', 'INSERT WITH GRANT OPTION')
     OR has_any_column_privilege('cardapio_homolog_app', 'public.products', 'UPDATE WITH GRANT OPTION')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.products'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                  AND has_column_privilege('cardapio_homolog_app', a.attrelid, a.attnum, 'INSERT')
                  AND a.attname NOT IN ('public_key','source_code','source_name','source_group','name','description','ingredients','price','image_url','image_alt','category_id','is_active','availability_state','id','updated_at'))
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.products'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                  AND has_column_privilege('cardapio_homolog_app', a.attrelid, a.attnum, 'UPDATE')
                  AND a.attname NOT IN ('name','description','ingredients','price','image_url','image_alt','availability_state','updated_at')) THEN
    RAISE EXCEPTION 'ACL: privilegio de coluna excessivo ou GRANT OPTION no runtime';
  END IF;
  IF has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'UPDATE')
     OR has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'DELETE')
     OR has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'TRUNCATE')
     OR has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'SELECT')
     OR has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'INSERT')
     OR has_table_privilege('cardapio_homolog_bootstrap', 'public._prisma_migrations', 'SELECT')
     OR has_schema_privilege('cardapio_homolog_bootstrap', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'ACL: o bootstrap nunca pode alterar ou remover administradores';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('cardapio_homolog_migrator', 'cardapio_homolog_app', 'cardapio_homolog_placeholder', 'cardapio_homolog_bootstrap')
             AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'ACL: atributos elevados em roles do projeto';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cardapio_homolog_placeholder' AND rolcanlogin) THEN
    RAISE EXCEPTION 'ACL: a role placeholder nao pode ter login';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members
             WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('cardapio_homolog_migrator', 'cardapio_homolog_app', 'cardapio_homolog_placeholder', 'cardapio_homolog_bootstrap'))) THEN
    RAISE EXCEPTION 'ACL: memberships inesperadas';
  END IF;
  RAISE NOTICE 'OK: identidade, ACL e schema conforme o esperado';
END
$verify$;
ROLLBACK;
