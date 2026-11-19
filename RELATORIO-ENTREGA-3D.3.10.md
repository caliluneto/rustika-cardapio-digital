# RELATÓRIO DA ENTREGA 3D.3.10

Privilégios mínimos no PostgreSQL, role de fixtures, endurecimento da integração e restauração isolada

Data: 04/11/2026 (America/Sao_Paulo)
Executor: OpenCode (DeepSeek V4.1 Flash Free), Windows 11, PowerShell 5.1.26100.9711, Node v24.20.0, npm 12.2.0
Bases: `RELATORIO-ENTREGA-3D.3.7.md`, `RELATORIO-ENTREGA-3D.3.8.md`, `RELATORIO-ENTREGA-3D.3.9.md`, `RELATORIO-ENTREGA-3D.3.9-ADENDO-3D.3.10.md`, `backend/docs/integration-db.md`, `backend/docs/restore-backup.md`, `backend/prisma/schema.prisma`
Git de partida: `1e80bdb chore: baseline inicial do projeto RUSTIKA` (sem remoto, sem commit posterior)

**Parecer: PARCIAL.** A preparação técnica foi concluída e validada com testes locais/mocks. A prova real de segurança PostgreSQL, a restauração do backup e a execução da suíte de integração **não** foram realizadas: dependem de autorização específica, de um dump que não existe mais no caminho registrado e da aplicação da quinta migration. Nenhuma escrita em banco, migration, `GRANT`, `REVOKE`, criação/alteração de role, restauração, commit ou push foi executada.

## Separação das evidências

| Categoria | O que entra |
|---|---|
| **Testes locais com mocks** `[EXEC]` | Backend **557/557 em 28 arquivos** e frontend **82/82**, incluindo as provas de aborto antes da escrita. |
| **Verificações estáticas** `[EXEC]` | Hashes das 5 migrations e do `migration_lock.toml`, LF dos SQL, .gitattributes, conteúdo dos scripts de provisão e do plano de restauração. |
| **Typecheck e builds** `[EXEC]` | Backend e frontend aprovados; bundle do frontend 276,41 kB (85,10 kB gzip). |
| **Trava de entrada exercitada** `[EXEC, sem conexão]` | `npm run test:integration:db` sem as variáveis aborta no `globalSetup` com `IntegrationAbort`, exit 1, antes de importar ou conectar. |
| **Preparado, NÃO executado** | Quinta migration, provisão de `cardapio_test_fixtures`, suíte real `*.integration.ts`, restauração em banco descartável, aplicação de ACLs reais. |
| **Bloqueado** | Dump da 3D.3.9 ausente; prova de ACL real; CONNECT herdado por `PUBLIC` em Dev/Shadow; autorização para escrever em Test. |
| **Não executado nesta entrega** | `psql`, `prisma migrate deploy`, `GRANT`, `REVOKE`, `CREATE ROLE`, `DROP ROLE`, `createdb`, `pg_restore`, `dropdb`, `git add`, `git commit`, `git push`. |

## 1. Estado inicial [EXEC]

- O repositório tinha **um único commit** (`1e80bdb`), sem remoto configurado e com todo o trabalho das entregas 3D.2.11 a 3D.3.9 ainda não versionado.
- A 3D.3.9 registrou **530/530** testes no backend e **81/81** no frontend.
- A 3D.3.9 registrou o Test com **1 migration aplicada e 3 pendentes**. Esta entrega **não consultou o banco**; com a quinta migration, a expectativa é 1 aplicada e 4 pendentes, mas isso não foi reconferido.
- O dump registrado pela 3D.3.9 não existe mais no caminho documentado (seção 14).
- Não havia autorização para escrever em banco, aplicar migration, criar role, restaurar backup ou commitar.

## 2. Arquivos alterados

### 2.1 Produzidos ou alterados nesta entrega

| Arquivo | Tipo | Papel |
|---|---|---|
| `backend/prisma/migrations/20261104000000_runtime_least_privilege/migration.sql` | novo | Quinta migration: privilégios mínimos para `cardapio_test_app`/`cardapio_dev_app`. |
| `backend/tests/scripts/least-privilege-migration.test.ts` | novo | Testes estáticos da migration: ordem, bytes, LF, seleção de banco, falha fechada, revogações, defaults e matriz exata. |
| `backend/tests/scripts/fixtures-role-provisioning.test.ts` | novo | Testes estáticos dos quatro SQL de fixtures e da documentação. |
| `backend/tests/scripts/backup-restore-plan.test.ts` | novo | Testes estáticos do plano de restauração e do `verify-restore.sql`. |
| `backend/tests/integration-db/support/preflight.ts` | alterado | Cinco migrations, identidades, `session_user`, cluster, atributos, checksums e matriz de permissões. |
| `backend/tests/integration-db/support/permissions.ts` | novo | ACL efetiva de runtime e fixtures, incluindo `PUBLIC`, herança, colunas, defaults, sequências e bancos. |
| `backend/tests/integration-db/support/databases.ts` | alterado | Advisory lock antes da checagem de resíduos, `connection_limit=1`, preflight completo, redação de erro. |
| `backend/tests/integration-db/support/fixtures.ts` | alterado | Limpeza escopada e validação de argumentos; sem `TRUNCATE` ou `DELETE` sem filtro. |
| `backend/tests/integration-db/support/harness.ts` | alterado | Resíduo zero e helpers coerentes com o novo preflight. |
| `backend/tests/integration-db/{auth,comandas,orders,security}.integration.ts` | alterados | Cenários reais preparados, ainda não executados; ACL de fixtures e runtime reforçadas. |
| `backend/tests/integration-db/cleanup-stale.ts` | alterado | Limpeza de execuções interrompidas com preflight e argumentos validados. |
| `backend/tests/integration-db-support.test.ts` | alterado | Provas com mocks de aborto antes da escrita, inclusive banco inacessível. |
| `backend/docs/integration-db.md` | reescrito | Desenho da suíte após a 3D.3.10: 5 migrations, matrizes, pré-requisito de `PUBLIC`, backup ausente. |
| `backend/docs/fixture-role.md` | novo | Procedimento, matriz, pré-requisitos bloqueantes e recuperação da role de fixtures. |
| `backend/docs/restore-backup.md` | novo | Plano de restauração isolada em banco descartável; registra o dump ausente. |
| `backend/docs/sql/provision-test-fixtures.sql` | novo | Criação `NOLOGIN` da role e grants mínimos; falha fechada. |
| `backend/docs/sql/enable-test-fixtures-login.sql` | novo | Habilita `LOGIN` depois do `\password` manual; não contém senha. |
| `backend/docs/sql/rollback-test-fixtures.sql` | novo | Revoga privilégios conhecidos e remove a role; recusa `DROP OWNED BY`. |
| `backend/docs/sql/verify-test-fixtures.sql` | novo | Verificação somente leitura de atributos, ACLs, sequências e violações. |
| `backend/docs/sql/verify-restore.sql` | novo | Verificação somente leitura do banco descartável de restauração. |
| `backend/docs/sql/README.md` | alterado | Separa inspeção, provisão e restauração; deixa claro o que não foi executado. |
| `.gitattributes` | novo | Preserva LF em `backend/prisma/migrations/**` e `backend/docs/sql/**`. |
| `frontend/src/services/orderSubmission.ts` | alterado | `requireUsableComandaSession` para revalidar a sessão no envio. |
| `frontend/src/pages/Checkout.tsx` | alterado | Chama a revalidação antes de montar o pedido. |
| `frontend/tests/order-recovery.test.mjs` | alterado | Regressão da sessão expirada entre renderização e envio. |
| `RELATORIO-ENTREGA-3D.3.9-ADENDO-3D.3.10.md` | novo | Correção documental do dump ausente, sem reescrever o relatório 3D.3.9. |
| `RELATORIO-ENTREGA-3D.3.10.md` | novo | Este relatório. |

### 2.2 Arquivos de entregas anteriores pendentes no mesmo checkpoint

Como o repositório só tem o commit baseline, o checkpoint precisa incluir também os arquivos de código, testes, docs e relatórios das entregas 3D.2.11 a 3D.3.9. Alterações de conteúdo já existentes em `backend/src/**`, `frontend/src/**`, `backend/package.json`, `frontend/package.json`, `tsconfig*.json`, testes e relatórios anteriores não são o foco funcional desta entrega; algumas foram reconciliadas com os artefatos preservados durante a preparação e todas continuam pendentes de versionamento. `README.md`, `backend/.env.example`, `.gitignore`, `frontend/.env.example` e `frontend/src/vite-env.d.ts` foram conferidos contra o baseline: **não há diferença de conteúdo** (apenas entradas de stat obsoletas em três deles; os blobs são idênticos ao `HEAD`).

## 3. Migration 20261104000000_runtime_least_privilege

Arquivo novo, quinto na ordem lexicográfica, com SHA-256:

```text
24471ed369980bc861d885dc68d9edd3747de73457be620d166eae8b1ec47d6e
```

Características verificadas estaticamente:

- Executa em `BEGIN; ... COMMIT;` e fixa `search_path = pg_catalog`.
- Seleciona a role pelo banco: em `cardapio_digital_test`, `cardapio_test_app` (e a oposta é `cardapio_dev_app`); em `cardapio_digital_dev`, `cardapio_dev_app` (oposta `cardapio_test_app`). Qualquer outro banco levanta exceção `Unauthorized database`.
- Exige `current_user = session_user = cardapio_migrator`, PostgreSQL `>= 170000` e dono do banco igual ao usuário da migration.
- Exige que as duas roles de runtime existam, não tenham `SUPERUSER`, `CREATEROLE`, `CREATEDB`, `REPLICATION` ou `BYPASSRLS` e não tenham memberships.
- Exige os 11 objetos de dependência e recusa owner inesperado ou ACL de coluna (uma `REVOKE` de tabela não remove grant de coluna).
- Revoga `ALL` de `PUBLIC` e das duas roles de runtime no banco, no schema `public`, em todas as tabelas, em todas as sequências e em `_prisma_migrations`.
- Revoga default privileges **globais e no schema `public`**, para tabelas e sequências, do owner `cardapio_migrator`.
- Concede apenas a matriz da seção 4.
- Não cria, altera ou remove roles; não toca `cardapio_test_fixtures`; não executa `DELETE`, `TRUNCATE` ou DDL de objetos.

**Limite importante:** a migration foi preparada e testada estaticamente, mas **não aplicada**. Portanto ela ainda não alterou nenhuma ACL real. O wrapper `scripts/prisma-run.ts` só permite `migrate deploy` no perfil `migrate-test` e no banco `cardapio_digital_test`; o ramo de Dev existe na migration, mas não é alcançável pelo wrapper atual. Endurecer Dev exige uma via separada, revisada e autorizada.

## 4. Matriz de permissões

### 4.1 Role de runtime (`cardapio_test_app` ou `cardapio_dev_app`)

| Objeto | Privilégios |
|---|---|
| `admins`, `categories`, `products` | `SELECT` |
| `comandas`, `comanda_invitations` | `SELECT`, `INSERT`, `UPDATE` |
| `comanda_sessions` | `SELECT`, `INSERT` |
| `orders`, `order_items`, `order_status_history` | `SELECT`, `INSERT` |
| `_prisma_migrations` | nenhum |
| `orders_order_number_seq` | `USAGE` (necessário para `nextval`) |
| Schema `public` | `USAGE`, sem `CREATE` |
| Banco | `CONNECT` somente no banco correspondente |
| `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN`, `WITH GRANT OPTION` | nenhum |

### 4.2 Role de fixtures (`cardapio_test_fixtures`, preparada)

| Tabela | Privilégios | Uso |
|---|---|---|
| `admins`, `categories` | `SELECT`, `INSERT`, `DELETE` | criar admin ativo/inativo e categoria; remover |
| `products`, `comandas` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` | criar, alterar preço, fazer `upsert`, fechar e remover |
| `comanda_invitations`, `comanda_sessions` | `SELECT`, `INSERT`, `DELETE` | criar convites/sessões e remover |
| `orders`, `order_items`, `order_status_history` | `SELECT`, `DELETE` | ler e remover apenas pedidos da execução |
| `_prisma_migrations` | nenhum | nunca acessível |
| Sequências | nenhum | pedidos nascem pela API, com a role de runtime |
| Schema `public` | `USAGE`, sem `CREATE` | — |
| Banco | `CONNECT` somente em Test | — |
| `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN`, memberships, atributos administrativos | nenhum | — |

A matriz é verificada de forma **efetiva** por `PERMISSIONS_SQL`, que considera `PUBLIC`, herança, ACL de coluna, defaults, sequências e `CONNECT` em todos os bancos. Qualquer desvio vira `IntegrationAbort` antes da primeira fixture.

## 5. Provisão da role de fixtures

**Estado: preparada, não criada, não executada.**

| Arquivo | Efeito |
|---|---|
| `backend/docs/sql/provision-test-fixtures.sql` | Cria `cardapio_test_fixtures` como `NOLOGIN`, sem senha, com a matriz mínima; transação única. |
| `backend/docs/sql/enable-test-fixtures-login.sql` | Exige que a senha já tenha sido definida e habilita `LOGIN`. |
| `backend/docs/sql/verify-test-fixtures.sql` | Somente leitura: atributos, memberships, ACLs efetivas, sequências, defaults e violações. |
| `backend/docs/sql/rollback-test-fixtures.sql` | Revoga os privilégios conhecidos e executa `DROP ROLE`; falha se a role possuir objetos. |

Controles de segurança do provisionamento:

- Só executa em `cardapio_digital_test`, com `current_user = session_user`, servidor local (`127.0.0.1`/`::1`), PostgreSQL `>= 17`.
- Exige role administrativa local com `SUPERUSER`; as roles de runtime e o migrator não se autopromovem.
- Exige que a quinta migration esteja aplicada e concluída em `_prisma_migrations`.
- Exige banco com owner `cardapio_migrator`, objetos desse owner, ausência da role e ausência de memberships.
- Cria a role `NOLOGIN`, sem senha. A senha é definida **manualmente** no psql interativo com `\password cardapio_test_fixtures`; nenhum arquivo, argumento, variável de ambiente ou histórico recebe a senha. O `enable-...sql` apenas confere que o verificador existe e habilita `LOGIN`.
- Recusa `CREATE`/`TEMP` no banco, `CREATE` no schema, acesso a `_prisma_migrations` e qualquer privilégio em sequências.
- **Falha fechada para Dev/Shadow:** se `PUBLIC` ainda concede `CONNECT` nesses bancos, a role herdaria o acesso. O script aborta; `REVOKE ... FROM cardapio_test_fixtures` não resolve, porque privilégios são aditivos. A correção exige autorização separada para endurecer `PUBLIC` ou isolar por `pg_hba.conf`.

O arquivo de segredo `fixtures-test.env` deve ficar **fora do repositório**, na pasta de segredos já usada pelos perfis, com uma única linha `DATABASE_URL` apontando para `cardapio_test_fixtures` em `cardapio_digital_test`. O loader recusa outro banco, outro usuário, host não local, chaves extras e força `connection_limit=1`.

## 6. Restauração isolada do backup

**Estado: plano preparado, nenhuma restauração executada, nenhum banco criado ou excluído.**

O dump registrado na 3D.3.9 não existe no caminho documentado (seção 14). O plano corrigido está em `backend/docs/restore-backup.md` e segue estas regras:

1. Destino obrigatoriamente descartável: `cardapio_restore_check_<AAAAMMDD>_<HHMMSS>`, validado por regex.
2. Nunca usar `pg_restore --create`; o dump foi feito com `--create` e recriaria `cardapio_digital_test`.
3. Nunca apontar `-d` para Dev, Test, Shadow, `postgres`, `template0` ou `template1`.
4. Nunca restaurar sobre banco existente; `createdb` deve falhar se o destino já existir. Sem `dropdb` preventivo.
5. Restaurar com `--no-owner --no-privileges --single-transaction --exit-on-error`.
6. Validar com `backend/docs/sql/verify-restore.sql`, que recusa qualquer banco fora do padrão `cardapio_restore_check_*`.
7. Limpar com `dropdb` somente após registrar o resultado e revalidar o nome.
8. Não usar `pg_terminate_backend` sem autorização.

A restauração com `--no-privileges` valida schema e dados, **não** ACLs. A prova de ACL é separada e depende do banco migrado real.

## 7. Endurecimento da suíte de integração

- O preflight agora exige **5 migrations**, com nome, checksum gravado, `finished_at`, ausência de `rolled_back_at` e checksum do arquivo em disco.
- Verifica `current_database`, `current_user`, `session_user`, atributos administrativos, `server_version_num >= 170000` e o mesmo servidor (`inet_server_addr():port`) nas três conexões.
- O advisory lock `3039390001` é obtido **antes** da checagem de resíduos, eliminando a corrida check-then-lock.
- A conexão de fixtures é forçada a `connection_limit=1`, para o lock de sessão permanecer na mesma conexão física.
- A limpeza de execução interrompida repete o preflight completo com `allowLeftovers`, valida argumentos e só então apaga; a limpeza de performance confere resíduo zero.
- A remoção de comandas exige convites emitidos pela própria execução; não há `DELETE` sem filtro nem `TRUNCATE`.
- `PERMISSIONS_SQL` verifica ACL efetiva de runtime e fixtures, incluindo `PUBLIC`, herança, colunas, defaults, sequências e `CONNECT` em todos os bancos.
- `npm test` continua sem config que inclua `.integration.ts`; só `npm run test:integration:db` usa `vitest.integration.config.mts`.
- Banco inacessível é convertido em `IntegrationAbort`, com redação de URL/senha, fechamento dos três clientes e nenhuma escrita.

## 8. Testes com mocks que provam o aborto antes da escrita

| Cenário exigido | Onde é provado |
|---|---|
| Falta de confirmação explícita | `assertIntegrationGate` recusa sem flag, flag diferente de `1`, sem confirmação, confirmação errada, `NODE_ENV` != test, perfil != `app-test` e confirmação de deploy presente. |
| Banco errado | Preflight recusa `cardapio_digital_dev` na aplicação, `postgres` nas fixtures e banco diferente do Test. |
| Role errada | Recusa `cardapio_dev_app` na aplicação, `cardapio_migrator` nas fixtures, migrator trocado e `session_user` diferente (`SET ROLE` disfarçado). |
| Migrations pendentes | 1 aplicada + 4 pendentes gera 4 razões "não aplicada" e a razão de contagem. |
| Checksum divergente | Recusa checksum gravado divergente e arquivo de disco divergente. |
| Permissões inadequadas | Recusa ACL excessiva (`admins:INSERT`) e ACL ausente (`orders:INSERT ausente`); `PERMISSIONS_SQL` cobre a matriz efetiva. |
| Banco inacessível | `openIntegrationDatabases` lança `IntegrationAbort`, redige `postgresql://***@`, desconecta `app`, `fixtures` e `migrator` e não emite escrita. |
| Outros desvios | Superuser, PostgreSQL 16, leitura de migrations fora de `READ ONLY`, migration com falha, resíduos, colisão `PA062240`, lock ocupado, `CREATEROLE` e cluster diferente. |

Complementos: o plano de limpeza apaga filhos antes dos pais e restringe cada passo a ids da execução; lista vazia de ids produz `in: []` (não apaga nada); os testes estáticos da migration verificam os 5 nomes, os bytes das anteriores, o lock, o LF, as revogações, os defaults e a matriz exata de grants; os testes da role de fixtures e do plano de restauração verificam os SQL e a documentação sem executá-los.

## 9. Idempotência, expiração e rate limiting

### 9.1 Idempotência do checkout

O `createOrderSubmitter` usa um armazenamento compartilhado entre montagens do Checkout:

- mesma carga útil → mesma `Idempotency-Key`, inclusive após fechar/reabrir o diálogo;
- uma requisição em andamento por vez (`ORDER_IN_PROGRESS`);
- resultado incerto (rede, timeout, abort, 5xx) mantém a tentativa e **recusa** carga diferente (`PENDING_ORDER_UNCERTAIN`) até `retryPending()`;
- recusa definitiva (400, 401, 403, 404, 409 exceto `ORDER_CONFLICT`, 422) descarta a tentativa e a próxima usa chave nova;
- 429 e `ORDER_CONFLICT` mantêm a chave para reenvio;
- sucesso descarta a chave, então o próximo pedido é novo.

### 9.2 Expiração no envio

`comandaSessionUsable` já era calculado na renderização. O diálogo podia ficar aberto além da expiração e tentar um pedido que o servidor recusaria com 401. A 3D.3.10 adiciona `requireUsableComandaSession`, chamado no `handleSubmit` antes de montar o corpo: sessão ausente, inválida ou expirada gera `ApiError(401, INVALID_SESSION)` **antes da rede**. A regressão cobre sessão válida, sessão expirada no limite e sessão nula.

### 9.3 Rate limiting

Revisado sem alteração de código, porque não foi comprovado defeito:

- L1 por sessão: 10 pedidos por 5 minutos;
- L2 por IP para sessões inválidas: 30 por 5 minutos, sem bloquear sessões já validadas;
- L3 por IP: 300 por 5 minutos (Wi-Fi compartilhado);
- sessões confiáveis por 8 horas;
- capacidade limitada em memória, sem bloquear cliente novo quando saturada;
- `429` com `Retry-After`, e o frontend mantém a mesma chave para reenviar.

Cobertura existente: `backend/tests/orders-rate-limit.test.ts` (11 cenários), `frontend/tests/http-client.test.mjs` (429/Retry-After) e `frontend/tests/order-recovery.test.mjs` (429 mantém a chave). Nenhuma mudança foi necessária nesta entrega.

## 10. Resultados dos testes backend [EXEC]

Comando:

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
$env:DB_PROFILE = 'app-test'
$env:NODE_ENV = 'test'
npm test
```

Resultado:

```text
Test Files  28 passed (28)
Tests       557 passed (557)
Duration    25.54s
```

Evolução: **530 → 557** (+27 testes). Nenhuma falha, nenhum teste ignorado. Os testes de integração real continuam fora de `npm test` e não foram executados.

## 11. Resultados dos testes frontend [EXEC]

Comando:

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\frontend
npm test
```

Resultado:

```text
tests 82
pass 82
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 4196.8
```

Evolução: **81 → 82** (+1 regressão de expiração no envio).

## 12. Typecheck e build [EXEC]

| Projeto | Comando | Resultado |
|---|---|---|
| Backend | `npm run typecheck` | Aprovado, sem erros. |
| Backend | `npm run build` (`tsc -p tsconfig.build.json`) | Aprovado, sem erros. |
| Frontend | `npm run typecheck` | Aprovado, sem erros. |
| Frontend | `npm run build` (`tsc --noEmit && vite build`) | Aprovado. 55 módulos; `index-DpMXXdnv.js` 276,41 kB (85,10 kB gzip); CSS 2,30 kB (1,02 kB gzip); `index.html` 0,53 kB (0,33 kB gzip). |

Trava de integração sem autorização:

```text
IntegrationAbort: Suíte de integração abortada antes de qualquer escrita:
- RUSTIKA_DB_INTEGRATION=1 ausente
- RUSTIKA_DB_INTEGRATION_CONFIRM=WRITE_CARDAPIO_DIGITAL_TEST ausente
- DB_PROFILE deve ser app-test
exit 1, sem conexão
```

## 13. Estado das migrations e hashes [EXEC]

| Migration | SHA-256 |
|---|---|
| `20261023000000_initial_schema` | `1a9cd08b9d49fa9f70eabcceaa4a696f5aee07555f6a88562ec789340f0d3983` |
| `20261027000000_rf004_comandas_catalogo_pedidos` | `05f583e854a87b77612c2f7d10a0a178ef45ea099d3237808b5bf0bd7c698122` |
| `20261031000000_rf004_fix_permissions` | `960766a8fb1576e6094622f112e1a3a9cd7455f56907a3405a8fbb183959e10b` |
| `20261102000000_update_products_source_identity_constraint` | `885b8de5dcc0cf5e7618d574ba5c013ae8b60c9b983260706c5819422564454f` |
| `20261104000000_runtime_least_privilege` | `24471ed369980bc861d885dc68d9edd3747de73457be620d166eae8b1ec47d6e` |
| `migration_lock.toml` | `99836963713b4f5b269ad49af0ed3d7b0b2e336115c2f92dc9ac683d139d0900` |

As quatro migrations anteriores e o lock permanecem byte a byte iguais. A quinta é nova, usa LF e está protegida por `.gitattributes` com `backend/prisma/migrations/** -text` e `backend/docs/sql/** -text`. Nenhuma migration foi aplicada nesta entrega.

## 14. Estado do backup [EXEC]

O caminho registrado na 3D.3.9 foi conferido:

```text
C:\Users\u1n3c\AppData\Local\RustikaBackups\cardapio_test_pre3d38_20261104-012137.dump
```

**O arquivo não existe.** O SHA-256 registrado (`1be946052157a2c54b7af979c9c174e0d41d70cfaab9abc9b5de90663f925265`) não pode ser reconferido. Nenhuma restauração foi tentada; nenhum `pg_restore`, `createdb` ou `dropdb` foi executado. A correção documental está em `RELATORIO-ENTREGA-3D.3.9-ADENDO-3D.3.10.md`, sem reescrever o relatório original.

Para desbloquear a Operação B é necessário gerar um **novo dump** (com autorização), fora do OneDrive e do repositório, registrar o SHA-256 e a versão do `pg_dump`/`pg_restore` (18.6) e repetir a inspeção `pg_restore --list` antes de restaurar.

## 15. Estado do Git e checkpoint

### 15.1 Inventário

- `HEAD`: `1e80bdb chore: baseline inicial do projeto RUSTIKA`.
- Sem remoto configurado; nenhum push possível ou executado.
- `git status --short`: **179 entradas antes deste relatório; 180 com ele** (28 marcações `M`, das quais 25 com conteúdo real, e 152 entradas não rastreadas).
- **25 arquivos rastreados com alteração real de conteúdo.**
- **152 entradas não rastreadas** (colapsadas por diretório); **142 arquivos individuais** após as exclusões abaixo, incluindo este relatório. O conjunto do checkpoint tem **167 arquivos** (25 modificados + 142 novos).
- Três entradas aparecem como `M` por stat obsoleto, mas têm blob idêntico ao `HEAD`: `.gitignore`, `frontend/.env.example` e `frontend/src/vite-env.d.ts`. Não são mudanças de conteúdo.
- Varredura textual dos candidatos não encontrou credenciais reais. `backend/config/database.env.example` contém apenas `SUBSTITUA_PELA_SENHA_URLENCODED`; os testes usam senhas fictícias e os documentos usam placeholders. Dumps e `.env` estão fora do checkpoint.
- O checkpoint precisa incluir também `backend/prisma/migrations/20261031000000_rf004_fix_permissions/` e `20261102000000_update_products_source_identity_constraint/`, que ainda não estão no `HEAD`.

### 15.2 Incluir

- As 5 migrations e o `migration_lock.toml`.
- `backend/docs/**`, `backend/src/**`, `backend/tests/**`, `backend/scripts/**`, `backend/package.json`, `backend/tsconfig*.json`, `backend/vitest.integration.config.mts`.
- `frontend/src/**`, `frontend/tests/**`, `frontend/docs/**`, `frontend/package.json`, `frontend/tsconfig.json`.
- `.gitattributes`.
- Relatórios `RELATORIO-ENTREGA-3D.2.11.md` a `RELATORIO-ENTREGA-3D.3.10.md`, incluindo o adendo.
- `README.md` e `backend/.env.example` já estão iguais ao baseline; não entram como alteração.

### 15.3 Excluir

| Caminho/pattern | Motivo |
|---|---|
| `$testRunner` | Artefato local de 7 bytes (link). |
| `*Calil-Notebook*` | Cópias de comparação/reconciliação, não são o projeto ativo. |
| `backend/data/` | Dados locais (`Exportacao-produtos.xlsx`). |
| `backend/changes.diff` | Diff gerado. |
| `backend/vitest-report.json` | Relatório gerado. |
| `analise-fechamento.txt`, `dry-run-recovery.txt` | Saídas de análise. |
| `ambiguidades.json`, `ausentes.json`, `candidatos.json`, `mapeamento.json`, `mapeamento-25-produtos.json`, `produtos_banco.json`, `reconciliation-output.json`, `sem_correspondencia.json`, `validacao-vinculos.json` | Dados de reconciliação. |
| `*.dump`, `.env`, `.env.*`, logs, `dist/`, `coverage/`, `node_modules/` | Segredos/artefatos; já cobertos pelo `.gitignore` ou pela lista de exclusão. |

### 15.4 Comandos preparados (NÃO executados)

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital

git add -A -- . `
  ':(exclude)*Calil-Notebook*' `
  ':(exclude,literal)$testRunner' `
  ':(exclude)backend/data' `
  ':(exclude)backend/changes.diff' `
  ':(exclude)backend/vitest-report.json' `
  ':(exclude)analise-fechamento.txt' `
  ':(exclude)dry-run-recovery.txt' `
  ':(exclude)ambiguidades.json' `
  ':(exclude)ausentes.json' `
  ':(exclude)candidatos.json' `
  ':(exclude)mapeamento.json' `
  ':(exclude)mapeamento-25-produtos.json' `
  ':(exclude)produtos_banco.json' `
  ':(exclude)reconciliation-output.json' `
  ':(exclude)sem_correspondencia.json' `
  ':(exclude)validacao-vinculos.json'
```

Conferência antes do commit:

```powershell
git status --short
git diff --cached --name-only | Measure-Object -Line
git diff --cached --stat
```

Confirmar que a lista não contém itens proibidos (o comando deve retornar vazio):

```powershell
git diff --cached --name-only | Select-String -Pattern `
  'Calil-Notebook|\$testRunner|backend/data/|changes\.diff|vitest-report|analise-fechamento|dry-run-recovery|ambiguidades|ausentes|candidatos|mapeamento|produtos_banco|reconciliation-output|sem_correspondencia|validacao-vinculos|\.dump$'
```

Commit sugerido (somente após revisão e autorização):

```powershell
git commit -m "feat: entrega 3D.3.10 com privilégios mínimos, fixtures e restauração isolada"
```

Não há remoto; não executar `git push`. Nenhum comando de stage ou commit foi executado nesta entrega.

## 16. Riscos e limitações

1. **ACL real não comprovada.** A quinta migration não foi aplicada. Pelas ACLs lidas na 3D.3.9, `cardapio_test_app` ainda pode manter `INSERT/UPDATE/DELETE` em `admins/categories/products` e o default ACL pode conceder DML a tabelas novas. O teste de ACL da suíte deve falhar até a aplicação.
2. **CONNECT herdado por `PUBLIC`.** Enquanto Dev/Shadow concederem `CONNECT` a `PUBLIC`, `cardapio_test_fixtures` herdará o acesso; o provisionamento aborta. A correção exige autorização separada (migration nesses bancos, `REVOKE` de `PUBLIC` ou `pg_hba.conf`).
3. **Backup ausente.** Sem dump e hash confiáveis, a restauração não pode ser provada. O hash da 3D.3.9 não é reconferível.
4. **Suíte real não executada.** Express/rotas/services/Prisma reais contra Test continuam não exercitados; os testes atuais são mocks/estáticos.
5. **Migration sem rollback versionado.** A quinta migration não tem script inverso. Reverter exigiria uma correção revisada e autorizada; não usar `migrate reset` ou `resolve`.
6. **Dev fora do wrapper.** `prisma-run.ts` só permite `migrate deploy` no Test. O ramo Dev da migration não pode ser aplicado pela via atual.
7. **`cardapio_migrator` sem `CREATEDB`.** O plano de restauração exige uma role administrativa autorizada; não elevar o migrator.
8. **Checkpoint grande.** O `git add` proposto inclui 142 arquivos não rastreados de várias entregas. A lista de exclusão precisa ser conferida antes do commit para não versionar dados de reconciliação, cópias Notebook, dumps ou segredos.
9. **Stat obsoleto.** `.gitignore`, `frontend/.env.example` e `frontend/src/vite-env.d.ts` podem aparecer como `M` sem diferença de blob; não tratar como alteração.
10. **Rate limiting em memória.** Os baldes são por processo; uma implantação com múltiplas instâncias não os compartilha. É uma limitação conhecida, não alterada nesta entrega.
11. **Segredo de fixtures.** `fixtures-test.env` nunca pode entrar no repositório, no OneDrive, em log ou em relatório.

## 17. Procedimentos futuros de execução

Cada operação abaixo exige **autorização específica**; nenhuma foi executada.

### Operação A — Checkpoint Git

1. Revisar o inventário da seção 15.
2. Executar o `git add` com as exclusões, conferir `git diff --cached` e só então o `git commit`.
3. Não há remoto; não há push.

### Operação B — Novo backup e aplicação da quinta migration no Test

1. Gerar novo dump do Test com autorização, fora do OneDrive/repositório; registrar SHA-256 e versão 18.6.
2. Inspecionar com `pg_restore --list` e, se desejado, provar a restauração pelo plano da seção 6.
3. Conferir o estado:

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
npm run db:migrate:status:test
```

4. Aplicar somente no Test, com a confirmação explícita:

```powershell
$env:CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION = 'APPLY_CARDAPIO_DIGITAL_TEST'
npm run db:migrate:deploy:test
Remove-Item Env:CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION
```

5. Conferir que a quinta migration está concluída, com o checksum esperado, e que não há migration pendente ou revertida. Parar em qualquer divergência.

### Operação C — Provisão da role de fixtures

Pré-requisito: resolver o `CONNECT` de `PUBLIC` em Dev/Shadow com autorização separada (ou isolar por `pg_hba.conf`). Depois, com role administrativa local `SUPERUSER`:

```powershell
psql -X -h 127.0.0.1 -p 5432 -U <role_administrativa> -d cardapio_digital_test `
  -v ON_ERROR_STOP=1 -f docs/sql/provision-test-fixtures.sql

# psql interativo; \password lê do terminal, sem eco.
psql -X -h 127.0.0.1 -p 5432 -U <role_administrativa> -d cardapio_digital_test
\password cardapio_test_fixtures
\i docs/sql/enable-test-fixtures-login.sql
\i docs/sql/verify-test-fixtures.sql
\q
```

Criar `fixtures-test.env` fora do repositório, com a URL da role de fixtures, e restringir a ACL do arquivo ao usuário do Windows. Nunca colar a senha no chat ou no relatório.

### Operação D — Execução real da suíte de integração

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
$env:NODE_ENV = 'test'
$env:DB_PROFILE = 'app-test'
$env:RUSTIKA_DB_INTEGRATION = '1'
$env:RUSTIKA_DB_INTEGRATION_CONFIRM = 'WRITE_CARDAPIO_DIGITAL_TEST'
npm run test:integration:db
Remove-Item Env:RUSTIKA_DB_INTEGRATION, Env:RUSTIKA_DB_INTEGRATION_CONFIRM, Env:NODE_ENV, Env:DB_PROFILE
```

Se interrompida, rodar `npm run test:integration:db:cleanup` (dry-run) e depois `-- --execute`. Conferir resíduo zero e o resultado do teste de ACL da aplicação. Sem a migration aplicada, esse teste deve falhar — é o comportamento esperado.

### Operação E — Prova de ACL e restauração

1. Executar `backend/docs/sql/verify-test-fixtures.sql` no Test e registrar as violações (deve retornar zero).
2. Executar as consultas de inspeção da 3D.3.9 no Test/Dev/Shadow e comparar com a matriz.
3. Com um dump novo e hash aprovado, seguir `backend/docs/restore-backup.md`: criar `cardapio_restore_check_*`, restaurar com `--no-owner --no-privileges --single-transaction --exit-on-error`, validar com `verify-restore.sql` e remover o banco descartável.
4. Registrar os resultados; só então reclassificar a entrega.

## 18. Parecer final

**PARCIAL.**

A parte preparatória está concluída e verificável: quinta migration escrita e testada estaticamente, matriz de privilégios documentada, role de fixtures provisionável de forma fail-closed, plano de restauração isolado, suíte de integração endurecida, 27 testes backend e 1 frontend adicionados, typecheck e builds aprovados. Nada foi escrito em banco, nenhuma role foi criada, nenhuma restauração foi executada e nenhum commit foi feito.

A entrega **não** pode ser classificada como CONCLUÍDA porque:

- a quinta migration não foi aplicada e a ACL real não foi comprovada;
- a role `cardapio_test_fixtures` não existe e o provisionamento está bloqueado pelo `CONNECT` de `PUBLIC` em Dev/Shadow;
- a suíte real `*.integration.ts` não foi executada;
- o dump da 3D.3.9 está ausente e a restauração não foi provada.

Para converter o parecer em CONCLUÍDA: executar as Operações A a E com autorização, registrar hashes, ACLs efetivas, resultado da suíte e da restauração, e confirmar que nenhuma operação tocou Dev/Shadow/Test fora do escopo aprovado.
