-- NAO EXECUTADO. Somente leitura. Via psql no banco cardapio_digital_homolog (migrator definitivo ou administrador).
-- Aborta se algo divergir da identidade e das ACLs esperadas.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $verify$
BEGIN
  IF current_database() <> 'cardapio_digital_homolog' THEN RAISE EXCEPTION 'ABORT: banco inesperado'; END IF;
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname IN ('cardapio_digital_test', 'cardapio_digital_dev', 'cardapio_digital_shadow')) THEN
    RAISE EXCEPTION 'IDENTIDADE: o cluster contem bancos Dev/Test/Shadow';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('cardapio_migrator', 'cardapio_test_app', 'cardapio_dev_app')) THEN
    RAISE EXCEPTION 'IDENTIDADE: roles legadas ainda existem; finalize a renomeacao';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rustika_homolog_marker') THEN RAISE EXCEPTION 'IDENTIDADE: cluster sem marca'; END IF;
  IF (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) < 7 THEN
    RAISE EXCEPTION 'SCHEMA: migrations nao concluidas';
  END IF;
  IF (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) <> 'cardapio_homolog_migrator' THEN
    RAISE EXCEPTION 'ACL: o dono do banco deve ser cardapio_homolog_migrator';
  END IF;
  IF has_table_privilege('cardapio_homolog_app', 'public.admins', 'INSERT')
     OR has_table_privilege('cardapio_homolog_app', 'public.admins', 'UPDATE')
     OR has_table_privilege('cardapio_homolog_app', 'public.admins', 'DELETE')
     OR NOT has_table_privilege('cardapio_homolog_app', 'public.admins', 'SELECT')
     OR has_table_privilege('cardapio_homolog_app', 'public._prisma_migrations', 'SELECT')
     OR NOT has_column_privilege('cardapio_homolog_app', 'public.orders', 'status', 'UPDATE')
     OR NOT has_column_privilege('cardapio_homolog_app', 'public.products', 'availability_state', 'UPDATE')
     OR has_table_privilege('cardapio_homolog_app', 'public.products', 'UPDATE') THEN
    RAISE EXCEPTION 'ACL: o runtime diverge do conjunto minimo aprovado';
  END IF;
  IF has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'UPDATE')
     OR has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'DELETE')
     OR has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'TRUNCATE') THEN
    RAISE EXCEPTION 'ACL: o bootstrap nunca pode alterar ou remover administradores';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('cardapio_homolog_migrator', 'cardapio_homolog_app', 'cardapio_homolog_placeholder', 'cardapio_homolog_bootstrap')
             AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'ACL: atributos elevados em roles do projeto';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cardapio_homolog_placeholder' AND rolcanlogin) THEN
    RAISE EXCEPTION 'ACL: a role placeholder nao pode ter login';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members
             WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('cardapio_homolog_migrator', 'cardapio_homolog_app', 'cardapio_homolog_placeholder', 'cardapio_homolog_bootstrap'))) THEN
    RAISE EXCEPTION 'ACL: memberships inesperadas';
  END IF;
  RAISE NOTICE 'OK: identidade, ACL e schema conforme o esperado';
END
$verify$;
ROLLBACK;
