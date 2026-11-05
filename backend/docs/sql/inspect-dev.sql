-- SOMENTE LEITURA. Não contém GRANT, REVOKE ou ALTER.
-- Execute conectado ao banco cardapio_digital_dev com um usuário autorizado.
-- Não informe senha na linha de comando; use PGPASSWORD temporário ou pgpass.

\echo '=== Banco: cardapio_digital_dev ==='

SELECT current_database() AS banco_atual, current_user AS usuario_atual;

SELECT
  datname AS banco,
  pg_get_userbyid(datdba) AS owner,
  datacl AS acl,
  datconnlimit AS limite_conexoes
FROM pg_database
WHERE datname = 'cardapio_digital_dev';

SELECT
  rolname AS role,
  rolsuper,
  rolcreaterole,
  rolcreatedb,
  rolcanlogin,
  rolconnlimit AS limite_conexoes
FROM pg_roles
WHERE rolname IN (
  'cardapio_dev_app',
  'cardapio_test_app',
  'cardapio_migrator'
)
ORDER BY rolname;

SELECT
  r.rolname AS role,
  has_database_privilege(r.rolname, 'cardapio_digital_dev', 'CONNECT') AS pode_conectar,
  has_schema_privilege(r.rolname, 'public', 'USAGE') AS pode_usar_public,
  has_schema_privilege(r.rolname, 'public', 'CREATE') AS pode_criar_public
FROM pg_roles AS r
WHERE r.rolname IN (
  'cardapio_dev_app',
  'cardapio_test_app',
  'cardapio_migrator'
)
ORDER BY r.rolname;

SELECT
  schemaname AS schema,
  tablename AS tabela,
  tableowner AS owner
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

SELECT
  grantee AS role,
  table_schema AS schema,
  table_name AS tabela,
  privilege_type AS privilegio
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN (
    'cardapio_dev_app',
    'cardapio_test_app',
    'cardapio_migrator'
  )
ORDER BY grantee, table_name, privilege_type;

SELECT
  pg_get_userbyid(defaclrole) AS role_concedente,
  defaclnamespace::regnamespace AS schema,
  defaclobjtype AS tipo_objeto,
  defaclacl AS acl_padrao
FROM pg_default_acl
ORDER BY role_concedente, schema, tipo_objeto;

SELECT
  pid,
  usename AS role,
  datname AS banco,
  application_name,
  state
FROM pg_stat_activity
WHERE datname = 'cardapio_digital_dev'
ORDER BY pid;
