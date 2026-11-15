/**
 * Databases other than Test where the fixtures role would be allowed to CONNECT by privilege
 * (normally inherited from PUBLIC). Each one must be refused at authentication (pg_hba): the
 * preflight tries to connect to every name returned here and aborts if any connection succeeds.
 */
export const FIXTURES_REACHABLE_SQL = `SELECT datname FROM pg_database
WHERE datallowconn AND datname <> 'cardapio_digital_test'
  AND has_database_privilege('cardapio_test_fixtures', datname, 'CONNECT')
ORDER BY 1`;

/** Effective privileges, including PUBLIC/inheritance, checked BEFORE provisioning any fixture.
 * Runs as migrator in a READ ONLY transaction. A nonempty result blocks execution.
 */
export const PERMISSIONS_SQL = `WITH
matrix(role_name, table_name, allowed) AS (VALUES
 ('cardapio_test_app','admins','SELECT'),
 ('cardapio_test_app','categories','SELECT'),
 ('cardapio_test_app','products','SELECT'),
 ('cardapio_test_app','comandas','SELECT,INSERT,UPDATE'),
 ('cardapio_test_app','comanda_invitations','SELECT,INSERT,UPDATE'),
 ('cardapio_test_app','comanda_sessions','SELECT,INSERT'),
 ('cardapio_test_app','orders','SELECT,INSERT'),
 ('cardapio_test_app','order_items','SELECT,INSERT'),
 ('cardapio_test_app','order_status_history','SELECT,INSERT'),
 ('cardapio_test_app','_prisma_migrations',''),
 ('cardapio_test_fixtures','admins','SELECT,INSERT,DELETE'),
 ('cardapio_test_fixtures','categories','SELECT,INSERT,DELETE'),
 ('cardapio_test_fixtures','products','SELECT,INSERT,UPDATE,DELETE'),
 ('cardapio_test_fixtures','comandas','SELECT,INSERT,UPDATE,DELETE'),
 ('cardapio_test_fixtures','comanda_invitations','SELECT,INSERT,DELETE'),
 ('cardapio_test_fixtures','comanda_sessions','SELECT,INSERT,DELETE'),
 ('cardapio_test_fixtures','orders','SELECT,DELETE'),
 ('cardapio_test_fixtures','order_items','SELECT,DELETE'),
 ('cardapio_test_fixtures','order_status_history','SELECT,DELETE'),
 ('cardapio_test_fixtures','_prisma_migrations','')),
roles AS (SELECT oid, rolname FROM pg_roles WHERE rolname IN ('cardapio_test_app','cardapio_test_fixtures')),
privileges AS (SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS p)
SELECT m.role_name || ':' || m.table_name || ':' || p AS violation
FROM matrix m CROSS JOIN privileges
WHERE has_table_privilege(m.role_name, 'public.' || m.table_name, p) IS DISTINCT FROM (p = ANY(string_to_array(m.allowed, ',')))
   OR has_table_privilege(m.role_name, 'public.' || m.table_name, p || ' WITH GRANT OPTION')
UNION ALL
SELECT r.rolname || ':column ACL:' || c.relname || '.' || a.attname FROM roles r JOIN pg_class c ON c.relnamespace = 'public'::regnamespace
JOIN pg_attribute a ON a.attrelid = c.oid CROSS JOIN LATERAL aclexplode(a.attacl) acl
WHERE acl.grantee IN (0, r.oid)
  -- The ONLY column ACL allowed is UPDATE (status, updated_at) on orders for the runtime role,
  -- without GRANT OPTION. Anything else (PUBLIC, fixtures, other columns/privileges) is a violation.
  AND NOT (r.rolname = 'cardapio_test_app' AND acl.grantee = r.oid AND c.relname = 'orders'
           AND a.attname IN ('status', 'updated_at') AND acl.privilege_type = 'UPDATE' AND NOT acl.is_grantable)
  -- And UPDATE (availability_state, updated_at) on products for the runtime role, without GRANT OPTION.
  AND NOT (r.rolname = 'cardapio_test_app' AND acl.grantee = r.oid AND c.relname = 'products'
           AND a.attname IN ('availability_state', 'updated_at') AND acl.privilege_type = 'UPDATE' AND NOT acl.is_grantable)
UNION ALL
SELECT 'cardapio_test_app:column UPDATE:orders.' || a.attname FROM pg_attribute a
WHERE a.attrelid = 'public.orders'::regclass AND a.attnum > 0 AND NOT a.attisdropped
AND has_column_privilege('cardapio_test_app', a.attrelid, a.attnum, 'UPDATE') IS DISTINCT FROM (a.attname IN ('status', 'updated_at'))
UNION ALL
SELECT 'cardapio_test_app:column UPDATE:products.' || a.attname FROM pg_attribute a
WHERE a.attrelid = 'public.products'::regclass AND a.attnum > 0 AND NOT a.attisdropped
AND has_column_privilege('cardapio_test_app', a.attrelid, a.attnum, 'UPDATE') IS DISTINCT FROM (a.attname IN ('availability_state', 'updated_at'))
UNION ALL
SELECT 'cardapio_test_fixtures:column UPDATE:orders.' || a.attname FROM pg_attribute a
WHERE a.attrelid = 'public.orders'::regclass AND a.attnum > 0 AND NOT a.attisdropped
AND has_column_privilege('cardapio_test_fixtures', a.attrelid, a.attnum, 'UPDATE')
UNION ALL
SELECT r.rolname || ':sequence:' || c.relname FROM roles r CROSS JOIN pg_class c
CROSS JOIN (VALUES ('USAGE'),('SELECT'),('UPDATE')) p(privilege)
WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace
AND (has_sequence_privilege(r.oid, c.oid, p.privilege) IS DISTINCT FROM
     (r.rolname = 'cardapio_test_app' AND c.relname = 'orders_order_number_seq' AND p.privilege = 'USAGE')
     OR has_sequence_privilege(r.oid, c.oid, p.privilege || ' WITH GRANT OPTION'))
UNION ALL
SELECT r.rolname || ':schema' FROM roles r
WHERE NOT has_schema_privilege(r.oid, 'public', 'USAGE') OR has_schema_privilege(r.oid, 'public', 'CREATE')
UNION ALL
SELECT r.rolname || ':database:' || d.datname FROM roles r CROSS JOIN pg_database d
WHERE (d.datname = 'cardapio_digital_test' AND (has_database_privilege(r.oid, d.oid, 'CREATE')
        OR has_database_privilege(r.oid, d.oid, 'TEMP') OR NOT has_database_privilege(r.oid, d.oid, 'CONNECT')))
 -- Outside Test only EXPLICIT grants to the role count. CONNECT/TEMP inherited from
 -- PUBLIC (postgres, template1, other projects) cannot be removed from one role; for the
 -- fixtures role it is neutralized by pg_hba and proven by FIXTURES_REACHABLE_SQL + probes.
 OR (d.datname <> 'cardapio_digital_test' AND EXISTS (SELECT 1 FROM aclexplode(d.datacl) a WHERE a.grantee = r.oid))
UNION ALL
SELECT r.rolname || ':membership' FROM roles r JOIN pg_auth_members m ON m.member = r.oid
UNION ALL
SELECT 'default ACL:' || owner.rolname FROM pg_default_acl d JOIN pg_roles owner ON owner.oid = d.defaclrole
CROSS JOIN LATERAL aclexplode(d.defaclacl) a
WHERE d.defaclobjtype IN ('r','S') AND a.grantee IN (0, (SELECT oid FROM roles WHERE rolname = 'cardapio_test_app'),
 (SELECT oid FROM roles WHERE rolname = 'cardapio_test_fixtures'))
UNION ALL
SELECT 'PUBLIC table ACL:' || c.relname FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
WHERE c.relnamespace = 'public'::regnamespace AND a.grantee = 0
UNION ALL
SELECT r.rolname || ':unexpected relation:' || c.relname FROM roles r CROSS JOIN pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
AND NOT EXISTS (SELECT 1 FROM matrix m WHERE m.role_name = r.rolname AND m.table_name = c.relname)
AND EXISTS (SELECT 1 FROM privileges WHERE has_table_privilege(r.oid, c.oid, p))`;
