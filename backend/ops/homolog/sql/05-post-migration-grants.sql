-- NAO EXECUTADO. Via psql no banco DEFINITIVO cardapio_digital_homolog COMO cardapio_homolog_migrator, depois de 04.
-- Concede ao bootstrap somente o minimo e confere a identidade.
\set ON_ERROR_STOP on
BEGIN;
DO $grants$
BEGIN
  IF current_database() <> 'cardapio_digital_homolog' OR current_user <> 'cardapio_homolog_migrator' OR session_user <> 'cardapio_homolog_migrator' THEN
    RAISE EXCEPTION 'ABORT: banco ou role inesperados';
  END IF;
  IF (SELECT count(*) FROM public._prisma_migrations) <> 9
     OR (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) <> 9 THEN
    RAISE EXCEPTION 'ABORT: as nove migrations precisam estar aplicadas, concluidas e sem reversao';
  END IF;
  IF (SELECT count(*) FROM public.admins) <> 0 THEN
    RAISE EXCEPTION 'ABORT: ja existe administrador; o bootstrap nao se aplica';
  END IF;
  EXECUTE 'GRANT USAGE ON SCHEMA public TO cardapio_homolog_bootstrap';
  EXECUTE 'GRANT SELECT ON TABLE public._prisma_migrations TO cardapio_homolog_bootstrap';
  EXECUTE 'GRANT SELECT, INSERT ON TABLE public.admins TO cardapio_homolog_bootstrap';
  IF has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'UPDATE')
     OR has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'DELETE')
     OR has_table_privilege('cardapio_homolog_bootstrap', 'public.admins', 'TRUNCATE')
     OR has_table_privilege('cardapio_homolog_app', 'public.admins', 'INSERT') THEN
    RAISE EXCEPTION 'ABORT: ACL inesperada em admins';
  END IF;
END
$grants$;
COMMIT;
