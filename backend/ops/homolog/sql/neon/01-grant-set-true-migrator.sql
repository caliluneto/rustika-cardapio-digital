-- 3D.5.3-C.5 - NAO EXECUTADO. Específico do PROVEDOR NEON; NÃO toca os scripts 01-09 de ../ (cluster dedicado), que
-- continuam valendo sem alteração para esse caso. Via SQL Editor do Neon ou psql, como a role administrativa do
-- projeto (ex.: neondb_owner), conectado ao banco postgres, DEPOIS de ../01-cluster-roles.sql e ANTES de
-- ../02-create-replay-database.sql.
--
-- POR QUÊ: no Neon, uma role criada por CREATE ROLE (não neon_superuser) recebe apenas ADMIN sobre si mesma para quem a
-- criou, SEM SET nem INHERIT (comportamento do PostgreSQL >= 16 para CREATEROLE não-superusuário). Sem isso,
-- `CREATE DATABASE ... OWNER cardapio_migrator` (script 02) e `ALTER DATABASE ... RENAME` (script 04) falham com
-- SQLSTATE 42501 quando executados pela role administrativa do projeto, que não é um superusuário real no Neon
-- (comprovado em 3D.5.3-C.3/C.4). Este script concede exatamente o necessário, só à role MIGRADORA, nunca à de runtime.
--
-- SET TRUE, INHERIT FALSE (3D.5.3-C.5.1 — revisado; o ensaio da C.3/C.4 testou SET+INHERIT juntos e funcionou, mas
-- nunca isolou qual dos dois era necessário). Documentação oficial (Role Membership, PostgreSQL 16 e 18, texto
-- idêntico): "To create an object owned by another role or give ownership of an existing object to another role, you
-- must have the ability to SET ROLE to that role; otherwise, commands such as ALTER ... OWNER TO or CREATE DATABASE
-- ... OWNER will fail." É a opção SET — não INHERIT — que a documentação liga explicitamente a essas duas operações
-- (CREATE DATABASE ... OWNER e ALTER ... OWNER TO). INHERIT controla apenas o uso AUTOMÁTICO e contínuo dos privilégios
-- da role concedida (sem precisar de SET ROLE) — algo que esta etapa não precisa: a role administrativa nunca atua
-- "como" cardapio_migrator fora destas duas operações, e cardapio_migrator não tem nenhum privilégio que valha a pena
-- herdar automaticamente. NÃO FOI reexecutado contra o Neon com INHERIT FALSE isoladamente (ver RELATORIO-ENTREGA-
-- 3D.5.3-C.5.1.md, seção 3): se a primeira execução real falhar de forma inesperada, pare e reavalie — não eleve para
-- INHERIT TRUE só para "fazer funcionar" sem entender por quê.
--
-- ESCOPO MÍNIMO: SOMENTE `cardapio_migrator` (a role legada usada pelo replay). As roles de runtime/placeholder
-- (`cardapio_test_app`, `cardapio_dev_app`, e depois da renomeação `cardapio_homolog_app`/`cardapio_homolog_placeholder`)
-- NUNCA recebem este privilégio — a aplicação não deve poder criar nem renomear bancos.
-- Revogar com ../neon/02-revoke-set-true-migrator.sql logo após ../04-finalize-rename.sql (ver verificação em 03-verify-ownership.sql).
-- Use o endpoint DIRETO do Neon para esta sessão administrativa (sem `-pooler`): o pooler (PgBouncer, modo transação)
-- não garante que os comandos desta sessão (DO/GRANT/CREATE DATABASE) cheguem ao mesmo backend do PostgreSQL.
\set ON_ERROR_STOP on
DO $neon_grant$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'ABORT: conecte-se ao banco postgres, como nos demais scripts de provisionamento';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cardapio_migrator') THEN
    RAISE EXCEPTION 'ABORT: a role cardapio_migrator não existe; rode ../01-cluster-roles.sql primeiro';
  END IF;
  -- Nunca conceder SET/INHERIT a quem não é a role migradora legada (defesa em profundidade: mesmo que este script
  -- seja copiado/adaptado por engano, ele se recusa a tocar qualquer role de runtime ou placeholder).
  IF current_user IN ('cardapio_test_app', 'cardapio_dev_app', 'cardapio_homolog_app', 'cardapio_homolog_placeholder')
     OR 'cardapio_migrator' IN ('cardapio_test_app', 'cardapio_dev_app', 'cardapio_homolog_app', 'cardapio_homolog_placeholder') THEN
    RAISE EXCEPTION 'ABORT: alvo ou executor inesperado (role de runtime)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    WHERE m.roleid = 'cardapio_migrator'::regrole AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND m.set_option
  ) THEN
    RAISE EXCEPTION 'ABORT: a membership com SET já existe; nada a fazer (idempotência) — não repita o GRANT';
  END IF;
END
$neon_grant$;

-- CURRENT_USER (não um identificador dinâmico): é exatamente a role administrativa conectada agora, a mesma que vai
-- executar 02 e 04. Isto evita qualquer interpolação de identificador neste script.
-- INHERIT FALSE (mínimo privilégio — ver nota no topo do arquivo): só a HABILIDADE de SET ROLE, sem uso automático
-- e contínuo dos privilégios (poucos, mas nenhum) de cardapio_migrator durante o resto da sessão administrativa.
GRANT cardapio_migrator TO CURRENT_USER WITH SET TRUE, INHERIT FALSE;

-- Verificação (leitura) imediata: confirma que SOMENTE a membership esperada foi criada, com INHERIT FALSE de fato.
-- 3D.5.3-C.5.3: o PostgreSQL >= 16 guarda uma linha de pg_auth_members POR GRANTOR. A role já tinha uma linha
-- automática desde a criação (grantor interno, admin_option=true, set=false, inherit=false); o GRANT acima cria uma
-- SEGUNDA linha (grantor = current_user). Um "SELECT ... INTO" simples, sem agregação, leria uma linha arbitrária
-- (bug real, comprovado em 3D.5.3-C.5.2 no neon-probe.mjs) — por isso agregamos com bool_or sobre TODAS as linhas.
DO $neon_grant_verify$
DECLARE ok boolean; any_inherit boolean;
BEGIN
  SELECT bool_or(m.set_option AND NOT m.admin_option), bool_or(m.inherit_option) INTO ok, any_inherit
    FROM pg_auth_members m
    WHERE m.roleid = 'cardapio_migrator'::regrole AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user);
  IF NOT coalesce(ok, false) THEN
    RAISE EXCEPTION 'FALHA: a membership com SET (sem ADMIN) não foi confirmada após o GRANT';
  END IF;
  IF coalesce(any_inherit, false) THEN
    RAISE EXCEPTION 'FALHA: alguma linha de membership já tem INHERIT TRUE; esperava-se INHERIT FALSE (mínimo privilégio) neste ponto';
  END IF;
  RAISE NOTICE 'OK: % agora pode SET ROLE cardapio_migrator, sem herdar privilégios automaticamente (temporário — elevar com neon/01b-elevate-inherit-for-rename.sql só antes de ../04-finalize-rename.sql; revogar tudo com 02-revoke-set-true-migrator.sql depois)', current_user;
END
$neon_grant_verify$;
