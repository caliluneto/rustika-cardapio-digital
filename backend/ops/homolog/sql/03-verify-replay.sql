-- NAO EXECUTADO. Somente leitura. Via psql conectado ao banco de REPLAY como cardapio_migrator, depois do replay das migrations.
-- Confirma que as nove migrations do baseline foram aplicadas pelo Prisma (nao marcadas) e que o estado de ACL e o esperado, ANTES de renomear.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $verify$
BEGIN
  IF current_database() <> 'cardapio_digital_test' OR current_user <> 'cardapio_migrator' THEN RAISE EXCEPTION 'ABORT: banco ou role inesperados'; END IF;
  IF (SELECT count(*) FROM public._prisma_migrations) <> 9 OR EXISTS (
    WITH expected(migration_name, checksum) AS (VALUES
      ('20261023000000_initial_schema', '1a9cd08b9d49fa9f70eabcceaa4a696f5aee07555f6a88562ec789340f0d3983'),
      ('20261027000000_rf004_comandas_catalogo_pedidos', '05f583e854a87b77612c2f7d10a0a178ef45ea099d3237808b5bf0bd7c698122'),
      ('20261031000000_rf004_fix_permissions', '960766a8fb1576e6094622f112e1a3a9cd7455f56907a3405a8fbb183959e10b'),
      ('20261102000000_update_products_source_identity_constraint', '885b8de5dcc0cf5e7618d574ba5c013ae8b60c9b983260706c5819422564454f'),
      ('20261104000000_runtime_least_privilege', '24471ed369980bc861d885dc68d9edd3747de73457be620d166eae8b1ec47d6e'),
      ('20261105000000_order_status_update_privilege', '3d6a7a6d0ce3f595501dc6343c19858beb2b9fecd1ebe1fd1fbecf5603031d84'),
      ('20261106000000_product_availability_update_privilege', '3665ed812c4033527d17c6de3a7c66a623d659d676c719fc1b6f6477f7e69308'),
      ('20261110000000_rf006_product_crud_privilege', 'b3feb0dfca618498219161ec91f11b4edff9700de5386e452edf67eadf41561e'),
      ('20261114000000_product_insert_identity_columns', '6a533537645a8b2f3c14af2c863697cbe9bfdec034319971b50020fe134318c9')
    )
    SELECT 1
      FROM expected e
      FULL OUTER JOIN public._prisma_migrations m USING (migration_name)
     WHERE e.migration_name IS NULL OR m.migration_name IS NULL OR m.checksum <> e.checksum
        OR m.finished_at IS NULL OR m.rolled_back_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'REPLAY: o historico deve conter exatamente as nove migrations, concluidas, sem reversao e com checksums aprovados';
  END IF;
  IF NOT has_table_privilege('cardapio_test_app', 'public.admins', 'SELECT')
     OR has_table_privilege('cardapio_test_app', 'public.admins', 'INSERT')
     OR NOT has_column_privilege('cardapio_test_app', 'public.orders', 'status', 'UPDATE')
     OR NOT has_column_privilege('cardapio_test_app', 'public.products', 'availability_state', 'UPDATE')
     OR NOT has_column_privilege('cardapio_test_app', 'public.products', 'name', 'INSERT')
     OR NOT has_column_privilege('cardapio_test_app', 'public.products', 'id', 'INSERT')
     OR NOT has_column_privilege('cardapio_test_app', 'public.products', 'updated_at', 'INSERT')
     OR NOT has_table_privilege('cardapio_test_app', 'public.products', 'DELETE')
     OR has_table_privilege('cardapio_test_app', 'public.products', 'INSERT')
     OR has_table_privilege('cardapio_test_app', 'public.products', 'UPDATE')
     OR has_table_privilege('cardapio_test_app', 'public._prisma_migrations', 'SELECT') THEN
    RAISE EXCEPTION 'REPLAY: ACL do runtime diferente da esperada';
  END IF;
  IF (SELECT count(*) FROM public.admins) <> 0 THEN RAISE EXCEPTION 'REPLAY: o banco deveria estar vazio'; END IF;
  -- Ownership e ausencia de objetos que embutam nomes de roles/banco (a renomeacao NAO reescreve SQL armazenado).
  IF (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) <> 'cardapio_migrator' THEN
    RAISE EXCEPTION 'OWNER: o dono do banco deve ser cardapio_migrator';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'i', 'f') AND pg_get_userbyid(c.relowner) <> 'cardapio_migrator') THEN
    RAISE EXCEPTION 'OWNER: toda tabela, sequencia, indice e view em public deve pertencer a cardapio_migrator';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public' AND pg_get_userbyid(nspowner) NOT IN ('cardapio_migrator', 'pg_database_owner')) THEN
    RAISE EXCEPTION 'OWNER: o schema public tem dono inesperado';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
              WHERE n.nspname = 'public' AND t.typtype IN ('e', 'c', 'd', 'r') AND t.typrelid = 0 AND pg_get_userbyid(t.typowner) <> 'cardapio_migrator') THEN
    RAISE EXCEPTION 'OWNER: tipo (enum/dominio) em public com dono inesperado';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public')
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm'))
     OR EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal)
     OR EXISTS (SELECT 1 FROM pg_policy)
     OR EXISTS (SELECT 1 FROM pg_event_trigger) THEN
    RAISE EXCEPTION 'NOMES: existem funcoes, views, triggers, politicas ou event triggers; revise se embutem nomes de roles antes de renomear';
  END IF;
  -- PostgreSQL >= 16 concede automaticamente ao criador da role uma membership ADMIN-only,
  -- registrada com grantor = superusuario de bootstrap (cloud_admin no Neon). Ela nao concede
  -- SET ROLE nem heranca e nao pode ser revogada por quem tem apenas CREATEROLE; e a unica
  -- membership externa tolerada. Qualquer SET/INHERIT ou role do projeto como membro bloqueia.
  IF EXISTS (
    SELECT 1
      FROM pg_auth_members m
      JOIN pg_roles granted_role ON granted_role.oid = m.roleid
      JOIN pg_roles member_role ON member_role.oid = m.member
      JOIN pg_roles grantor_role ON grantor_role.oid = m.grantor
     WHERE (granted_role.rolname LIKE 'cardapio\_%' OR member_role.rolname LIKE 'cardapio\_%')
       AND NOT (
         member_role.rolname NOT LIKE 'cardapio\_%'
         AND grantor_role.rolsuper
         AND m.admin_option
         AND NOT m.set_option
         AND NOT m.inherit_option
       )
  ) THEN
    RAISE EXCEPTION 'ROLES: memberships inesperadas entre roles do projeto';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database()) OR setrole IN (SELECT oid FROM pg_roles WHERE rolname LIKE 'cardapio\_%')) THEN
    RAISE EXCEPTION 'CONFIG: ha configuracoes por banco ou por role (search_path etc.); revise antes de renomear';
  END IF;
  IF (SELECT count(*) FROM pg_namespace WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema') <> 1 THEN
    RAISE EXCEPTION 'SCHEMA: somente o schema public e esperado';
  END IF;
  RAISE NOTICE 'OK: replay conforme o esperado';
END
$verify$;
ROLLBACK;
