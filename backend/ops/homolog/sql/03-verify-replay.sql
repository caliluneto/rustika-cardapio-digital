-- NAO EXECUTADO. Somente leitura. Via psql conectado ao banco de REPLAY como cardapio_migrator, depois do replay das migrations.
-- Confirma que as sete migrations historicas foram aplicadas pelo Prisma (nao marcadas) e que o estado de ACL e o esperado, ANTES de renomear.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $verify$
BEGIN
  IF current_database() <> 'cardapio_digital_test' OR current_user <> 'cardapio_migrator' THEN RAISE EXCEPTION 'ABORT: banco ou role inesperados'; END IF;
  IF (SELECT count(*) FROM public._prisma_migrations) < 7
     OR (SELECT count(*) FROM public._prisma_migrations) <> (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'REPLAY: as migrations (ao menos as sete historicas) precisam estar aplicadas, concluidas e sem reversao';
  END IF;
  IF NOT has_table_privilege('cardapio_test_app', 'public.admins', 'SELECT')
     OR has_table_privilege('cardapio_test_app', 'public.admins', 'INSERT')
     OR NOT has_column_privilege('cardapio_test_app', 'public.orders', 'status', 'UPDATE')
     OR NOT has_column_privilege('cardapio_test_app', 'public.products', 'availability_state', 'UPDATE')
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
