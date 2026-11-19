-- 3D.5.2-A - NAO EXECUTADO. Via psql, como administrador do cluster de HOMOLOGACAO (instancia dedicada, remota, TLS).
-- Prepara o cluster para o REPLAY das migrations historicas (imutaveis): roles legadas exigidas pelas guardas SQL, a role final do
-- bootstrap e a MARCA de identidade do cluster. Recusa se o cluster nao estiver limpo. Nao define senhas: use \password (interativo).
\set ON_ERROR_STOP on
\echo 'Homologacao: preparando roles e marca do cluster. Confirme que este e o cluster DEDICADO de homologacao.'
DO $roles$
BEGIN
  IF current_setting('server_version_num')::int < 170000 THEN
    RAISE EXCEPTION 'ABORT: PostgreSQL 17 ou superior e exigido pelas migrations';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname IN ('cardapio_digital_dev', 'cardapio_digital_shadow', 'cardapio_digital_test', 'cardapio_digital_homolog')) THEN
    RAISE EXCEPTION 'ABORT: o cluster ja contem bancos cardapio_digital_*; use um cluster dedicado e vazio';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('cardapio_migrator', 'cardapio_test_app', 'cardapio_dev_app', 'cardapio_homolog_migrator',
             'cardapio_homolog_app', 'cardapio_homolog_placeholder', 'cardapio_homolog_bootstrap', 'rustika_homolog_marker')) THEN
    RAISE EXCEPTION 'ABORT: uma ou mais roles do projeto ja existem; nada foi alterado';
  END IF;
END
$roles$;
-- Roles LEGADAS: nomes fixados pelas guardas das migrations historicas. Existem apenas durante o replay e sao renomeadas em 04.
CREATE ROLE cardapio_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 5;
CREATE ROLE cardapio_test_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 20;
CREATE ROLE cardapio_dev_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
-- Role FINAL do bootstrap: nasce sem login; o login so e aberto na janela (06) e fechado (07).
CREATE ROLE cardapio_homolog_bootstrap NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 2;
-- MARCA do cluster: o UUID abaixo deve ser copiado para EXPECTED_CLUSTER_ID nos arquivos de segredo locais.
CREATE ROLE rustika_homolog_marker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
SELECT 'rustika-homolog-cluster:' || gen_random_uuid()::text AS marker \gset
COMMENT ON ROLE rustika_homolog_marker IS :'marker';
\echo 'MARCA DO CLUSTER (copie o UUID para EXPECTED_CLUSTER_ID):' :marker
\echo 'Defina as senhas de forma interativa: \password cardapio_migrator ; \password cardapio_test_app ; \password cardapio_homolog_bootstrap'
