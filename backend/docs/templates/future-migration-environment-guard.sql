-- MODELO (3D.5.2-A) para migrations FUTURAS que concedem/revogam privilégios. Não é uma migration: não está em prisma/migrations.
-- A mesma migration deve rodar em Dev, Test e Homologação. Resolva a role de runtime pelo banco corrente e confira a identidade do executor.
-- Nunca altere as sete migrations históricas; nunca use `migrate resolve`, `db push` ou `migrate reset`.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $security$
DECLARE
  target_role text;
BEGIN
  IF current_database() = 'cardapio_digital_test' THEN target_role := 'cardapio_test_app';
  ELSIF current_database() = 'cardapio_digital_dev' THEN target_role := 'cardapio_dev_app';
  ELSIF current_database() = 'cardapio_digital_homolog' THEN target_role := 'cardapio_homolog_app';
  ELSE RAISE EXCEPTION 'Unauthorized database';
  END IF;
  IF current_user NOT IN ('cardapio_migrator', 'cardapio_homolog_migrator') OR session_user <> current_user
     OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) <> current_user THEN
    RAISE EXCEPTION 'Unexpected migration identity';
  END IF;
  -- Exemplo (substitua): EXECUTE format('GRANT UPDATE (coluna) ON TABLE public.tabela TO %I', target_role);
END
$security$;
COMMIT;
