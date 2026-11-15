-- SOMENTE LEITURA.
-- Execute apenas no banco descartável cardapio_restore_check_AAAAMMDD_HHMMSS.
-- Não contém GRANT, REVOKE, CREATE, ALTER, DROP, INSERT, UPDATE ou DELETE.

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_database() !~ '^cardapio_restore_check_[0-9]{8}_[0-9]{6}$' THEN
    RAISE EXCEPTION 'Banco recusado: %. Execute somente em cardapio_restore_check_*.', current_database();
  END IF;
END
$guard$;

\echo '=== Identidade do destino ==='
SELECT current_database() AS banco, current_user AS usuario, session_user AS sessao,
       inet_server_addr()::text AS servidor, current_setting('server_version_num') AS versao;

\echo '=== Tabelas restauradas ==='
SELECT n.nspname AS schema, c.relname AS tabela, pg_get_userbyid(c.relowner) AS owner,
       c.reltuples::bigint AS estimativa_linhas
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
ORDER BY c.relkind, c.relname;

\echo '=== Colunas e tipos ==='
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

\echo '=== Constraints ==='
SELECT conrelid::regclass AS tabela, conname, contype, convalidated,
       pg_get_constraintdef(oid) AS definicao
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, conname;

\echo '=== _prisma_migrations (esperado: linha inicial do schema histórico) ==='
SELECT migration_name, checksum, finished_at IS NOT NULL AS concluida,
       rolled_back_at IS NOT NULL AS revertida, started_at
FROM public._prisma_migrations
ORDER BY started_at;

SELECT migration_name, checksum,
       checksum = '1a9cd08b9d49fa9f70eabcceaa4a696f5aee07555f6a88562ec789340f0d3983' AS checksum_inicial_esperado
FROM public._prisma_migrations
WHERE migration_name = '20261023000000_initial_schema';

\echo '=== Contagens exatas por tabela ==='
SELECT format('SELECT %L AS tabela, count(*) AS linhas FROM public.%I;', c.relname, c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname
\gexec

\echo '=== Sequências ==='
SELECT schemaname AS schema, sequencename AS sequencia, last_value, increment_by
FROM pg_sequences
WHERE schemaname = 'public'
ORDER BY sequencename;

\echo '=== Objetos inesperados fora de public (informativo) ==='
SELECT n.nspname AS schema, c.relname, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
  AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
ORDER BY 1, 2;
