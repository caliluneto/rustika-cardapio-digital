# Relatório de Recuperação C.6-FIX01 — ACL do banco de replay

- Data (UTC): 2026-11-09T15:04:41.891Z
- Modo: APLICAÇÃO (--apply)
- Escopo: ACL do banco de replay; nenhuma role/banco é criado, renomeado ou removido.

- Identidade validada:
  - Projeto Neon: aged-scene-47291697
  - Endpoint esperado: ep-sweet-king-bd7i7ypb
  - Host: ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech
  - Banco administrativo: neondb
  - Role administrativa: neondb_owner
  - PostgreSQL: 18.6 (ac70818)
  - neon.project_id: aged-scene-47291697
  - neon.endpoint_id: ep-sweet-king-bd7i7ypb
  - TLS externo: TLS TLSv1.3 (TLS_AES_256_GCM_SHA384; CA Let's Encrypt/YR2)
  - pg_stat_ssl.ssl: false (false/null é esperado no Neon)
- Banco de replay:
  - cardapio_digital_test owner=cardapio_migrator allowconn=true connlimit=40 publicConnect=true publicTemp=true publicCreate=false
- Roles do projeto:
  - cardapio_dev_app login=false inherit=false super=false createdb=false createrole=false replication=false bypassrls=false connlimit=-1
  - cardapio_homolog_bootstrap login=false inherit=false super=false createdb=false createrole=false replication=false bypassrls=false connlimit=2
  - cardapio_migrator login=true inherit=false super=false createdb=false createrole=false replication=false bypassrls=false connlimit=5
  - cardapio_test_app login=true inherit=false super=false createdb=false createrole=false replication=false bypassrls=false connlimit=20
  - rustika_homolog_marker login=false inherit=false super=false createdb=false createrole=false replication=false bypassrls=false connlimit=-1
- Memberships:
  - cardapio_dev_app->neondb_owner admin=true inherit=false set=false | cardapio_homolog_bootstrap->neondb_owner admin=true inherit=false set=false | cardapio_migrator->neondb_owner admin=true inherit=false set=false | cardapio_test_app->neondb_owner admin=true inherit=false set=false | rustika_homolog_marker->neondb_owner admin=true inherit=false set=false
- Banco definitivo e roles definitivas:
  - Ausentes.
- Replay vazio:
  - Tabelas/sequências/views no schema public: 0; funções: 0; triggers: 0; políticas: 0; event triggers: 0; schemas inesperados: 0.
- ACL atual:
  - PUBLIC: connect=true temporary=true create=false
  - migrator: connect=true create=true temporary=true
  - cardapio_test_app: connect=true create=false temporary=true
  - cardapio_homolog_bootstrap: connect=true create=false temporary=true
  - cardapio_dev_app: connect=true create=false temporary=true
  - rustika_homolog_marker: connect=true create=false temporary=true

- Correção aplicada (transação concluída):
  - `REVOKE CONNECT, TEMPORARY ON DATABASE cardapio_digital_test FROM PUBLIC;`
  - `GRANT CONNECT ON DATABASE cardapio_digital_test TO cardapio_migrator, cardapio_test_app, cardapio_homolog_bootstrap;`
  - Executada em conexão autenticada como o OWNER `cardapio_migrator` (não pela role administrativa).
- ACL final:
  - PUBLIC: connect=false temporary=false create=false
  - cardapio_test_app: connect=true temporary=false
  - cardapio_homolog_bootstrap: connect=true temporary=false
  - cardapio_dev_app: connect=false temporary=false
  - rustika_homolog_marker: connect=false temporary=false
- Nenhum CREATE ROLE, CREATE DATABASE, ALTER ROLE, DROP, CASCADE, FORCE, RESET ou migration foi executado.

Status: RECUPERAÇÃO CONCLUÍDA; banco de replay pronto para o próximo passo autorizado.