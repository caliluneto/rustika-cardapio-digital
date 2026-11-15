-- PREPARADO, NÃO EXECUTADO.
-- Cria a role de fixtures somente em cardapio_digital_test, sem senha (NOLOGIN).
-- Exige autorização específica e uma role administrativa local com atributo SUPERUSER.
-- A senha é definida depois, de forma interativa, por enable-test-fixtures-login.sql.
-- Não use este arquivo em Dev, Shadow, produção ou cluster remoto.

\set ON_ERROR_STOP on
\echo 'Provisionando cardapio_test_fixtures em cardapio_digital_test (NOLOGIN, sem senha)...'

BEGIN;
SET LOCAL search_path = pg_catalog;

DO $guard$
DECLARE
  db_owner text;
  object_name text;
BEGIN
  IF current_database() <> 'cardapio_digital_test' THEN
    RAISE EXCEPTION 'Banco recusado: %. Execute somente em cardapio_digital_test.', current_database();
  END IF;
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'Identidade disfarçada por SET ROLE não é aceita.';
  END IF;
  IF current_user IN ('cardapio_test_app', 'cardapio_dev_app', 'cardapio_test_fixtures') THEN
    RAISE EXCEPTION 'Role de runtime/fixtures não pode provisionar a si mesma.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'A provisão exige uma role administrativa local com SUPERUSER.';
  END IF;
  IF inet_server_addr() IS NOT NULL AND inet_server_addr() NOT IN ('127.0.0.1', '::1') THEN
    RAISE EXCEPTION 'Servidor remoto recusado: %.', inet_server_addr();
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN
    RAISE EXCEPTION 'PostgreSQL % < 170000.', current_setting('server_version_num');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cardapio_test_fixtures') THEN
    RAISE EXCEPTION 'cardapio_test_fixtures já existe. Use verify-test-fixtures.sql; para recriar, use rollback-test-fixtures.sql com autorização.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cardapio_test_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cardapio_migrator') THEN
    RAISE EXCEPTION 'Roles cardapio_test_app e cardapio_migrator são dependências obrigatórias.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles
             WHERE rolname IN ('cardapio_test_app', 'cardapio_migrator')
               AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Role de runtime/migrator com atributos administrativos não é aceita.';
  END IF;
  SELECT pg_get_userbyid(datdba) INTO db_owner
  FROM pg_database WHERE datname = current_database();
  IF db_owner <> 'cardapio_migrator' THEN
    RAISE EXCEPTION 'Dono inesperado do banco: %. Esperado cardapio_migrator.', db_owner;
  END IF;
  IF to_regclass('public._prisma_migrations') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                    WHERE migration_name = '20261104000000_runtime_least_privilege'
                      AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'A migration 20261104000000_runtime_least_privilege precisa estar aplicada e concluída.';
  END IF;

  FOREACH object_name IN ARRAY ARRAY[
    'admins', 'categories', 'products', 'comandas', 'comanda_invitations',
    'comanda_sessions', 'orders', 'order_items', 'order_status_history',
    '_prisma_migrations', 'orders_order_number_seq'
  ] LOOP
    IF to_regclass(format('public.%I', object_name)) IS NULL THEN
      RAISE EXCEPTION 'Dependência ausente: %', object_name;
    END IF;
    IF (SELECT pg_get_userbyid(relowner) FROM pg_class
        WHERE oid = to_regclass(format('public.%I', object_name))) <> 'cardapio_migrator' THEN
      RAISE EXCEPTION 'Objeto % não pertence a cardapio_migrator.', object_name;
    END IF;
  END LOOP;
END
$guard$;

CREATE ROLE cardapio_test_fixtures
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS
  NOREPLICATION
  CONNECTION LIMIT 2;

REVOKE ALL ON DATABASE cardapio_digital_test FROM cardapio_test_fixtures;
GRANT CONNECT ON DATABASE cardapio_digital_test TO cardapio_test_fixtures;
REVOKE ALL ON SCHEMA public FROM cardapio_test_fixtures;
GRANT USAGE ON SCHEMA public TO cardapio_test_fixtures;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM cardapio_test_fixtures;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM cardapio_test_fixtures;
REVOKE ALL ON TABLE public._prisma_migrations FROM cardapio_test_fixtures;

-- Matriz mínima, derivada do uso real de tests/integration-db/support/fixtures.ts.
GRANT SELECT, INSERT, DELETE ON TABLE public.admins, public.categories
  TO cardapio_test_fixtures;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.products, public.comandas
  TO cardapio_test_fixtures;
GRANT SELECT, INSERT, DELETE ON TABLE public.comanda_invitations, public.comanda_sessions
  TO cardapio_test_fixtures;
GRANT SELECT, DELETE ON TABLE public.orders, public.order_items, public.order_status_history
  TO cardapio_test_fixtures;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'cardapio_test_fixtures'
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolinherit AND NOT rolbypassrls AND NOT rolreplication
      AND NOT rolcanlogin AND rolconnlimit = 2
  ) THEN
    RAISE EXCEPTION 'Atributos da role de fixtures divergem do esperado.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members
             WHERE member = 'cardapio_test_fixtures'::regrole) THEN
    RAISE EXCEPTION 'Role de fixtures não pode ter memberships.';
  END IF;
  IF has_schema_privilege('cardapio_test_fixtures', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Role de fixtures não pode criar objetos no schema public.';
  END IF;
  IF has_table_privilege('cardapio_test_fixtures', 'public._prisma_migrations', 'SELECT') THEN
    RAISE EXCEPTION 'Role de fixtures não pode ler _prisma_migrations.';
  END IF;
  IF has_sequence_privilege('cardapio_test_fixtures', 'public.orders_order_number_seq', 'USAGE')
     OR has_sequence_privilege('cardapio_test_fixtures', 'public.orders_order_number_seq', 'SELECT')
     OR has_sequence_privilege('cardapio_test_fixtures', 'public.orders_order_number_seq', 'UPDATE') THEN
    RAISE EXCEPTION 'Role de fixtures não pode usar a sequência de pedidos.';
  END IF;
  IF has_database_privilege('cardapio_test_fixtures', 'cardapio_digital_test', 'CREATE')
     OR has_database_privilege('cardapio_test_fixtures', 'cardapio_digital_test', 'TEMP') THEN
    RAISE EXCEPTION 'Role de fixtures não pode criar objetos nem usar TEMP no banco Test.';
  END IF;

  -- Nenhuma concessão EXPLÍCITA à role fora de Test. CONNECT herdado de PUBLIC não é
  -- concessão da role e não pode ser retirado dela; enquanto a role é NOLOGIN ele é inócuo.
  -- O isolamento de conexão é exigido no passo de LOGIN (enable-test-fixtures-login.sql),
  -- via pg_hba.conf (ver pg_hba-test-fixtures.conf.example).
  IF EXISTS (SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
             WHERE d.datname <> 'cardapio_digital_test'
               AND a.grantee = 'cardapio_test_fixtures'::regrole) THEN
    RAISE EXCEPTION 'cardapio_test_fixtures tem concessão explícita fora de cardapio_digital_test.';
  END IF;
END
$verify$;

-- Informativo: bancos em que a role HERDARIA CONNECT via PUBLIC se tivesse LOGIN.
SELECT datname AS banco_conectavel_via_public
FROM pg_database
WHERE datallowconn AND datname <> 'cardapio_digital_test'
  AND has_database_privilege('cardapio_test_fixtures', datname, 'CONNECT')
ORDER BY 1;

COMMIT;
\echo 'Role criada como NOLOGIN, sem senha e com a matriz mínima. Próximo passo: enable-test-fixtures-login.sql.'
