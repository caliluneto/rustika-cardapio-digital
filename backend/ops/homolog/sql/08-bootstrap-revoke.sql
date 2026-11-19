-- 3D.5.2-A - NAO EXECUTADO. Via psql no banco cardapio_digital_homolog COMO cardapio_homolog_migrator: remove os privilegios do bootstrap.
\set ON_ERROR_STOP on
BEGIN;
DO $revoke$
BEGIN
  IF current_database() <> 'cardapio_digital_homolog' OR current_user <> 'cardapio_homolog_migrator' THEN
    RAISE EXCEPTION 'ABORT: banco ou role inesperados';
  END IF;
  EXECUTE 'REVOKE ALL ON TABLE public.admins FROM cardapio_homolog_bootstrap';
  EXECUTE 'REVOKE ALL ON TABLE public._prisma_migrations FROM cardapio_homolog_bootstrap';
  EXECUTE 'REVOKE USAGE ON SCHEMA public FROM cardapio_homolog_bootstrap';
END
$revoke$;
COMMIT;
