-- 3D.3.10 — PREPARADO, NÃO EXECUTADO.
-- Revoga os privilégios conhecidos e remove cardapio_test_fixtures.
-- Exige autorização específica e role administrativa local com SUPERUSER.
-- Falha de forma explícita se a role possuir objetos; não use DROP OWNED BY sem revisão.

\set ON_ERROR_STOP on
\echo 'Removendo cardapio_test_fixtures (revogação + DROP ROLE)...'

BEGIN;
SET LOCAL search_path = pg_catalog;

DO $guard$
BEGIN
  IF current_database() <> 'cardapio_digital_test' THEN
    RAISE EXCEPTION 'Banco recusado: %. Execute somente em cardapio_digital_test.', current_database();
  END IF;
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'Identidade disfarçada por SET ROLE não é aceita.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'O rollback exige uma role administrativa local com SUPERUSER.';
  END IF;
  IF inet_server_addr() IS NOT NULL AND inet_server_addr() NOT IN ('127.0.0.1', '::1') THEN
    RAISE EXCEPTION 'Servidor remoto recusado: %.', inet_server_addr();
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN
    RAISE EXCEPTION 'PostgreSQL % < 170000.', current_setting('server_version_num');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cardapio_test_fixtures') THEN
    RAISE EXCEPTION 'cardapio_test_fixtures não existe; nada a remover.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_shdepend
             WHERE refclassid = 'pg_authid'::regclass
               AND refobjid = (SELECT oid FROM pg_roles WHERE rolname = 'cardapio_test_fixtures')
               AND deptype = 'o') THEN
    RAISE EXCEPTION 'A role possui objetos; revise ownership antes de removê-la.';
  END IF;
END
$guard$;

REVOKE ALL ON DATABASE cardapio_digital_test FROM cardapio_test_fixtures;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM cardapio_test_fixtures;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM cardapio_test_fixtures;
REVOKE ALL ON SCHEMA public FROM cardapio_test_fixtures;

DO $revoke_other_databases$
DECLARE
  db text;
BEGIN
  -- Qualquer concessão explícita residual em outro banco (não só Dev/Shadow).
  FOR db IN SELECT DISTINCT d.datname FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
            WHERE a.grantee = 'cardapio_test_fixtures'::regrole AND d.datname <> 'cardapio_digital_test' LOOP
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM cardapio_test_fixtures', db);
  END LOOP;
END
$revoke_other_databases$;
-- Depois do DROP ROLE: remover as 5 linhas da role no pg_hba.conf e SELECT pg_reload_conf();

DROP ROLE cardapio_test_fixtures;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cardapio_test_fixtures') THEN
    RAISE EXCEPTION 'A role ainda existe após DROP ROLE.';
  END IF;
END
$verify$;

COMMIT;
\echo 'Role removida. O arquivo fixtures-test.env deve ser apagado manualmente fora do repositório.'
