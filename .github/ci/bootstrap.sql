-- 3D.3.25-A — bootstrap do PostgreSQL EFÊMERO do CI. NUNCA usar fora do runner descartável.
-- Executado como superusuário do container pelo socket Unix. Senhas sintéticas chegam por variáveis
-- do psql (-v), geradas na execução e mascaradas no log. Reproduz os nomes exatos exigidos pelos gates:
-- roles cardapio_migrator / cardapio_test_app / cardapio_dev_app (dependência da migration
-- 20261104000000) e bancos cardapio_digital_test (dono: migrator) e cardapio_digital_shadow.
-- A role de fixtures é criada depois, por backend/docs/sql/provision-test-fixtures.sql (inalterado).
\set ON_ERROR_STOP on

CREATE ROLE cardapio_migrator LOGIN PASSWORD :'mig_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE cardapio_test_app LOGIN PASSWORD :'app_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- A migration least_privilege exige as duas roles de runtime; a de Dev fica sem login e sem banco.
CREATE ROLE cardapio_dev_app NOLOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE DATABASE cardapio_digital_test   OWNER cardapio_migrator;
CREATE DATABASE cardapio_digital_shadow OWNER cardapio_migrator;
