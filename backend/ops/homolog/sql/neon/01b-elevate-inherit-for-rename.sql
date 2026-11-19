-- 3D.5.3-C.5.3 - NAO EXECUTADO. Específico do PROVEDOR NEON. Via SQL Editor do Neon ou psql, como a MESMA role
-- administrativa que executou ../neon/01-grant-set-true-migrator.sql, DEPOIS de ../03-verify-replay.sql e ANTES de
-- ../04-finalize-rename.sql. Eleva, só por essa janela, o mínimo adicional que `ALTER DATABASE ... RENAME` exige.
--
-- CAUSA RAIZ (ensaio real 3D.5.3-C.5.2, código `backend/scripts/neon-probe.mjs`): com a membership `SET TRUE,
-- INHERIT FALSE` do script 01, `CREATE DATABASE ... OWNER cardapio_migrator` funcionou, mas
-- `ALTER DATABASE ... RENAME` falhou com SQLSTATE 42501 ("must be owner of database"). A documentação oficial do
-- PostgreSQL (Role Membership) liga a primeira operação à opção SET; a segunda — agir como já sendo o dono de um
-- objeto já existente — usa a checagem geral de "privilégios do dono" (equivalente a `has_privs_of_role`), que só
-- segue memberships com INHERIT. SET por si só não basta para isso. `ALTER DATABASE ... RENAME` também exige que
-- QUEM EXECUTA tenha CREATEDB — isto já vale para a role administrativa do projeto (atributo próprio dela, não
-- herdado), então a elevação abaixo não precisa (e não deve) tocar nenhum outro privilégio.
--
-- POR QUE NÃO FAZER `SET ROLE cardapio_migrator` EM VEZ DISTO: cardapio_migrator é NOCREATEDB; trocar de identidade
-- faria a sessão PERDER o CREATEDB necessário para o próprio RENAME. A elevação por INHERIT é ADITIVA (mantém os
-- privilégios próprios da role administrativa e GANHA os da migradora), diferente de SET ROLE (que troca de
-- identidade por completo). Por isso elevamos INHERIT, nunca fazemos SET ROLE aqui.
--
-- JANELA MÍNIMA: elevar aqui, rodar SÓ ../04-finalize-rename.sql, e então ../02-revoke-set-true-migrator.sql remove
-- a membership POR COMPLETO (SET e INHERIT) — não há um passo separado de "deselevar"; a revogação total já cobre
-- isso, e só deve rodar DEPOIS do script 04 ter terminado (nunca entre a elevação e o rename).
-- NUNCA conceder isto à role de runtime (cardapio_homolog_app) nem a qualquer role de placeholder.
\set ON_ERROR_STOP on
DO $neon_elevate$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'ABORT: conecte-se ao banco postgres';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cardapio_migrator') THEN
    RAISE EXCEPTION 'ABORT: cardapio_migrator não existe (a renomeação ainda não pode ter ocorrido nesta janela)';
  END IF;
  IF current_user IN ('cardapio_test_app', 'cardapio_dev_app', 'cardapio_homolog_app', 'cardapio_homolog_placeholder') THEN
    RAISE EXCEPTION 'ABORT: executor inesperado (role de runtime)';
  END IF;
  -- Exige que a membership SET TRUE do script 01 já exista: esta elevação AJUSTA uma membership existente, nunca cria uma do zero.
  IF NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
    WHERE m.roleid = 'cardapio_migrator'::regrole AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user) AND m.set_option
  ) THEN
    RAISE EXCEPTION 'ABORT: a membership com SET (de ../neon/01-grant-set-true-migrator.sql) não existe; rode-a primeiro';
  END IF;
  -- Confirma que o próprio executor tem CREATEDB (exigido por ALTER DATABASE RENAME; não herdável, é atributo próprio da role).
  IF NOT (SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'ABORT: % não tem CREATEDB; a elevação de INHERIT não resolveria o RENAME mesmo assim', current_user;
  END IF;
END
$neon_elevate$;

-- Mantém SET TRUE (já concedido) e adiciona INHERIT TRUE. ADMIN não é mencionado: o valor atual (false) é retido
-- (comportamento documentado do PostgreSQL ao omitir uma opção num GRANT que ajusta uma membership existente).
GRANT cardapio_migrator TO CURRENT_USER WITH SET TRUE, INHERIT TRUE;

-- Verificação (leitura) imediata: agrega TODAS as linhas de pg_auth_members para este par (role, member) — o
-- PostgreSQL guarda uma linha por concedente, e uma leitura sem agregação poderia ler a linha errada.
DO $neon_elevate_verify$
DECLARE still_set boolean; now_inherits boolean;
BEGIN
  SELECT bool_or(m.set_option AND NOT m.admin_option), bool_or(m.inherit_option) INTO still_set, now_inherits
    FROM pg_auth_members m
    WHERE m.roleid = 'cardapio_migrator'::regrole AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user);
  IF NOT coalesce(still_set, false) THEN
    RAISE EXCEPTION 'FALHA: a membership com SET deixou de existir depois da elevação';
  END IF;
  IF NOT coalesce(now_inherits, false) THEN
    RAISE EXCEPTION 'FALHA: INHERIT TRUE não foi confirmado após o GRANT de elevação';
  END IF;
  RAISE NOTICE 'OK: % elevado temporariamente (INHERIT TRUE) — execute AGORA ../04-finalize-rename.sql e, assim que terminar, ../neon/02-revoke-set-true-migrator.sql', current_user;
END
$neon_elevate_verify$;
