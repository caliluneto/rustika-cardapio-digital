-- PREPARADO, NÃO EXECUTADO.
-- Habilita LOGIN depois que a senha foi definida manualmente com \password.
-- A senha NÃO fica neste arquivo, em variável, em argumento ou em histórico.
-- Em um psql interativo, execute primeiro: \password cardapio_test_fixtures
-- Depois execute este arquivo com \i docs/sql/enable-test-fixtures-login.sql.
-- Não use psql -f para o passo da senha: \password deve ler do terminal.

\set ON_ERROR_STOP on
\echo 'Habilitando LOGIN de cardapio_test_fixtures (senha já definida manualmente)...'

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
    RAISE EXCEPTION 'A habilitação exige uma role administrativa local com SUPERUSER.';
  END IF;
  IF inet_server_addr() IS NOT NULL AND inet_server_addr() NOT IN ('127.0.0.1', '::1') THEN
    RAISE EXCEPTION 'Servidor remoto recusado: %.', inet_server_addr();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles
                 WHERE rolname = 'cardapio_test_fixtures' AND NOT rolcanlogin) THEN
    RAISE EXCEPTION 'Role ausente ou já habilitada; revise com verify-test-fixtures.sql.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members
             WHERE member = 'cardapio_test_fixtures'::regrole) THEN
    RAISE EXCEPTION 'Role de fixtures não pode ter memberships.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
             WHERE d.datname <> 'cardapio_digital_test'
               AND a.grantee = 'cardapio_test_fixtures'::regrole) THEN
    RAISE EXCEPTION 'Concessão explícita à role fora de cardapio_digital_test.';
  END IF;
END
$guard$;

-- Isolamento de conexão por pg_hba.conf (primeira regra que casa vence).
-- CONNECT herdado de PUBLIC (postgres, template1, bancos de outros projetos) não pode ser
-- retirado só desta role; por isso o LOGIN só é habilitado se o pg_hba recusar a role em
-- todo banco que não seja cardapio_digital_test. Ver pg_hba-test-fixtures.conf.example.
DO $hba$
DECLARE
  role_name constant text := 'cardapio_test_fixtures';
  bad text;
  last_reject int;
  first_generic int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_hba_file_rules WHERE error IS NOT NULL) THEN
    RAISE EXCEPTION 'pg_hba.conf tem linhas com erro; corrija antes de habilitar LOGIN.';
  END IF;
  IF (pg_stat_file(current_setting('hba_file'))).modification > pg_conf_load_time() THEN
    RAISE EXCEPTION 'pg_hba.conf foi alterado depois do último reload; execute SELECT pg_reload_conf() e repita.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_hba_file_rules r CROSS JOIN LATERAL unnest(r.user_name) u
             WHERE u LIKE '+%' OR u LIKE '/%') THEN
    RAISE EXCEPTION 'pg_hba.conf usa grupo (+) ou regex (/) em USER; a verificação automática não é conclusiva.';
  END IF;
  -- Regras de permissão da role: somente Test, somente SCRAM, somente loopback TCP.
  SELECT string_agg(line_number::text, ',') INTO bad FROM pg_hba_file_rules
  WHERE role_name = ANY(user_name) AND auth_method <> 'reject'
    AND (database <> ARRAY['cardapio_digital_test'] OR auth_method <> 'scram-sha-256'
         OR type NOT IN ('host', 'hostssl') OR coalesce(address, '') NOT IN ('127.0.0.1', '::1'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Regra de pg_hba fora do padrão para a role (linha %).', bad;
  END IF;
  -- Recusas obrigatórias para "all": socket local, IPv4 e IPv6 de loopback.
  IF NOT EXISTS (SELECT 1 FROM pg_hba_file_rules WHERE user_name = ARRAY[role_name] AND database = ARRAY['all']
                 AND auth_method = 'reject' AND type = 'local')
     OR NOT EXISTS (SELECT 1 FROM pg_hba_file_rules WHERE user_name = ARRAY[role_name] AND database = ARRAY['all']
                    AND auth_method = 'reject' AND type = 'host' AND address IN ('127.0.0.1', 'all'))
     OR NOT EXISTS (SELECT 1 FROM pg_hba_file_rules WHERE user_name = ARRAY[role_name] AND database = ARRAY['all']
                    AND auth_method = 'reject' AND type = 'host' AND address IN ('::1', 'all')) THEN
    RAISE EXCEPTION 'Faltam as regras reject da role para "all" (local, 127.0.0.1/32, ::1/128).';
  END IF;
  SELECT max(rule_number) INTO last_reject FROM pg_hba_file_rules
  WHERE user_name = ARRAY[role_name] AND database = ARRAY['all'] AND auth_method = 'reject';
  SELECT min(rule_number) INTO first_generic FROM pg_hba_file_rules
  WHERE 'all' = ANY(user_name);
  IF first_generic IS NOT NULL AND first_generic < last_reject THEN
    RAISE EXCEPTION 'Há regra com USER all antes das recusas da role (regra %); mova as linhas da role para o topo.', first_generic;
  END IF;
END
$hba$;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_authid
                 WHERE rolname = 'cardapio_test_fixtures' AND rolpassword IS NOT NULL) THEN
    RAISE EXCEPTION 'Senha não definida; execute \password cardapio_test_fixtures no psql interativo antes deste arquivo.';
  END IF;
END
$verify$;

ALTER ROLE cardapio_test_fixtures LOGIN;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles
                 WHERE rolname = 'cardapio_test_fixtures' AND rolcanlogin
                   AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
                   AND NOT rolinherit AND NOT rolbypassrls AND NOT rolreplication
                   AND rolconnlimit = 2) THEN
    RAISE EXCEPTION 'Estado final da role de fixtures divergente.';
  END IF;
END
$verify$;

COMMIT;
\echo 'LOGIN habilitado. Crie fixtures-test.env fora do repositório e rode verify-test-fixtures.sql.'
