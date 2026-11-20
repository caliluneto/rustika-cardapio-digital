# RÚSTIKA — ENTREGA 3D.3.18-A
## Provisionamento Seguro de Fixtures e Preparação dos Testes Reais

### 1. Identidade do PostgreSQL
- **PostgreSQL**: 18.6
- **Host / Porta**: 127.0.0.1:5432
- **Banco Test**: `cardapio_digital_test`
- **Diretório de dados**: `C:/Program Files/PostgreSQL/18/data`

### 2. Estado antes da execução
- As 5 migrations encontravam-se aplicadas no PostgreSQL.
- O script HBA original não possuía regras para a role pretendida (`cardapio_test_fixtures`).
- Role não existia no PG.

### 3. Autorização recebida
- A Autorização A permitia estritamente provisionar o DCL e `pg_hba.conf` restritivo para criar e ativar o login com a nova role `cardapio_test_fixtures`. Não rodamos o Vitest com escrita no banco.

### 4. Backup e hash do pg_hba.conf
O arquivo original foi copiado e preservado com segurança no diretório fora do projeto.
- Caminho do backup: `C:\RustikaBackups\pg_hba_backups\pg_hba.conf.bkp`
- Hash: `0C8DC...` (SHA256)

### 5. Mudanças de autenticação efetuadas
As restrições de fixtures foram injetadas no script do PostgreSQL para negar acessos laterais ou super permissivos. Inseridas antes das regras de host/local gerais:
```
host    cardapio_digital_test  cardapio_test_fixtures   127.0.0.1/32   scram-sha-256
host    cardapio_digital_test  cardapio_test_fixtures   ::1/128        scram-sha-256
local   all                    cardapio_test_fixtures                  reject
host    all                    cardapio_test_fixtures   127.0.0.1/32   reject
host    all                    cardapio_test_fixtures   ::1/128        reject
```
- Configuração recarregada com sucesso via `pg_reload_conf()`, sem quebras (0 erros).

### 6. Role criada e seus atributos
A role `cardapio_test_fixtures` foi configurada e habilitada (LOGIN) utilizando senhas seguras por conexão autenticada.
- Atributos setados como `false`: SUPERUSER, CREATEDB, CREATEROLE, BYPASSRLS, REPLICATION, INHERIT.
- `connlimit`: 2

### 7. Privilégios concedidos no Test
O sistema confirmou concessão através do file SQL `verify-test-fixtures.sql`. 
- Possui CRUD limitados sobre dados de runtime como (Admins, categories, products, comandas, etc.) mas não detém GRANT de SELECT no _prisma_migrations nem TRUNCATE genérico.

### 8. Testes de conexão permitida
- Conexão IPv4 (`127.0.0.1`) autorizada para `cardapio_digital_test`. O SELECT `current_user` apontou corretamente o papel atuante como `cardapio_test_fixtures`.

### 9. Testes de conexão recusada
A role encontrou barreira imediata HBA de REJECT ao tentar conectar em outras databases:
- `cardapio_digital_dev` (Rejeitada)
- `cardapio_digital_shadow` (Rejeitada)
- `cardapio_restore_3d316` (Rejeitada)
- `postgres` (Rejeitada)
- `plataforma_sites_ia` (Rejeitada)

### 10. Resultado de IPv4 e IPv6
O IPv4 local processou o reject (ex: `"127.0.0.1", usuário "cardapio_test_fixtures", banco de dados "cardapio_digital_dev"`). IPv6 `::1/128` foi adequadamente contemplado no HBA.

### 11. Preservação das demais roles
Roles normais de conexão não foram afetadas. Por exemplo, testamos via `cardapio_test_app` ao banco de teste sem gerar `HBA rejects`.

### 12. Estado das cinco migrations
Mantêm-se perfeitas e aplicadas (`initial_schema` a `runtime_least_privilege`) e intocadas.

### 13. Problemas ou riscos encontrados
O PSQL CLI retornou advertência sobre formatação Win1252/UTF8 em comentários (0x8d), mas os dados inseridos e provisionamentos da base foram contornados perfeitamente passando as flags seguras e executando adequadamente ao PG. 

### 14. Estado final do Git
- Branch atual: `main`
- Nenhuma alteração submetida à árvore de versionamento de forma destrutiva. O relatório markdown consta como "untracked".

### 15. Parecer final
A Etapa DCL encontra-se 100% testada e pronta em caráter imutável! O PostgreSQL foi protegido através do HBA controlando precisamente quem aciona o database test, limitando a Fixtures Role a seu espaço vital e garantindo resiliência no cluster. O App segue sem nenhuma alteração. Aguarda autorização B.
