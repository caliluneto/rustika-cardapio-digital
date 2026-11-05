-- 3D.3.10 — SOMENTE LEITURA.
-- Execute conectado a cardapio_digital_test como role administrativa local.
-- Não contém GRANT, REVOKE, CREATE, ALTER ou DROP.
-- A prova de segurança só existe após executar este arquivo no banco realmente migrado.

\set ON_ERROR_STOP on
\echo '=== Identidade ==='
SELECT current_database() AS banco, current_user AS usuario, session_user AS sessao,
       inet_server_addr()::text AS servidor, current_setting('server_version_num') AS versao;

\echo '=== Atributos e memberships de cardapio_test_fixtures ==='
SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
       r.rolinherit, r.rolbypassrls, r.rolreplication, r.rolconnlimit
FROM pg_roles r
WHERE r.rolname = 'cardapio_test_fixtures';

SELECT m.roleid::regrole AS role_concedida, m.member::regrole AS membro,
       m.admin_option, m.inherit_option, m.set_option
FROM pg_auth_members m
WHERE m.member = 'cardapio_test_fixtures'::regrole;

\echo '=== CONNECT/CREATE/TEMP por banco ==='
\echo '    explicita = concessão à própria role (deve existir só em Test);'
\echo '    via_public = herdado de PUBLIC (aceito só se o pg_hba recusar a role nesse banco).'
SELECT d.datname,
       has_database_privilege('cardapio_test_fixtures', d.oid, 'CONNECT') AS connect,
       EXISTS (SELECT 1 FROM aclexplode(d.datacl) a WHERE a.grantee = 'cardapio_test_fixtures'::regrole) AS explicita,
       has_database_privilege('public', d.oid, 'CONNECT') AS via_public,
       has_database_privilege('cardapio_test_fixtures', d.oid, 'CREATE') AS create,
       has_database_privilege('cardapio_test_fixtures', d.oid, 'TEMP') AS temp
FROM pg_database d
WHERE d.datallowconn
ORDER BY d.datname;

\echo '=== pg_hba.conf: regras que alcançam a role, em ordem (primeira que casa vence) ==='
\echo '    Esperado: permissões só para cardapio_digital_test (scram, loopback) e recusas para "all"'
\echo '    ANTES da primeira regra com USER all. Ver pg_hba-test-fixtures.conf.example.'
SELECT rule_number, line_number, type, database, user_name, address, auth_method, error
FROM pg_hba_file_rules
WHERE 'cardapio_test_fixtures' = ANY(user_name) OR 'all' = ANY(user_name) OR error IS NOT NULL
ORDER BY rule_number NULLS FIRST;
SELECT pg_conf_load_time() AS ultimo_reload,
       (pg_stat_file(current_setting('hba_file'))).modification AS pg_hba_alterado_em;

\echo '=== Schema ==='
SELECT has_schema_privilege('cardapio_test_fixtures', 'public', 'USAGE') AS usage,
       has_schema_privilege('cardapio_test_fixtures', 'public', 'CREATE') AS create;

\echo '=== Matriz efetiva de tabelas (inclui herança de PUBLIC) ==='
WITH matrix(table_name, allowed) AS (VALUES
  ('admins', 'SELECT,INSERT,DELETE'),
  ('categories', 'SELECT,INSERT,DELETE'),
  ('products', 'SELECT,INSERT,UPDATE,DELETE'),
  ('comandas', 'SELECT,INSERT,UPDATE,DELETE'),
  ('comanda_invitations', 'SELECT,INSERT,DELETE'),
  ('comanda_sessions', 'SELECT,INSERT,DELETE'),
  ('orders', 'SELECT,DELETE'),
  ('order_items', 'SELECT,DELETE'),
  ('order_status_history', 'SELECT,DELETE'),
  ('_prisma_migrations', ''))
SELECT m.table_name,
       concat_ws(',',
         CASE WHEN has_table_privilege('cardapio_test_fixtures', 'public.' || m.table_name, 'SELECT') THEN 'SELECT' END,
         CASE WHEN has_table_privilege('cardapio_test_fixtures', 'public.' || m.table_name, 'INSERT') THEN 'INSERT' END,
         CASE WHEN has_table_privilege('cardapio_test_fixtures', 'public.' || m.table_name, 'UPDATE') THEN 'UPDATE' END,
         CASE WHEN has_table_privilege('cardapio_test_fixtures', 'public.' || m.table_name, 'DELETE') THEN 'DELETE' END,
         CASE WHEN has_table_privilege('cardapio_test_fixtures', 'public.' || m.table_name, 'TRUNCATE') THEN 'TRUNCATE' END,
         CASE WHEN has_table_privilege('cardapio_test_fixtures', 'public.' || m.table_name, 'REFERENCES') THEN 'REFERENCES' END,
         CASE WHEN has_table_privilege('cardapio_test_fixtures', 'public.' || m.table_name, 'TRIGGER') THEN 'TRIGGER' END,
         CASE WHEN has_table_privilege('cardapio_test_fixtures', 'public.' || m.table_name, 'MAINTAIN') THEN 'MAINTAIN' END
       ) AS privileges,
       m.allowed
FROM matrix m
ORDER BY m.table_name;

SELECT c.relname AS relacao,
       has_table_privilege('cardapio_test_fixtures', c.oid, 'SELECT') AS select,
       has_table_privilege('cardapio_test_fixtures', c.oid, 'INSERT') AS insert,
       has_table_privilege('cardapio_test_fixtures', c.oid, 'UPDATE') AS update,
       has_table_privilege('cardapio_test_fixtures', c.oid, 'DELETE') AS delete,
       has_table_privilege('cardapio_test_fixtures', c.oid, 'TRUNCATE') AS truncate,
       has_table_privilege('cardapio_test_fixtures', c.oid, 'REFERENCES') AS references,
       has_table_privilege('cardapio_test_fixtures', c.oid, 'TRIGGER') AS trigger
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY c.relname;

\echo '=== Sequências (deve ser tudo false) ==='
SELECT c.relname AS sequencia,
       has_sequence_privilege('cardapio_test_fixtures', c.oid, 'USAGE') AS usage,
       has_sequence_privilege('cardapio_test_fixtures', c.oid, 'SELECT') AS select,
       has_sequence_privilege('cardapio_test_fixtures', c.oid, 'UPDATE') AS update
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'S'
ORDER BY c.relname;

\echo '=== Default ACLs que alcançam a role (deve ser vazio) ==='
SELECT pg_get_userbyid(d.defaclrole) AS owner,
       d.defaclnamespace::regnamespace AS schema,
       d.defaclobjtype AS tipo,
       a.grantee::regrole AS grantee,
       a.privilege_type
FROM pg_default_acl d
CROSS JOIN LATERAL aclexplode(d.defaclacl) a
WHERE a.grantee = 'cardapio_test_fixtures'::regrole
ORDER BY 1, 2, 3, 4, 5;

\echo '=== Violações da matriz (deve retornar zero linhas) ==='
WITH matrix(table_name, allowed) AS (VALUES
  ('admins', 'SELECT,INSERT,DELETE'),
  ('categories', 'SELECT,INSERT,DELETE'),
  ('products', 'SELECT,INSERT,UPDATE,DELETE'),
  ('comandas', 'SELECT,INSERT,UPDATE,DELETE'),
  ('comanda_invitations', 'SELECT,INSERT,DELETE'),
  ('comanda_sessions', 'SELECT,INSERT,DELETE'),
  ('orders', 'SELECT,DELETE'),
  ('order_items', 'SELECT,DELETE'),
  ('order_status_history', 'SELECT,DELETE'),
  ('_prisma_migrations', '')),
privileges AS (SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS p)
SELECT m.table_name || ':' || p AS violacao
FROM matrix m CROSS JOIN privileges
WHERE has_table_privilege('cardapio_test_fixtures', 'public.' || m.table_name, p)
      IS DISTINCT FROM (p = ANY(string_to_array(m.allowed, ',')))
   OR has_table_privilege('cardapio_test_fixtures', 'public.' || m.table_name, p || ' WITH GRANT OPTION')
UNION ALL
SELECT 'schema:CREATE' WHERE has_schema_privilege('cardapio_test_fixtures', 'public', 'CREATE')
UNION ALL
-- Em Test: nenhum CREATE/TEMP, nem herdado. Fora de Test: nenhuma concessão EXPLÍCITA à role.
-- (O herdado de PUBLIC fora de Test é neutralizado pelo pg_hba; ver seção pg_hba acima.)
SELECT 'database:' || d.datname || ':' || p
FROM pg_database d CROSS JOIN (VALUES ('CREATE'), ('TEMP')) v(p)
WHERE d.datname = 'cardapio_digital_test' AND has_database_privilege('cardapio_test_fixtures', d.oid, v.p)
UNION ALL
SELECT 'database:' || d.datname || ':explicit'
FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
WHERE d.datname <> 'cardapio_digital_test' AND a.grantee = 'cardapio_test_fixtures'::regrole
UNION ALL
SELECT 'connect:missing:cardapio_digital_test'
WHERE NOT has_database_privilege('cardapio_test_fixtures', 'cardapio_digital_test', 'CONNECT')
UNION ALL
SELECT 'sequence:' || c.relname || ':' || p
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) v(p)
WHERE n.nspname = 'public' AND c.relkind = 'S'
  AND has_sequence_privilege('cardapio_test_fixtures', c.oid, v.p)
UNION ALL
SELECT 'membership:' || m.roleid::regrole
FROM pg_auth_members m
WHERE m.member = 'cardapio_test_fixtures'::regrole;
