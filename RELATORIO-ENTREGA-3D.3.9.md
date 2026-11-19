# RELATÓRIO DA ENTREGA 3D.3.9

Preparação da integração real: PostgreSQL Test, comandas e pedidos

Data: 03/11/2026 (America/Sao_Paulo)
Executor: Claude Code, nativo no Windows 11 (Node v24.20.0, PostgreSQL 18.6)
Bases: `RELATORIO-ENTREGA-3D.3.7.md`, `RELATORIO-ENTREGA-3D.3.8.md`, `backend/docs/access-api.md`, `backend/docs/orders-api.md`, `backend/prisma/schema.prisma`

**Parecer: CONCLUÍDA** (preparação). A validação real com persistência continua pendente das Operações B e C, que exigem autorização.

## Separação das evidências

| Categoria | O que entra |
|---|---|
| **Testes com mocks aprovados** [EXEC] | Backend 530/530 e frontend 81/81, incluindo 54 testes novos no backend e 15 no frontend |
| **Testes reais preparados, NÃO executados** | 4 arquivos `*.integration.ts` com Express, rotas, services e Prisma reais contra `cardapio_digital_test` (seção 5). Só a trava de entrada foi exercitada, sem conexão |
| **Verificações reais somente leitura** [EXEC] | `SELECT` no Test em transação `READ ONLY` (perfil `migrate-test`), `npm run db:migrate:status:test`, inspeção do arquivo de backup e geração offline do script SQL do dump |
| **Operações que exigem autorização** | A: checkpoint Git. B: teste de restauração, `migrate deploy` em Test e ACL. C: criar a role de fixtures e rodar a suíte real (seção 16) |

Nenhuma migration, Seed, restore, criação ou exclusão de banco, fixture persistida, POST no Dev, alteração de ACL, credencial ou `.env`, nem commit.

---

## 1. Estado inicial [EXEC]

| Item | Valor |
|---|---|
| Git | `main`, commit único `1e80bdb`, sem remote; 130 entradas no `git status` (14 ` M`, 116 `??`) |
| Baseline SHA-256 | 202 arquivos, gravado fora do repositório antes de editar |
| Alterações da 3D.3.8 | presentes (`writeGuard.ts`, `accessLimits.ts`, `order.routes.ts`, cliente HTTP, telas, testes) |
| `.gitattributes` | presente: `backend/prisma/migrations/** -text` |
| Migrations | as 4 e o `migration_lock.toml` com SHA-256 iguais aos registrados |
| Backup Test | `C:\Users\u1n3c\AppData\Local\RustikaBackups\cardapio_digital_test_pre3d38_20261104-012137.dump`, SHA-256 `1be946052157…925265` (igual ao da 3D.3.8) |
| Não rastreados essenciais | os 21 do grupo E1 (3D.3.7, seção 32), mais os arquivos criados na 3D.3.8 e nesta entrega (seção 13) |

---

## 2. Arquivos alterados

| Arquivo | Estado | Mudança |
|---|---|---|
| `backend/src/security/accessLimits.ts` | alterado | Depósito separado para bloqueados; chave IPv6 por /64; varredura periódica; `rateLimitAddress` |
| `backend/tests/security/accessLimits-adversarial.test.ts` | novo | 22 testes adversariais e de concorrência |
| `backend/tests/integration-db/**` (10 arquivos) | novos | Suíte real preparada: travas, fixtures, harness, 4 arquivos de cenários, limpeza de resíduos |
| `backend/tests/integration-db-support.test.ts` | novo | 32 testes com mocks das travas, do preflight e da limpeza |
| `backend/vitest.integration.config.mts` | novo | Config isolada da suíte real |
| `backend/package.json` | alterado | Scripts `test:integration:db` e `test:integration:db:cleanup` |
| `backend/docs/integration-db.md` | novo | Desenho, role de fixtures proposta, limpeza, execução |
| `backend/docs/orders-api.md` | alterado | Seção de limites revisada (bloqueados, /64, reinício, risco residual) |
| `frontend/src/services/orderSubmission.ts` | alterado | Tentativa compartilhada entre montagens, trava de envio incerto, `retryPending`, `comandaSessionUsable` |
| `frontend/src/pages/Checkout.tsx` | alterado | 401 invalida a sessão local; botão "Reenviar pedido anterior"; checa expiração |
| `frontend/src/components/OrderReview.tsx` | alterado | Só oferece envio com sessão não expirada |
| `frontend/tests/order-recovery.test.mjs` | novo | 15 testes |
| `frontend/package.json` | alterado | Novo arquivo de teste no script |
| `RELATORIO-ENTREGA-3D.3.9.md` | novo | Este relatório |

Não alterados: código de produção de rotas, services, domínio, `schema.prisma`, migrations, `config/database-profiles.json`, `src/config/secrets.ts`, `.env`.

---

## 3. Revisão e correções do rate limiting

| Ponto verificado | Achado | Ação |
|---|---|---|
| Saturação de 10 000 chaves | Desde a 3D.3.8, não bloqueia clientes novos | Mantido |
| **Descarte de entradas antigas** | **Falha confirmada**: o descarte do mais antigo podia apagar o contador de quem já estava bloqueado. Bastava inundar o limitador com chaves descartáveis | **Corrigido**: chaves que atingem o limite vão para um depósito próprio, que a chegada de chaves novas não esvazia |
| **Reciclagem de chaves por IPv6** | **Falha confirmada**: cada endereço IPv6 era um balde; quem controla um /64 cria bilhões de baldes sem custo | **Corrigido**: chave de IPv6 = prefixo /64; IPv4 mapeado (`::ffff:`) = IPv4 |
| Expiração | Ativos removidos em ordem; bloqueados varridos no máximo 1 vez/s e ao encher | Corrigido (um teste antigo pegou bloqueados vencidos ainda contados) |
| Depósito de bloqueados cheio | Sai quem tem a penalidade mais perto do fim; encher custa `max` requisições por chave | Novo |
| Vários IPs | Cada IP ou /64 tem o seu balde | Testado |
| Reutilização de sessão | A mesma sessão usada de vários IPs continua no mesmo balde por sessão | Testado |
| Limites por sessão e IP | 10/5 min por sessão, 30 falhas/5 min por IP, 300/5 min por IP | **Mantidos** |
| Concorrência | Operações síncronas no laço de eventos: 20 envios paralelos com limite 5 → exatamente 5 × 201 e 15 × 429 | Testado |
| Reinício do processo | Zera contadores e sessões confirmadas (memória) | Documentado como risco aceito; persistência exige store externo, sem Redis nesta fase |
| Risco residual | Contador **abaixo** do limite ainda pode sair quando os ativos enchem; explorar exige mais de 10 000 IPv4 ou /64 por janela | Documentado em `orders-api.md` |

Testes novos (22): inundação não zera bloqueado; inundação não bloqueia legítimo; depósito de bloqueados limitado; expiração dos bloqueados; janela preservada ao mudar de depósito; memória limitada com 50 mil chaves; 8 casos de normalização de endereço; mesmo /64 versus outro /64; rajada paralela; sessão em vários IPs; rotação dentro do /64; teto de IP por /64; IPv4 mapeado; inundação de cookies inválidos de muitos IPs; sessão confirmada em IP bloqueado.

---

## 4. Infraestrutura de fixtures preparada

- **Perfil de dados de teste estudado**: role dedicada `cardapio_test_fixtures`, só no banco Test, com `SELECT/INSERT/UPDATE/DELETE` nas tabelas de cadastro e acesso, `SELECT/DELETE` em pedidos, itens e histórico. Sem `TRUNCATE`, sem `CREATE`, sem acesso a `_prisma_migrations`, sem Dev ou Shadow. SQL e rollback propostos em `backend/docs/integration-db.md`. **Não criada.**
- Segredo: `fixtures-test.env` na pasta de segredos existente, fora do repositório. O loader recusa outro banco, outro usuário, host não local e chaves extras. `app-dev` e `migrate-dev` nunca são usados; o perfil de fixtures não existe para `prisma-run.ts` nem para o runtime.
- Dados fictícios e identificáveis por execução (`fixture-3d39-<runId>`): administrador ativo e inativo (senha gerada na hora, só em memória), categoria pública, produto numérico, PA062240, produto interno, indisponível, sem confirmação e de preço alterável, comanda fechada, mais auxiliares para convite expirado ou revogado e sessão revogada ou expirada. Comandas abertas, convites, sessões e pedidos nascem pela API real.
- Faixa de comandas reservada por execução (10 números `9xxxxN`); códigos numéricos derivados do `runId`; uma execução por vez via `pg_try_advisory_lock`.
- **Limpeza** escopada por execução, filhos antes dos pais, numa transação, sem `TRUNCATE` e sem `DELETE` sem filtro. O plano é testado com mocks; o `afterAll` confere resíduo zero; há um utilitário de resíduos com dry-run.
- **Nada foi inserido no PostgreSQL.**

## 5. Testes de integração implementados (preparados, não executados)

| Arquivo | Cenários |
|---|---|
| `auth.integration.ts` | login válido com cookie HttpOnly/Strict em `/api/admin`; credenciais inválidas (senha, e-mail inexistente, conta inativa); sessão ausente; sessão expirada (relógio + 61 min); logout revoga; Origin, header e Content-Type |
| `comandas.integration.ts` | emissão e resgate com estado persistido (hash, `consumed_at`, 1 sessão, cookie Lax em `/api`); convite usado duas vezes; 5 resgates simultâneos → um 201; convite expirado; revogado; expiração pela validade pedida; comanda fechada 409; sessão revogada; sessão expirada; comanda fechada após o resgate; isolamento entre comandas |
| `orders.integration.ts` | produto público com pedido, itens com snapshot e histórico `RECEIVED` persistidos; PA062240 = 5000; interno rejeitado; indisponível e sem confirmação; preço alterado no banco; 4 quantidades inválidas; `Idempotency-Key` repetida; mesma chave com corpo diferente; 8 cliques simultâneos → 1 pedido; reenvio após resposta perdida; item inexistente sem gravar nada; **falha forçada depois do INSERT com rollback real**; resposta igual ao estado persistido |
| `security.integration.ts` | 4 variações de CSRF ou Origin; sessão inexistente; rate limit com banco real; envios simultâneos com chaves diferentes; mesma chave em duas instâncias do app; a role da app não apaga nem altera pedidos; matriz mínima de privilégios; verificação de limpeza |

Todos os arquivos conferem, no `afterAll`, que nenhuma linha da execução ficou no banco.

## 6. Proteções de identidade do banco

Quatro camadas, todas antes da primeira escrita:

1. **Nome dos arquivos**: `*.integration.ts` está fora do padrão do `npm test`, e não existe `vitest.config.ts`. Testado.
2. **Variáveis**: `RUSTIKA_DB_INTEGRATION=1` e `RUSTIKA_DB_INTEGRATION_CONFIRM=WRITE_CARDAPIO_DIGITAL_TEST`, mais `NODE_ENV=test`, `DB_PROFILE=app-test` e a ausência da confirmação de deploy. Verificadas no `globalSetup` e em cada arquivo.
3. **Preflight** com SELECTs e advisory lock: banco exato `cardapio_digital_test` nas três conexões; roles exatas; sem superuser ou bypassrls; PG ≥ 17; 4 migrations concluídas com checksums esperados (lidos em `READ ONLY`); arquivos no disco iguais; sem resíduos; sem PA062240 real; lock obtido.
4. **Runtime**: a app usa `createPrismaRuntime('app-test')`, que já recusa outro banco ou role com `NODE_ENV=test`.

Provas [EXEC]: `npm run test:integration:db` **sem** as variáveis abortou no `globalSetup` com `IntegrationAbort`, sem abrir conexão. `vitest list` confirmou que a config encontra os 4 arquivos. Com mocks, 9 testes cobrem a trava de ambiente e 16 cobrem o preflight, que aborta em cada desvio, **inclusive no estado atual do Test** (1 aplicada, 3 pendentes).

## 7. Estado do backup [EXEC, só o arquivo]

| Item | Resultado |
|---|---|
| Arquivo e caminho | Existe; fora do OneDrive e do repositório |
| SHA-256 | `1be946052157a2c54b7af979c9c174e0d41d70cfaab9abc9b5de90663f925265` (igual ao registrado) |
| Formato | `PGDMP`, archive 1.16.0, CUSTOM, gzip, 20 928 bytes |
| Versões | `Dumped from database version: 18.6`, `Dumped by pg_dump version: 18.6`; `pg_restore` 18.6 |
| Identidade | `dbname: cardapio_digital_test`; 7 tabelas iguais às do banco; `_prisma_migrations` com a linha `20261023000000_initial_schema` e o checksum esperado |
| Opções usadas | `-Fc --create` (perfil `migrate-test`, sessão read-only) |

**Questão da entrada DATABASE, resolvida com evidência.** Gerei o script SQL do dump **para um arquivo**, sem conectar a banco nenhum: `pg_restore --create --file <scratchpad>\dump-create.sql`. O script contém `CREATE DATABASE cardapio_digital_test WITH TEMPLATE = template0 ENCODING = 'UTF8' LOCALE_PROVIDER = libc LOCALE = 'Portuguese_Brazil.1252'`, `ALTER DATABASE … OWNER TO cardapio_migrator`, `REVOKE CONNECT,TEMPORARY … FROM PUBLIC`, `GRANT CONNECT … TO cardapio_test_app`, 10 `OWNER TO cardapio_migrator`, os GRANTs de tabela, as 2 regras `ALTER DEFAULT PRIVILEGES` e os 7 `COPY`. Conclusão: o arquivo **tem** o necessário para recriar o banco, com dono, ACL de banco, de schema, de tabela e padrão. O `--list` apenas não exibe essas entradas. Roles **não** estão no dump (são do cluster) e nenhuma senha aparece; a única ocorrência de "password" é a coluna `password_hash`.

Procedimento de restauração em banco descartável (**não executado**, exige autorização para criar e apagar banco):

```powershell
$bin = 'C:\Program Files\PostgreSQL\18\bin'
$dump = "$env:LOCALAPPDATA\RustikaBackups\cardapio_digital_test_pre3d38_20261104-012137.dump"
# 0. conferir o SHA-256 acima
# 1. como cardapio_migrator (CREATEDB necessário, hoje rolcreatedb = false: usar role administrativa autorizada)
& "$bin\createdb.exe" -h 127.0.0.1 -U <role_autorizada> -T template0 -E UTF8 cardapio_restore_check
# 2. restaurar SEM --create (o --create recriaria cardapio_digital_test) e sem trocar donos
& "$bin\pg_restore.exe" -h 127.0.0.1 -U <role_autorizada> -d cardapio_restore_check --exit-on-error --no-owner $dump
# 3. comparar: tabelas, linha de _prisma_migrations, grants e default ACL com as consultas da seção 8
# 4. apagar o banco descartável
& "$bin\dropdb.exe" -h 127.0.0.1 -U <role_autorizada> cardapio_restore_check
```

Observação: `--no-owner` evita depender da role dona. Para conferir ACLs fielmente, omitir `--no-owner` e restaurar com uma role que possa atribuir `cardapio_migrator` como dono.

## 8. Estado das migrations [EXEC, somente leitura]

| Verificação | Resultado |
|---|---|
| Banco / versão | `cardapio_digital_test`, 18.6, `server_version_num = 180006` |
| Role de migration | `cardapio_migrator`: dona do banco e das 8 relações, `CREATE` em `public`, sem superuser, createrole, createdb ou bypassrls |
| Aplicadas | 1 (`20261023000000_initial_schema`), concluída, não revertida, checksum `1a9cd08b…` igual ao arquivo |
| Pendentes | `20261027`, `20261031`, `20261102` (`migrate status` e objetos ausentes: `comandas`, `comanda_invitations`, `comanda_sessions`, enums novos, coluna `categories.public_key`) |
| Falhas | nenhuma |
| Dados que impedem | `orders` = 0 (a trava da `20261027` passa); `products` e `categories` = 0, então as CHECKs novas validam instantaneamente |
| Roles exigidas pela `20261027` | `cardapio_test_app` e `cardapio_dev_app` existem |
| Escritores concorrentes | 0 sessões de outros usuários, 0 locks de outros processos, 0 transações preparadas |
| Checksums no disco | inalterados (`.gitattributes -text` ativo) |

**Privilégios atuais e previstos depois das migrations** (leitura de `role_table_grants` e `pg_default_acl`, cruzada com o SQL das migrations):

| Tabela | Hoje (`cardapio_test_app`) | Depois das 3 migrations (previsto) | Matriz mínima (3D.3.7) |
|---|---|---|---|
| `admins`, `categories`, `products` | SELECT, INSERT, UPDATE, DELETE | **SELECT, INSERT, UPDATE, DELETE** (nenhuma migration revoga) | SELECT |
| `orders`, `order_items`, `order_status_history` | SELECT, INSERT, UPDATE, DELETE | SELECT, INSERT (`20261027` revoga o resto) | SELECT, INSERT |
| `comandas`, `comanda_invitations` | — | SELECT, INSERT, UPDATE (`REVOKE ALL` e depois `GRANT` da `20261031`) | igual |
| `comanda_sessions` | — | SELECT, INSERT | igual |
| `_prisma_migrations` | nenhum | nenhum | nenhum |
| Default ACL de `cardapio_migrator` em `public` | tabelas: `arwd` para `cardapio_test_app`; sequências: `rU` | **inalterado** | não deveria conceder DML automático |

Este é o principal risco novo (seção 14, R-A). A própria `20261027` registra em comentário que é preciso "revisar grants herdados … e default ACLs antes de liberar a aplicação".

Comando exato da aplicação (de `backend/package.json` e `scripts/prisma-run.ts`; **não executado**):

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
npm run db:migrate:status:test
$env:CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION = 'APPLY_CARDAPIO_DIGITAL_TEST'
npm run db:migrate:deploy:test      # = tsx scripts/prisma-run.ts migrate-test migrate deploy
Remove-Item Env:CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION
npm run db:migrate:status:test
```

## 9. Revisão do frontend

| Verificação | Resultado |
|---|---|
| `VITE_ORDER_SUBMISSION` desligado por padrão | Sim: nenhuma `.env` no frontend, só o `.env.example`, sem a variável; o bundle compilado lê `undefined`, ou seja, desligado [EXEC] |
| Sem envio automático | Sim: só o `submit` do formulário e o botão de reenvio chamam a API |
| Carrinho preservado em falha recuperável | Sim: o carrinho só é limpo depois de confirmação |
| `Idempotency-Key` reutilizada só quando cabe | **Corrigido**: antes, fechar e reabrir o Checkout criava outro controlador e outra chave. Agora a tentativa fica num armazenamento em memória compartilhado. Recusa definitiva (400/401/403/404/409 ≠ `ORDER_CONFLICT`/422) descarta a chave; 429 e `ORDER_CONFLICT` mantêm a mesma chave sem marcar incerteza |
| Pedido confirmado não reenviado como novo | **Corrigido**: depois de falha de rede, timeout, cancelamento ou 5xx, a tentativa fica incerta. Mudar o pedido é recusado (`PENDING_ORDER_UNCERTAIN`) até "Reenviar pedido anterior" resolver com o corpo e a chave originais. Se já estava gravado, volta o mesmo número; o carrinho editado é mantido |
| 401/403/409/429 | Mensagens por caso; **401 agora derruba a sessão local**, e o formulário de resgate volta |
| Sessão não depende só de valores locais | Só respostas do backend criam `comandaSession`; **agora também expira pelo `expiresAt`** |
| `localStorage` | Nenhum uso no código-fonte nem no bundle [EXEC]; a tentativa pendente fica só em memória (sem nome ou telefone persistidos) |
| Pronto para a API de testes | `VITE_API_URL` configurável; o fluxo completo usa os endpoints reais |

## 10. Resultados de testes backend [EXEC]

`NODE_ENV=test`, `DB_PROFILE=app-test`, `npm test`: **25 arquivos, 530/530 aprovados** (476 + 54: 22 adversariais + 32 de travas). Só mocks; nenhuma conexão a banco. Nenhum teste removido ou enfraquecido; um teste antigo (`expiração … registros vencidos são removidos`) acusou o defeito da primeira versão da correção e foi a implementação que mudou.

## 11. Resultados de testes frontend [EXEC]

`npm test`: **81/81 aprovados** (66 + 15).

## 12. Typecheck e Build [EXEC]

| Projeto | Typecheck | Build |
|---|---|---|
| Backend | exit 0 (inclui os 10 arquivos de `tests/integration-db`) | exit 0 |
| Frontend | exit 0 | exit 0 (JS 276,25 kB, gzip 85,08 kB) |

## 13. Estado do Git [EXEC]

`main`, `1e80bdb`, sem remote, **136 entradas** (18 ` M`, 118 `??`), nenhum commit, nenhum `add`, `reset`, `clean`, `restore` ou `--renormalize`. Em relação ao início (130): +5 entradas não rastreadas (`backend/docs/integration-db.md`, `backend/tests/integration-db-support.test.ts`, `backend/tests/integration-db/`, `backend/vitest.integration.config.mts`, `frontend/tests/order-recovery.test.mjs`) e `backend/package.json` passou a modificado; este relatório soma mais uma entrada (137 ao fim). O novo teste adversarial fica dentro de `backend/tests/security/`, que já era não rastreado. Baseline: 7 arquivos com conteúdo alterado, todos listados na seção 2; migrations idênticas. Nenhum `.dump`, `.env` ou arquivo de segredo entre os não rastreados.

## 14. Riscos encontrados

| # | Risco | Gravidade | Situação |
|---|---|---|---|
| R-A | Depois das migrations, `cardapio_test_app` mantém INSERT/UPDATE/DELETE em `admins`, `categories`, `products`, e o default ACL concede DML a toda tabela nova criada pelo migrator. O mesmo padrão provavelmente existe em Dev (R7 da 3D.3.7) | Alta para produção, média para Test | Não corrigido (ACL fora do escopo). Teste de matriz mínima preparado para falhar até a correção |
| R-B | Descarte de bloqueados e IPv6 sem agrupamento permitiam contornar limites | Média | **Corrigido** |
| R-C | Fechar e reabrir o Checkout, ou editar depois de falha incerta, podia gerar pedido duplicado | Média | **Corrigido** |
| R-D | Contadores e sessões admin em memória: reinício zera | Baixa nesta fase | Documentado |
| R-E | `PA062240` é identidade fixa das fixtures: o Test não pode ter esse produto real durante a suíte | Baixa | Preflight aborta se houver |
| R-F | Fixtures exigem role nova (alteração de role e ACL) | — | Proposta documentada, não criada |
| R-G | Restauração do backup ainda não testada; `cardapio_migrator` não tem CREATEDB | Média | Procedimento pronto (seção 7) |
| R-H | Comanda criada por `upsert` exige `UPDATE` em `comandas` (3D.3.7, nota 1) | Baixa | Inalterado |

## 15. Pendências

1. Aprovar e executar o checkpoint Git (Operação A).
2. Teste de restauração do backup e `migrate deploy` em Test (Operação B), com autorização.
3. Decidir o endurecimento de ACL (R-A) antes ou logo depois do deploy: revogar `INSERT/UPDATE/DELETE` de `cardapio_test_app` em `admins/categories/products` e as regras de default ACL. Precisa de migration ou SQL próprio aprovado.
4. Criar a role `cardapio_test_fixtures` e o `fixtures-test.env` (Operação C), com autorização.
5. Rodar a suíte real e tratar o que ela apontar.
6. Produção: store compartilhado de limites e sessões, `trust proxy`, validação de `CORS_ORIGIN`.

## 16. Procedimentos futuros de execução

Nenhuma das três operações foi executada. Cada uma exige aprovação própria.

### Operação A — Checkpoint Git (exige aprovação antes de cada commit)

Pré-requisitos: `.gitattributes` já existe. Cópia externa antes:

```powershell
robocopy C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital C:\Backups\rustika\arvore-3d39 /E /XD node_modules dist /XF .env *.dump
git switch -c chore/checkpoint-3d39
```

Commits com caminhos explícitos (nunca `git add .`/`-A`), revisando `git diff --cached --stat` e conteúdo antes de cada um:

| Commit | Arquivos |
|---|---|
| C1 | `.gitattributes` |
| C2 | `backend/prisma/migrations/20261031000000_rf004_fix_permissions/migration.sql`, `backend/prisma/migrations/20261102000000_update_products_source_identity_constraint/migration.sql`. Conferir depois: `git ls-files --eol` com `attr/-text` e SHA-256 iguais |
| C3 | Backend `src`: `app.ts`, `domain/rules.ts`, `middleware/errorHandler.ts` (modificados) e `domain/orderInput.ts`, `domain/categoryPublication.ts`, `mappers/{catalog,order}.mapper.ts`, `routes/{access,catalog,order}.routes.ts`, `security/{accessLimits,adminSessions,password,writeGuard}.ts`, `services/{adminAuth.service,catalog.service,comandaAccess.service,order.service,orderSession}.ts` |
| C4 | Backend testes e docs: `tests/domain/rules.test.ts`, `tests/health.test.ts` (modificados); `tests/{access,catalog,categoryPublication,orders,orders-csrf,orders-rate-limit,integration-db-support}.test.ts`, `tests/fixtures/{access,catalog,orders}.ts`, `tests/security/*.ts`, `tests/services/*.ts`, `tests/scripts/fix-permissions-migration.test.ts`, `tests/integration-db/**`, `vitest.integration.config.mts`, `package.json`, `docs/{access-api,admin-provisioning,catalog-api,orders-api,integration-db}.md` |
| C5 | Frontend: `package.json`, `src/{App,main,AppWrapper}.tsx`, `src/components/{Catalog,CartDrawer,CatalogStatus,ComandaRedeem,ConnectionIndicator,OrderReview,ProductCard,ProductModal}.tsx`, `src/contexts/CartContext.tsx`, `src/hooks/useCatalog.ts`, `src/pages/{AdminLogin,AdminDashboard,Checkout}.tsx`, `src/services/{api,catalogAdapter,catalogSource,catalogStore,orderSubmission}.ts`, `src/types/catalog.ts`, `tests/*.mjs` (11), `docs/catalog-integration.md` |
| C6 | Scripts operacionais: os 21 de `backend/scripts/` e `backend/tests/scripts/{executor-seed-real,inspect-reconciliation,seed-dev,seed-real-corrected,seed-real}.test.ts`. Mensagem cita `--execute` contra Dev em `executor-seed-real.ts` e `publish-category-publication.ts` |
| C7 | Histórico: os `RELATORIO-ENTREGA-*.md` não rastreados (raiz e `backend/`) e `Invoke-Validacao-3D37H.ps1` |
| **fora** | Dados e reconciliação (`backend/data/Exportacao-produtos.xlsx`, `ambiguidades.json`, `mapeamento*.json`, `produtos_banco.json`, `reconciliation-output.json`, `validacao-vinculos.json`, `analise-fechamento.txt`, `dry-run-recovery.txt`) até decidir a visibilidade; resíduos (`$testRunner`, `backend/changes.diff`, `backend/vitest-report.json`, `ausentes.json`, `sem_correspondencia.json`, `candidatos.json`); nunca `.env`, `*.dump`, segredos, `dist/`, `node_modules/` |

Prova: clone local fora do OneDrive, `npm ci` e typecheck, testes e build nos dois projetos; SHA-256 das 4 migrations iguais no clone; só então a tag `checkpoint-3d39`. Parar se aparecer qualquer aviso de CRLF/LF em migration ou arquivo "fora" em `git diff --cached`.

### Operação B — Backup e migrations em Test (exige autorização específica para escrita)

1. Novo backup B0 (mesmo método da 3D.3.8) e conferência do SHA-256.
2. Teste de restauração em `cardapio_restore_check` (seção 7). Exige autorização para criar e apagar esse banco.
3. Reler o estado (seção 8): 1 aplicada, `orders` = 0, sem sessões, checksums.
4. `npm run db:migrate:deploy:test` com a variável de confirmação (seção 8).
5. Verificação pós-migration: 4 linhas em `_prisma_migrations` concluídas com os checksums da seção 1; `migrate status` "up to date"; constraint `products_source_identity_consistent` com `^[A-Za-z0-9]+$`; enum `order_status` com `CANCELLED`; privilégios conforme a coluna "previsto" da seção 8.
6. Decisão R-A (ACL) e, se aprovada, aplicação e nova verificação.
7. Backup B1 ("migrado e limpo").

Parada: qualquer pré-condição falsa, erro do deploy, migration sem `finished_at` ou checksum divergente. Nunca usar `migrate reset` ou `resolve`.

### Operação C — Integração HTTP real (exige autorização específica para escrever em Test)

1. Criar `cardapio_test_fixtures` e o `fixtures-test.env` (`backend/docs/integration-db.md`).
2. `npm run test:integration:db` com as quatro variáveis (mesmo documento). O preflight aborta sozinho se algo estiver fora do esperado.
3. Conferir: todos os cenários; persistência validada pelos próprios testes; resíduo zero no `afterAll`. Se uma execução for interrompida, rodar `npm run test:integration:db:cleanup` e depois `-- --execute`.
4. Esperado conhecido: o teste da matriz mínima de privilégios falha enquanto R-A não for resolvido.
5. Restaurar B1 para voltar o Test ao estado "migrado e limpo", se desejado (sequência `order_number`).

## 17. Parecer final

**CONCLUÍDA.** O projeto tem infraestrutura de integração real pronta para rodar depois das Operações B e C, com quatro camadas de proteção que impedem escrever fora de `cardapio_digital_test` ou antes das migrations. O rate limiting ficou resistente a inundação e a rotação de IPv6, mantendo os limites. O frontend não duplica pedidos ao reabrir o Checkout nem depois de falha incerta. O backup foi validado como arquivo e mostrou conter o necessário para recriar o banco. Testes com mocks: 530/530 e 81/81; typecheck e build aprovados nos dois projetos.

O que continua pendente de autorização: checkpoint Git, restauração de teste, `migrate deploy`, decisão de ACL (R-A), role de fixtures e execução da suíte real.

Nenhuma fase seguinte foi iniciada.
