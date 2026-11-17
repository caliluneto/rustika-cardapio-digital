-- NAO EXECUTADO. Via psql no banco DEFINITIVO cardapio_digital_homolog COMO cardapio_homolog_migrator, depois de 04.
-- Concede ao bootstrap somente o minimo e confere a identidade.
\set ON_ERROR_STOP on
BEGIN;
\ir contracts/expected-migrations.sql
DO $grants$
BEGIN
  IF current_database() <> 'cardapio_digital_homolog' OR current_user <> 'cardapio_homolog_migrator' OR session_user <> 'cardapio_homolog_migrator' THEN
    RAISE EXCEPTION 'ABORT: banco ou role inesperados';
  END IF;
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
    RAISE EXCEPTION 'ABORT: historico nao corresponde exatamente as nove migrations aprovadas';
  END IF;
  IF (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) <> 'cardapio_homolog_migrator'
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S','v','m','i','f')
                   AND pg_get_userbyid(c.relowner) <> 'cardapio_homolog_migrator') THEN
    RAISE EXCEPTION 'ABORT: ownership do banco ou de objetos public diverge';
  END IF;
  IF NOT has_column_privilege('cardapio_homolog_app', 'public.products', 'id', 'INSERT')
     OR NOT has_column_privilege('cardapio_homolog_app', 'public.products', 'updated_at', 'INSERT')
     OR has_table_privilege('cardapio_homolog_app', 'public.products', 'INSERT')
     OR has_table_privilege('cardapio_homolog_app', 'public.products', 'UPDATE')
     OR has_schema_privilege('cardapio_homolog_app', 'public', 'CREATE')
     OR has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'SELECT')
     OR has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'INSERT')
     OR has_schema_privilege('cardapio_homolog_bootstrap', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'ABORT: ACL anterior aos grants do bootstrap diverge';
  END IF;
  IF (SELECT count(*) FROM public.admins) <> 0 THEN
    RAISE EXCEPTION 'ABORT: ja existe administrador; o bootstrap nao se aplica';
  END IF;
  EXECUTE 'GRANT USAGE ON SCHEMA public TO cardapio_homolog_bootstrap';
  EXECUTE 'GRANT SELECT ON TABLE public._prisma_migrations TO cardapio_homolog_bootstrap';
  EXECUTE 'GRANT SELECT, INSERT ON TABLE public.admins TO cardapio_homolog_bootstrap';
  IF has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'UPDATE')
     OR has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'DELETE')
     OR has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'TRUNCATE')
     OR has_table_privilege('cardapio_homolog_app', 'public.admins', 'INSERT')
     OR NOT has_schema_privilege('cardapio_homolog_bootstrap', 'public', 'USAGE')
     OR has_schema_privilege('cardapio_homolog_bootstrap', 'public', 'CREATE')
     OR NOT has_table_privilege('cardapio_homolog_bootstrap', 'public._prisma_migrations', 'SELECT')
     OR NOT has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'SELECT')
     OR NOT has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'INSERT')
     OR has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'SELECT WITH GRANT OPTION')
     OR has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'INSERT WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'ABORT: ACL inesperada em admins';
  END IF;
END
$grants$;
COMMIT;
