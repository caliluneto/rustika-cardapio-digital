# Role de fixtures do PostgreSQL Test — 3D.3.10

**Estado: preparada, não criada e não executada.** Nenhum `CREATE ROLE`, `GRANT`, `REVOKE`
ou `DROP ROLE` foi executado nesta entrega. A existência e as ACLs reais só podem ser
comprovadas depois das Operações B/C, com autorização própria.

## Por que uma role separada

`cardapio_test_app` é a role de runtime: ela não pode criar administradores, categorias,
produtos nem preparar estados especiais (convite expirado/revogado, sessão revogada/expirada).
Usar `cardapio_migrator` para dados misturaria DDL e DML. `cardapio_test_fixtures` existe
apenas para os dados fictícios da suíte `tests/integration-db/**/*.integration.ts`.

## Matriz aprovada

Derivada do uso real de `tests/integration-db/support/fixtures.ts`:

| Tabela | `SELECT` | `INSERT` | `UPDATE` | `DELETE` | Uso |
| --- | --- | --- | --- | --- | --- |
| `admins` | sim | sim | não | sim | criar admin ativo/inativo e remover |
| `categories` | sim | sim | não | sim | criar categoria e remover |
| `products` | sim | sim | sim | sim | criar, alterar preço e remover |
| `comandas` | sim | sim | sim | sim | `upsert`, fechar e remover |
| `comanda_invitations` | sim | sim | não | sim | criar convites e remover |
| `comanda_sessions` | sim | sim | não | sim | criar sessões e remover |
| `orders` | sim | não | não | sim | ler e remover pedidos da execução |
| `order_items` | sim | não | não | sim | ler e remover itens |
| `order_status_history` | sim | não | não | sim | ler e remover histórico |
| `_prisma_migrations` | não | não | não | não | nunca acessível |

Também **não** recebe: `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN`, `CREATE` no schema,
`CREATE`/`TEMP` no banco, `USAGE`/`SELECT`/`UPDATE` em sequências, memberships, `SUPERUSER`,
`CREATEDB`, `CREATEROLE`, `BYPASSRLS`, `REPLICATION` ou `INHERIT`. A role não cria pedidos:
pedidos nascem pela API e consomem `orders_order_number_seq` com a role de runtime.

## Como o PostgreSQL decide (base da estratégia, 3D.3.11)

| Mecanismo | Funcionamento real | Consequência aqui |
| --- | --- | --- |
| `NOLOGIN` | A role não autentica conexão nenhuma, com ou sem senha. Serve como alvo de `SET ROLE` ou grupo. | A role é criada `NOLOGIN`: inócua enquanto o isolamento não existe. |
| `LOGIN` | Permite autenticar, sujeito ao `pg_hba.conf` e ao privilégio `CONNECT`. | Só é ligado no passo 2, depois do pg_hba conferido. |
| `\password` | O psql calcula o hash SCRAM no cliente e envia `ALTER ROLE ... PASSWORD '<hash>'`. Funciona em role `NOLOGIN`. O texto puro não vai ao servidor; o hash pode aparecer em log se `log_statement` registrar DDL. | Senha definida antes do `LOGIN`; nada versionado. |
| `CONNECT` | Verificado na conexão para a role autenticada (`session_user`), somando o que vem de `PUBLIC`. | `PUBLIC` dá `CONNECT` em bancos de fora; não dá para retirar de uma role só. |
| `pg_hba.conf` | Primeira linha que casa (tipo, banco, usuário, endereço) decide; `reject` encerra. É avaliado **antes** do `CONNECT`. | Linhas da role no topo recusam tudo exceto Test, sem afetar outras roles. |
| `SET ROLE` | Troca `current_user` para uma role da qual `session_user` é membro (no PG16+, opção `SET`). `RESET ROLE` volta; não é barreira contra o próprio cliente. | Não resolve `CONNECT`: o login continua sendo da role de conexão. |
| Herança | Com `INHERIT` (ou `INHERIT TRUE` na concessão, PG16+), o membro usa os privilégios do grupo sem `SET ROLE`. `PUBLIC` vale sempre, independentemente de `NOINHERIT`. | A role é `NOINHERIT` e sem memberships. |
| `session_user` / `current_user` | O primeiro é quem autenticou; o segundo é o usado nas checagens de privilégio. | O preflight exige os dois iguais a `cardapio_test_fixtures`. |

**Role intermediária de conexão com `SET ROLE`: avaliada e descartada.** Ela não isola
conexões (o `CONNECT` e o `pg_hba` valem para a role de login), acrescentaria uma segunda
credencial e uma membership a auditar, e o `SET ROLE` pode ser desfeito pela própria sessão.
A estratégia final é **uma única role `cardapio_test_fixtures` com `LOGIN`**, `NOINHERIT`, sem
memberships, criada `NOLOGIN`, com senha por `\password` e `LOGIN` ligado só com o pg_hba
conferido. Separação das quatro funções:

| Função | Role | Onde conecta |
| --- | --- | --- |
| Migration | `cardapio_migrator` (dona dos objetos) | Dev, Test, Shadow (pelo wrapper, deploy só em Test) |
| Runtime | `cardapio_test_app` / `cardapio_dev_app` | o próprio banco |
| Fixtures | `cardapio_test_fixtures` | **somente** Test (pg_hba) |
| Conexão administrativa | role local `SUPERUSER` do operador | só para provisionar, verificar e reverter |

## Pré-requisitos bloqueantes

1. **Migration 20261104 aplicada e concluída no Test.** O script recusa se a linha não estiver
   em `_prisma_migrations`.
2. **Isolamento de conexão por `pg_hba.conf` (revisado na 3D.3.11).** Leitura real do
   cluster em 04/11/2026: `cardapio_digital_dev` e `cardapio_digital_shadow` **já não**
   concedem `CONNECT` a `PUBLIC` (o bloqueio da 3D.3.10 não existe). Mas `PUBLIC` conecta
   em `postgres`, `template1`, `rf004_lab_*`, `cardapio_restore_precheck` e nos bancos de outro
   projeto (`plataforma_sites_ia`, `plataforma_sites_ia_test`). Privilégios de `PUBLIC`
   são aditivos: `REVOKE ... FROM cardapio_test_fixtures` não os retira, e revogá-los de `PUBLIC`
   afetaria outras aplicações. Por isso o `LOGIN` só é habilitado com as 5 linhas de
   `sql/pg_hba-test-fixtures.conf.example` no topo do `pg_hba.conf` (antes de qualquer
   `USER all`) e recarregadas. `enable-test-fixtures-login.sql` confere isso em
   `pg_hba_file_rules`, e o preflight da suíte repete a prova tentando conectar.
3. **Cluster local.** O script exige `127.0.0.1`/`::1`, PostgreSQL >= 17, banco
   `cardapio_digital_test` cujo dono é `cardapio_migrator`, e `current_user = session_user`.
4. **Operador administrativo.** A provisão exige uma role local com `SUPERUSER`; as roles de
   runtime e o migrator não provisionam a si mesmos.
5. **Role ausente.** O script falha se `cardapio_test_fixtures` já existir. Para recriar, use o
   rollback com autorização.
6. **Segredo fora do repositório.** Nenhuma senha entra em `.sql`, `.env` versionado, Git,
   histórico ou chat. A senha é definida interativamente por `\password` (SCRAM no cliente).

## Procedimento preparado (não executado)

Os arquivos ficam em `backend/docs/sql/`:

| Arquivo | Efeito |
| --- | --- |
| `provision-test-fixtures.sql` | Cria a role `NOLOGIN`, aplica a matriz mínima e valida; transação única. |
| `enable-test-fixtures-login.sql` | Pede a senha com `\password`, exige que ela exista e habilita `LOGIN`. |
| `verify-test-fixtures.sql` | Somente leitura; mostra atributos, ACLs efetivas, sequências e violações. |
| `rollback-test-fixtures.sql` | Revoga os privilégios conhecidos e executa `DROP ROLE`. |

Sequência, **somente após autorização**:

```powershell
cd C:\Users\<USUARIO>\OneDrive\Documentos\Cardapio_Digital\backend
# psql não recebe senha em argumento; o terminal pede a credencial administrativa.
psql -X -h 127.0.0.1 -p 5432 -U <role_administrativa> -d cardapio_digital_test `
  -v ON_ERROR_STOP=1 -f docs/sql/provision-test-fixtures.sql

# Isolamento (3D.3.11): copiar o pg_hba.conf atual para fora do OneDrive, inserir no TOPO as
# 5 linhas de docs/sql/pg_hba-test-fixtures.conf.example e recarregar (SELECT pg_reload_conf()).

# Abra o psql interativo; \password precisa ler do terminal, não de -f.
psql -X -h 127.0.0.1 -p 5432 -U <role_administrativa> -d cardapio_digital_test
# Dentro do psql:
\password cardapio_test_fixtures
\i docs/sql/enable-test-fixtures-login.sql
\i docs/sql/verify-test-fixtures.sql
\q

# Pós-verificação de isolamento (cada uma deve FALHAR com "pg_hba.conf rejects connection"):
psql -X -w -h 127.0.0.1 -U cardapio_test_fixtures -d cardapio_digital_dev -c 'SELECT 1'
psql -X -w -h 127.0.0.1 -U cardapio_test_fixtures -d postgres -c 'SELECT 1'
```

`-w` impede o psql de pedir senha: a recusa do pg_hba aparece antes de qualquer autenticação.
O preflight da suíte repete essa prova para todo banco em que a role teria `CONNECT`.

Criar `fixtures-test.env` **fora do repositório**, na pasta de segredos já usada pelos perfis
(`resolveSecretsDir()`), com uma única linha e permissões restritas ao usuário do Windows:

```text
DATABASE_URL="postgresql://cardapio_test_fixtures:<senha-urlencoded>@127.0.0.1:5432/cardapio_digital_test?schema=public"
```

Não versionar, não copiar para o OneDrive, não colar em relatório. O loader
`tests/integration-db/support/databases.ts` recusa outro banco, outro usuário, host não local,
chaves extras e força `connection_limit=1`.

## Recuperação e rollback

- Se `provision-test-fixtures.sql` falhar, a transação reverte: nenhuma role parcial deve
  permanecer. Confirme com `SELECT ... FROM pg_roles WHERE rolname = 'cardapio_test_fixtures'`.
- Se a role existir sem senha (`NOLOGIN`), rode novamente `enable-test-fixtures-login.sql`;
  não recrie a role.
- Se a senha for comprometida, rode `\password cardapio_test_fixtures` novamente e rotacione o
  `fixtures-test.env`; não é necessário recriar a role.
- Para remover tudo, com autorização: `rollback-test-fixtures.sql`; apague o
  `fixtures-test.env` manualmente. O rollback falha se a role possuir objetos, justamente para
  não destruir dados por engano.
- Se houver grants residuais em Dev/Shadow, o rollback tenta revogá-los; se o operador não for
  `SUPERUSER`, faça a revogação com a role dona antes do `DROP ROLE`.

## O que ainda não está provado

A matriz acima é estática. A prova real depende de:

1. aplicar a migration no Test (Operação C);
2. provisionar a role (Operação D);
3. executar `verify-test-fixtures.sql` e o preflight da suíte;
4. executar a suíte real (Operação E), quando o teste de ACL e o `PERMISSIONS_SQL` falharem
   fechado em qualquer desvio.

Até lá, a classificação de segurança PostgreSQL permanece **não comprovada**, mesmo que os
testes com mocks passem.
