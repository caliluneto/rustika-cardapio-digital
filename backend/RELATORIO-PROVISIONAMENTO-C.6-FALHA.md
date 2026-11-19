# Relatório de Provisionamento C.6 — somente provisionamento

- Data (UTC): 2026-11-08T15:33:50.352Z
- Status: em execução (o status final está no fim do relatório).
- Modo: somente banco e roles; `prisma migrate deploy` NÃO executado.

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
  - pg_stat_ssl.ssl: false (false/null é esperado no Neon; o TLS termina no proxy)
- Inventário inicial:
  - Bancos: neondb owner=neondb_owner allowconn=true connlimit=-1 publicAccess=true | postgres owner=cloud_admin allowconn=true connlimit=-1 publicAccess=true | template0 owner=cloud_admin allowconn=false connlimit=-1 publicAccess=true | template1 owner=cloud_admin allowconn=true connlimit=-1 publicAccess=true
  - Roles do projeto: nenhuma
  - Total de roles no cluster: 21
  - Banco definitivo cardapio_digital_homolog: ausente
  - Roles definitivas: ausentes

- Roles criadas com privilégio mínimo:
  - cardapio_migrator: LOGIN, senha própria, NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS/NOINHERIT, connection limit 5.
  - cardapio_test_app: LOGIN, senha própria, mesmos atributos, connection limit 20.
  - cardapio_dev_app: NOLOGIN, mesmos atributos, sem senha.
  - cardapio_homolog_bootstrap: NOLOGIN, senha própria, mesmos atributos, connection limit 2.
  - rustika_homolog_marker: NOLOGIN, mesmos atributos, sem senha.
  - Marca do cluster: rustika-homolog-cluster:81c4dfc1-1f0d-4e34-b31c-865e769f553e (não é credencial; copie para EXPECTED_CLUSTER_ID).


## FALHA
- Erro: PUBLIC ainda tem CONNECT/TEMPORARY no banco de replay.
- Roles criadas antes da falha: cardapio_migrator, cardapio_test_app, cardapio_dev_app, cardapio_homolog_bootstrap, rustika_homolog_marker
- Banco de replay criado antes da falha: sim
- Marca gerada antes da falha: rustika-homolog-cluster:81c4dfc1-1f0d-4e34-b31c-865e769f553e
- Inventário parcial (nenhum DROP executado):
  - Bancos: cardapio_digital_test owner=cardapio_migrator allowconn=true connlimit=40 publicAccess=true | neondb owner=neondb_owner allowconn=true connlimit=-1 publicAccess=true | postgres owner=cloud_admin allowconn=true connlimit=-1 publicAccess=true | template0 owner=cloud_admin allowconn=false connlimit=-1 publicAccess=true | template1 owner=cloud_admin allowconn=true connlimit=-1 publicAccess=true
  - Roles do projeto: cardapio_dev_app, cardapio_homolog_bootstrap, cardapio_migrator, cardapio_test_app, rustika_homolog_marker
  - Memberships envolvendo o projeto: cardapio_dev_app->neondb_owner, cardapio_homolog_bootstrap->neondb_owner, cardapio_migrator->neondb_owner, cardapio_test_app->neondb_owner, rustika_homolog_marker->neondb_owner
  - Banco definitivo cardapio_digital_homolog: ausente

Status final: FALHA — interrompido sem DROP automático.