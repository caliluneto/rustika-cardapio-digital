-- 3D.5.3-C.5 - NAO EXECUTADO. SOMENTE LEITURA. Específico do PROVEDOR NEON. Rode este arquivo INTEIRO em até três
-- momentos: (a) logo depois de ../01-cluster-roles.sql e de ../neon/01-grant-set-true-migrator.sql — estado "antes"
-- (espera-se set_option=true, inherit_option=false); (b) opcional, logo depois de ../neon/01b-elevate-inherit-for-
-- rename.sql e antes de ../04-finalize-rename.sql — espera-se inherit_option=true; (c) depois de
-- ../04-finalize-rename.sql e de ../neon/02-revoke-set-true-migrator.sql — estado "depois" (espera-se 0 linhas no
-- item 2: a membership foi totalmente revogada). Compare as saídas.
\set ON_ERROR_STOP on
BEGIN READ ONLY;

-- 1) Quem é o dono de cada banco do projeto (nunca deve ser a role administrativa do projeto nem neon_superuser).
SELECT datname, pg_get_userbyid(datdba) AS owner
FROM pg_database
WHERE datname IN ('cardapio_digital_test', 'cardapio_digital_homolog')
ORDER BY 1;

-- 2) Memberships da role migradora (legada ou já renomeada) — esperado: só a role administrativa, e só enquanto a
--    janela estiver aberta (entre neon/01 e neon/02; inherit_option vira TRUE só entre neon/01b e ../04). Pode haver
--    MAIS DE UMA LINHA para o mesmo par (role, member) — uma por concedente (comportamento do PostgreSQL >= 16);
--    isto é esperado, não é duplicação indevida. admin_option deve ser FALSE nas linhas do GRANT explícito.
SELECT pg_get_userbyid(roleid) AS role, pg_get_userbyid(member) AS member, admin_option, inherit_option, set_option
FROM pg_auth_members
WHERE pg_get_userbyid(roleid) IN ('cardapio_migrator', 'cardapio_homolog_migrator')
ORDER BY 1, 2;

-- 3) Garantia de que a role de RUNTIME nunca recebeu privilégios administrativos (nem por este procedimento, nem por
--    qualquer outro): deve devolver 0 linhas antes e depois.
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
FROM pg_roles
WHERE rolname IN ('cardapio_test_app', 'cardapio_dev_app', 'cardapio_homolog_app', 'cardapio_homolog_placeholder')
  AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls);

-- 4) Nenhuma role do RÚSTIKA deve ser membro de neon_superuser (o oposto do item 2: aqui é SER membro, não TER membro).
SELECT pg_get_userbyid(member) AS role_do_rustika
FROM pg_auth_members
WHERE roleid = (SELECT oid FROM pg_roles WHERE rolname = 'neon_superuser')
  AND pg_get_userbyid(member) LIKE 'cardapio\_%';

ROLLBACK;
