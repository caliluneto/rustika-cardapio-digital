-- 3D.5.2-A - NAO EXECUTADO. Via psql, como administrador do cluster de HOMOLOGACAO, conectado ao banco postgres, apos 03.
-- Renomeia o banco de replay e as roles legadas para a identidade DEFINITIVA da homologacao. ACLs, privilegios padrao, dono do banco
-- e historico do Prisma (_prisma_migrations, checksums) sao preservados: o PostgreSQL os referencia por OID, nao por nome.
-- Nada e apagado. Renomear uma role apaga somente senhas MD5 (inexistentes com SCRAM): defina as senhas finais depois, com \password.
\set ON_ERROR_STOP on
BEGIN;
DO $rename$
BEGIN
  -- 3D.5.2-B: a sessao do administrador nao pode ser a propria role renomeada nem estar no banco renomeado.
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'ABORT: conecte-se ao banco postgres, nao ao banco que sera renomeado'; END IF;
  IF current_user IN ('cardapio_migrator', 'cardapio_test_app', 'cardapio_dev_app') OR session_user IN ('cardapio_migrator', 'cardapio_test_app', 'cardapio_dev_app') THEN
    RAISE EXCEPTION 'ABORT: a role conectada nao pode ser uma das roles a renomear; use o administrador do cluster';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_prepared_xacts WHERE database = 'cardapio_digital_test') THEN RAISE EXCEPTION 'ABORT: ha transacoes preparadas pendentes no banco de replay'; END IF;
  IF EXISTS (SELECT 1 FROM pg_replication_slots WHERE database = 'cardapio_digital_test') THEN RAISE EXCEPTION 'ABORT: ha slots de replicacao no banco de replay'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rustika_homolog_marker') THEN RAISE EXCEPTION 'ABORT: cluster sem marca de homologacao'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'cardapio_digital_test') THEN RAISE EXCEPTION 'ABORT: banco de replay inexistente'; END IF;
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname IN ('cardapio_digital_homolog', 'cardapio_digital_dev', 'cardapio_digital_shadow')) THEN
    RAISE EXCEPTION 'ABORT: ja existe banco definitivo, dev ou shadow';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('cardapio_homolog_migrator', 'cardapio_homolog_app', 'cardapio_homolog_placeholder')) THEN
    RAISE EXCEPTION 'ABORT: roles definitivas ja existem';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = 'cardapio_digital_test' AND pid <> pg_backend_pid()) THEN
    RAISE EXCEPTION 'ABORT: ha conexoes ativas no banco de replay; encerre-as e repita';
  END IF;
END
$rename$;
ALTER DATABASE cardapio_digital_test RENAME TO cardapio_digital_homolog;
ALTER ROLE cardapio_test_app RENAME TO cardapio_homolog_app;
ALTER ROLE cardapio_migrator RENAME TO cardapio_homolog_migrator;
ALTER ROLE cardapio_dev_app RENAME TO cardapio_homolog_placeholder;
COMMIT;
\echo 'Renomeacao concluida. Redefina as senhas: \password cardapio_homolog_migrator ; \password cardapio_homolog_app'
\echo 'Depois valide com 09-verify-acl.sql e passe a usar os perfis app-homolog / migrate-homolog / bootstrap-homolog.'
