-- E5.5: identidade e histórico verificados NA MESMA transação/sessão dos GRANTs.
-- Variante somente de homologação; a 10ª migration Dev/Test e as nove anteriores não mudam.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $security$
BEGIN
  IF current_database() <> 'cardapio_digital_homolog'
     OR (SELECT oid::text FROM pg_database WHERE datname = current_database()) IS DISTINCT FROM '57355'
     OR current_user <> 'cardapio_homolog_migrator'
     OR session_user <> 'cardapio_homolog_migrator'
     OR current_setting('neon.project_id', true) IS DISTINCT FROM 'aged-scene-47291697'
     OR current_setting('neon.branch_id', true) IS DISTINCT FROM 'br-frosty-fire-bd4xw2sc'
     OR (SELECT shobj_description(oid, 'pg_authid') FROM pg_roles
           WHERE rolname = 'rustika_homolog_marker') IS DISTINCT FROM
        'rustika-homolog-cluster:81c4dfc1-1f0d-4e34-b31c-865e769f553e'
     OR current_setting('server_version_num')::int < 180000
     OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) <> current_user
     OR (SELECT count(*) FROM pg_roles WHERE rolname IN
         ('cardapio_homolog_migrator', 'cardapio_homolog_app', 'cardapio_homolog_placeholder')) <> 3
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN
         ('cardapio_homolog_migrator', 'cardapio_homolog_app', 'cardapio_homolog_placeholder')
         AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
      OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member IN
         (SELECT oid FROM pg_roles WHERE rolname IN
            ('cardapio_homolog_migrator', 'cardapio_homolog_app', 'cardapio_homolog_placeholder')))
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN
          ('cardapio_migrator', 'cardapio_dev_app', 'cardapio_test_app')) THEN
    RAISE EXCEPTION 'Unexpected homologation database, owner or unsafe roles';
  END IF;
  -- O Prisma pode inserir a linha da migration corrente antes de executar o SQL. Aceitar somente
  -- zero ou UMA linha corrente sem resultado/log; uma linha anterior falha/duplicada aborta.
  IF (SELECT count(*) FROM public._prisma_migrations
        WHERE migration_name = '20261119000000_category_crud_privilege') > 1
     OR EXISTS (SELECT 1 FROM public._prisma_migrations
          WHERE migration_name = '20261119000000_category_crud_privilege'
            AND (finished_at IS NOT NULL OR rolled_back_at IS NOT NULL OR
                 COALESCE(btrim(logs), '') <> ''))
     OR EXISTS (
       WITH expected(ord, name, digest) AS (VALUES
         (1, '20261023000000_initial_schema', '1a9cd08b9d49fa9f70eabcceaa4a696f5aee07555f6a88562ec789340f0d3983'),
         (2, '20261027000000_rf004_comandas_catalogo_pedidos', '05f583e854a87b77612c2f7d10a0a178ef45ea099d3237808b5bf0bd7c698122'),
         (3, '20261031000000_rf004_fix_permissions', '960766a8fb1576e6094622f112e1a3a9cd7455f56907a3405a8fbb183959e10b'),
         (4, '20261102000000_update_products_source_identity_constraint', '885b8de5dcc0cf5e7618d574ba5c013ae8b60c9b983260706c5819422564454f'),
         (5, '20261104000000_runtime_least_privilege', '24471ed369980bc861d885dc68d9edd3747de73457be620d166eae8b1ec47d6e'),
         (6, '20261105000000_order_status_update_privilege', '3d6a7a6d0ce3f595501dc6343c19858beb2b9fecd1ebe1fd1fbecf5603031d84'),
         (7, '20261106000000_product_availability_update_privilege', '3665ed812c4033527d17c6de3a7c66a623d659d676c719fc1b6f6477f7e69308'),
         (8, '20261110000000_rf006_product_crud_privilege', 'b3feb0dfca618498219161ec91f11b4edff9700de5386e452edf67eadf41561e'),
         (9, '20261114000000_product_insert_identity_columns', '6a533537645a8b2f3c14af2c863697cbe9bfdec034319971b50020fe134318c9')
       ), actual AS (
         SELECT row_number() OVER (ORDER BY started_at, migration_name) AS ord,
                migration_name AS name, checksum AS digest,
                finished_at, rolled_back_at, logs
           FROM public._prisma_migrations
          WHERE migration_name <> '20261119000000_category_crud_privilege'
       )
       SELECT 1 FROM expected e FULL JOIN actual a ON e.ord = a.ord
        WHERE e.name IS DISTINCT FROM a.name OR e.digest IS DISTINCT FROM a.digest
           OR a.finished_at IS NULL OR a.rolled_back_at IS NOT NULL
           OR COALESCE(btrim(a.logs), '') <> ''
     ) THEN
    RAISE EXCEPTION 'Historical migration chain is not exactly 9/9';
  END IF;
  IF to_regclass('public.categories') IS NULL
     OR NOT has_table_privilege('cardapio_homolog_app', 'public.categories', 'SELECT')
     OR has_table_privilege('cardapio_homolog_app', 'public.categories', 'INSERT')
     OR has_table_privilege('cardapio_homolog_app', 'public.categories', 'UPDATE')
     OR has_table_privilege('cardapio_homolog_app', 'public.categories', 'DELETE')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.categories'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped AND
          (has_column_privilege('cardapio_homolog_app', a.attrelid, a.attnum, 'INSERT') OR
           has_column_privilege('cardapio_homolog_app', a.attrelid, a.attnum, 'UPDATE')))
     OR has_table_privilege('cardapio_homolog_app', 'public.admins', 'INSERT')
     OR has_table_privilege('cardapio_homolog_app', 'public.admins', 'UPDATE')
     OR has_table_privilege('cardapio_homolog_app', 'public.admins', 'DELETE')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.admins'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped AND
          (has_column_privilege('cardapio_homolog_app', a.attrelid, a.attnum, 'INSERT') OR
           has_column_privilege('cardapio_homolog_app', a.attrelid, a.attnum, 'UPDATE'))) THEN
    RAISE EXCEPTION 'Unexpected prior category ACL';
  END IF;

  GRANT INSERT (id, public_key, name, description, display_order, is_active, updated_at)
    ON TABLE public.categories TO cardapio_homolog_app;
  GRANT UPDATE (name, description, display_order, updated_at)
    ON TABLE public.categories TO cardapio_homolog_app;

  IF NOT has_column_privilege('cardapio_homolog_app', 'public.categories', 'id', 'INSERT')
     OR NOT has_column_privilege('cardapio_homolog_app', 'public.categories', 'name', 'INSERT')
     OR NOT has_column_privilege('cardapio_homolog_app', 'public.categories', 'description', 'UPDATE')
     OR NOT has_column_privilege('cardapio_homolog_app', 'public.categories', 'display_order', 'UPDATE')
     OR has_column_privilege('cardapio_homolog_app', 'public.categories', 'public_key', 'UPDATE')
     OR has_column_privilege('cardapio_homolog_app', 'public.categories', 'is_active', 'UPDATE')
     OR has_table_privilege('cardapio_homolog_app', 'public.categories', 'INSERT')
     OR has_table_privilege('cardapio_homolog_app', 'public.categories', 'UPDATE')
     OR has_table_privilege('cardapio_homolog_app', 'public.categories', 'DELETE')
     OR has_column_privilege('cardapio_homolog_app', 'public.categories', 'name', 'INSERT WITH GRANT OPTION')
     OR has_column_privilege('cardapio_homolog_placeholder', 'public.categories', 'name', 'INSERT')
     OR has_table_privilege('cardapio_homolog_app', 'public.admins', 'INSERT')
     OR has_table_privilege('cardapio_homolog_app', 'public.admins', 'UPDATE')
     OR has_table_privilege('cardapio_homolog_app', 'public.admins', 'DELETE')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.admins'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped AND
          (has_column_privilege('cardapio_homolog_app', a.attrelid, a.attnum, 'INSERT') OR
           has_column_privilege('cardapio_homolog_app', a.attrelid, a.attnum, 'UPDATE'))) THEN
    RAISE EXCEPTION 'Category grants postcondition failed';
  END IF;
END
$security$;
COMMIT;
