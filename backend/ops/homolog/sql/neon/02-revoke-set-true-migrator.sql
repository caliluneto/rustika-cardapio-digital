-- 3D.5.3-C.5 - NAO EXECUTADO. Específico do PROVEDOR NEON. Via SQL Editor do Neon ou psql, como a MESMA role
-- administrativa que executou ../neon/01-grant-set-true-migrator.sql e ../neon/01b-elevate-inherit-for-rename.sql,
-- DEPOIS de ../04-finalize-rename.sql e ANTES de ../05-post-migration-grants.sql. Fecha a janela de privilégio por
-- completo: remove a membership com SET da 01 e o INHERIT elevado na 01b numa única instrução — não há um
-- passo separado de "deselevar o INHERIT antes de revogar o SET"; isto só é seguro porque roda DEPOIS de 04 já ter
-- terminado (nunca entre a elevação e o ALTER DATABASE RENAME, que ainda precisa do INHERIT).
--
-- A linha ADMIN-only concedida automaticamente pelo PostgreSQL >= 16 ao criador da role (grantor = superusuário de
-- bootstrap, ex. cloud_admin no Neon) permanece: ela não concede SET ROLE nem herança e não pode ser removida por
-- quem tem apenas CREATEROLE. A verificação abaixo exige a ausência de SET/INHERIT, não a ausência de qualquer linha.
--
-- EFEITO SOBRE MIGRATIONS FUTURAS (3D.5.3-C.5.1): nenhum. 05-post-migration-grants.sql e qualquer migration do Prisma
-- conectam-se DIRETAMENTE como cardapio_homolog_migrator, com a senha própria dessa role (ver \password nos scripts
-- ../01/../04) — nunca através da membership da role administrativa, que só existia para permitir os comandos de
-- OWNERSHIP (CREATE DATABASE/ALTER DATABASE RENAME) dos scripts 02 e 04. Revogar aqui não afeta nenhuma migration.
--
-- A role migradora mudou de nome em ../04-finalize-rename.sql (cardapio_migrator -> cardapio_homolog_migrator); a
-- membership segue o OID da role através do rename, então o REVOKE abaixo usa o nome JÁ RENOMEADO.
\set ON_ERROR_STOP on
DO $neon_revoke_pre$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'ABORT: conecte-se ao banco postgres';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cardapio_homolog_migrator') THEN
    RAISE EXCEPTION 'ABORT: cardapio_homolog_migrator não existe; rode ../04-finalize-rename.sql primeiro';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cardapio_migrator') THEN
    RAISE EXCEPTION 'ABORT: cardapio_migrator (nome legado) ainda existe; a renomeação não foi concluída';
  END IF;
END
$neon_revoke_pre$;

REVOKE cardapio_homolog_migrator FROM CURRENT_USER;

-- Verificação (leitura): nenhuma membership com SET/INHERIT restou (a linha ADMIN-only do bootstrap pode permanecer);
-- e o ownership permanece com a role migradora (revogar a membership administrativa NUNCA transfere o ownership).
DO $neon_revoke_verify$
DECLARE still_member boolean; db_owner_ok boolean; admin_only_rows int;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_auth_members m
    WHERE m.roleid = 'cardapio_homolog_migrator'::regrole AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND (m.set_option OR m.inherit_option)
  ) INTO still_member;
  IF still_member THEN
    RAISE EXCEPTION 'FALHA: ainda há membership com SET ou INHERIT de % em cardapio_homolog_migrator após o REVOKE', current_user;
  END IF;
  SELECT count(*)::int INTO admin_only_rows
    FROM pg_auth_members m
    WHERE m.roleid = 'cardapio_homolog_migrator'::regrole AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option;
  SELECT (pg_get_userbyid(datdba) = 'cardapio_homolog_migrator') INTO db_owner_ok
    FROM pg_database WHERE datname = 'cardapio_digital_homolog';
  IF NOT coalesce(db_owner_ok, false) THEN
    RAISE EXCEPTION 'FALHA: o dono de cardapio_digital_homolog não é cardapio_homolog_migrator';
  END IF;
  RAISE NOTICE 'OK: membership temporária (SET/INHERIT) revogada; linha(ns) ADMIN-only do bootstrap preservada(s): %; ownership de cardapio_digital_homolog mantido em cardapio_homolog_migrator', admin_only_rows;
END
$neon_revoke_verify$;
