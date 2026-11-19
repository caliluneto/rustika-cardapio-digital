-- 3D.3.10: prepared only. Apply through the authorized migrate-test wrapper.
-- Bytes are immutable after approval/application; migrations/** -text preserves LF.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $security$
DECLARE
  target_role text;
  other_role text;
  object_name text;
BEGIN
  IF current_database() = 'cardapio_digital_test' THEN
    target_role := 'cardapio_test_app';
    other_role := 'cardapio_dev_app';
  ELSIF current_database() = 'cardapio_digital_dev' THEN
    target_role := 'cardapio_dev_app';
    other_role := 'cardapio_test_app';
  ELSE
    RAISE EXCEPTION 'Unauthorized database';
  END IF;
  IF current_user <> 'cardapio_migrator' OR session_user <> 'cardapio_migrator'
     OR current_setting('server_version_num')::int < 170000
     OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) <> current_user THEN
    RAISE EXCEPTION 'Unexpected migration identity or PostgreSQL version';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN (target_role, other_role)) <> 2
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN (target_role, other_role, current_user)
                AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member IN
                (SELECT oid FROM pg_roles WHERE rolname IN (target_role, other_role))) THEN
    RAISE EXCEPTION 'Unsafe role attributes or inherited privileges';
  END IF;
  FOREACH object_name IN ARRAY ARRAY['admins','categories','products','comandas','comanda_invitations',
    'comanda_sessions','orders','order_items','order_status_history','_prisma_migrations','orders_order_number_seq'] LOOP
    IF to_regclass(format('public.%I', object_name)) IS NULL THEN
      RAISE EXCEPTION 'Missing dependency: %', object_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S','v','m','f')
               AND pg_get_userbyid(c.relowner) <> current_user)
     OR EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND a.attacl IS NOT NULL) THEN
    -- Table REVOKE cannot remove column grants. Stop for a separately reviewed correction.
    RAISE EXCEPTION 'Unexpected owner or column ACL';
  END IF;

  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC, %I, %I', current_database(), target_role, other_role);
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), target_role);
  EXECUTE format('REVOKE ALL ON SCHEMA public FROM PUBLIC, %I, %I', target_role, other_role);
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', target_role);
  EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, %I, %I', target_role, other_role);
  EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, %I, %I', target_role, other_role);
  EXECUTE format('REVOKE ALL ON TABLE public._prisma_migrations FROM PUBLIC, %I, %I', target_role, other_role);

  -- Revoke both global and per-schema defaults: a schema REVOKE cannot undo a global GRANT.
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE cardapio_migrator REVOKE ALL ON TABLES FROM PUBLIC, %I, %I', target_role, other_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE cardapio_migrator IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, %I, %I', target_role, other_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE cardapio_migrator REVOKE ALL ON SEQUENCES FROM PUBLIC, %I, %I', target_role, other_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE cardapio_migrator IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, %I, %I', target_role, other_role);

  EXECUTE format('GRANT SELECT ON TABLE public.admins, public.categories, public.products TO %I', target_role);
  EXECUTE format('GRANT SELECT, INSERT ON TABLE public.orders, public.order_items, public.order_status_history, public.comanda_sessions TO %I', target_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.comandas, public.comanda_invitations TO %I', target_role);
  -- nextval requires USAGE; runtime never calls setval or reads the sequence relation.
  EXECUTE format('GRANT USAGE ON SEQUENCE public.orders_order_number_seq TO %I', target_role);
END
$security$;
COMMIT;
