# RELATÓRIO DE ENTREGA — ETAPA 3D.4.1
Sincronização segura, gestão administrativa de pedidos e preparação para testes reais

Data: 2026-11-05. Repositório original: `Cardapio_Digital` (HEAD `3b857ad`, sem remoto). Nenhum commit, push, workflow, migration, seed,
Playwright, alteração de credencial/`pg_hba.conf`/dados de banco persistente foi feito. Nenhuma prontidão para produção é afirmada.

## 1. Resumo executivo
- FIX01/FIX02 do snapshot foram incorporados ao original por cópia verificada por hash (sem sobrescrever trabalho divergente).
- Implementados `GET /api/admin/orders` e `PATCH /api/admin/orders/:orderId/status` (CAS + transação Serializable + histórico), reutilizando
  `canTransitionOrder`; painel "Pedidos" no admin existente; migration de privilégio **preparada e não aplicada**.
- Validado localmente **sem banco**: backend 809 testes passando (7 ignorados, os de integração), frontend 117 passando, builds ok,
  `tsc` do backend sem erros novos (2 erros legados já conhecidos em `tests/scripts/verify-fixtures-rotation.ts`).
- Testes com PostgreSQL real, migration e E2E estão **preparados e não executados**. Depende da etapa 3D.4.2 (disponibilidade de produtos) para uso real.

## 2. Backport FIX01/FIX02 (snapshot → original)
Copiados e conferidos por SHA-256 contra o snapshot (`b09c084`): `.github/workflows/ci.yml` (FIX01: `CARDAPIO_SECRETS_DIR` gravado em `$GITHUB_ENV`
a partir de `$RUNNER_TEMP`, sem `runner.temp` em `env:` de job; FIX02: `id: pg`, captura estruturada do estado final `if: always() && steps.pg.outcome == 'success'`
e prova de resíduo zero), `backend/package.json` (+`e2e:validate-state`), `scripts/inspect-e2e-state.ts` (`--out`, flag `wx`, 0600),
novos `scripts/e2e-state-contract.ts`, `scripts/validate-e2e-state.ts`, `tests/e2e-state-contract.test.ts`, `tests/ci-config.test.ts`.
Re-verificado ao final: todos coincidem com o snapshot. Os quatro testes que continham o valor sensível **não foram tocados** nem copiados.

## 3. Arquivos alterados / criados
Alterados (backend): `src/domain/rules.ts`, `src/mappers/order.mapper.ts`, `src/routes/access.routes.ts`, `tests/integration-db/{e2e/lifecycle.ts,e2e/manifest.ts,security.integration.ts,support/permissions.ts,support/preflight.ts}`,
`tests/integration-db-support.test.ts`, `tests/scripts/least-privilege-migration.test.ts`, `docs/{integration-db,orders-api,e2e-real}.md`.
Criados (backend): `src/services/orderOperations.service.ts`, `prisma/migrations/20261105000000_order_status_update_privilege/migration.sql`,
`tests/order-admin.test.ts`, `tests/fixtures/orderOps.ts`, `tests/e2e-order-ops.test.ts`, `tests/scripts/order-status-privilege-migration.test.ts`,
`tests/integration-db/order-operations.integration.ts`, `docs/order-operations.md`.
Frontend: alterados `src/services/api.ts` (+`patch`), `src/pages/AdminDashboard.tsx`, `src/index.css`, `package.json`, `tests/e2e.spec.ts`, `tests/globalSetup.ts`;
criados `src/pages/AdminOrders.tsx`, `src/services/adminOrders.ts`, `src/services/adminOrdersPolling.ts`, `tests/admin-orders.test.mjs`.
(`backend/src/middleware/errorHandler.ts`, `frontend/src/App.tsx` e dois relatórios antigos aparecem como modificados no Git apenas por diferença de fim de linha/estado herdado de etapas anteriores; sem diff de conteúdo desta etapa.)

## 4. Contratos das rotas
Detalhados em `backend/docs/order-operations.md`.
- `GET /api/admin/orders`: sessão admin, sem parâmetros (query string → 400), `no-store`, pedidos ativos, mais antigos primeiro, máx. 100 (`truncated`), campos mínimos (sem telefone/digest/idempotência/hashes).
- `PATCH /api/admin/orders/:orderId/status`: `orderId` UUID; corpo estrito `{expectedStatus, toStatus, notes?}`; proteções de escrita (Origin, `X-Rustika-Request`, JSON).
  Erros: 400 `INVALID_ORDER_ID`/`INVALID_STATUS`/`INVALID_INPUT`, 401, 404 `ORDER_NOT_FOUND`, 409 `STATUS_CONFLICT`/`ORDER_CONFLICT`, 422 `INVALID_TRANSITION`, 500 `INTERNAL_ERROR` genérico.

## 5. Serviço de listagem
`orderOperations.listActive(token)`: autentica, `findMany` por status ativo, `orderBy [createdAt asc, orderNumber asc]`, `take 101`, mapeia com `adminOrderSelect`/`mapAdminOrder` e `nextOrderStatuses`.

## 6. Serviço de atualização
`orderOperations.updateStatus(id, body, token)`: valida id/corpo (400) → transação Serializable (reautentica admin dentro) → lê status (404) → compara `expectedStatus` (409) → `canTransitionOrder` (422)
→ CAS `updateMany WHERE id AND status=expected` (count≠1 → 409) → insere histórico → relê e mapeia. Nenhum `delete/upsert/update/raw` no serviço (teste estático).

## 7. Controle de concorrência
Compare-and-set + Serializable; `P2034` repetido até 2 vezes, depois 409 `ORDER_CONFLICT`. Duas atualizações simultâneas: uma vence, a outra 409; duplo clique: 409 sem histórico duplicado.
Provado com duplo em memória (orquestração). **Isolamento real: apenas preparado para CI** (`order-operations.integration.ts`).

## 8. Histórico de status
Uma linha por transição válida na mesma transação (`fromStatus`, `toStatus`, `changedByAdminId`, `notes` aparado). Falha/rollback não deixa histórico; conflito/422/404 não gravam.

## 9. Migration preparada
`20261105000000_order_status_update_privilege` (SHA-256 `3d6a7a6d…1d84`, fixado em `EXPECTED_MIGRATIONS`, LF, transacional). **Não aplicada.** Exige o estado da migration de privilégio mínimo anterior; mesmos guardas de identidade/versão/roles; pós-condição na mesma transação.

## 10. Privilégios PostgreSQL
Concede somente `UPDATE (status, updated_at) ON public.orders` à role de runtime do banco correspondente. Sem UPDATE de tabela, DELETE, TRUNCATE, REFERENCES, TRIGGER, GRANT OPTION, ALTER/CREATE, privilégios administrativos.
Verificação de privilégios existentes: confirmada a partir da migration `20261104000000` (SELECT/INSERT em `orders`, nenhum UPDATE, nenhuma ACL de coluna). `PERMISSIONS_SQL` agora tolera **apenas** essa ACL de coluna e continua rejeitando `PUBLIC`, fixtures, outras colunas e `GRANT OPTION`.
Validação: sintaxe pelo parser do PostgreSQL (libpg-query instalado só no scratchpad, offline; DO-block parseado como PL/pgSQL) + testes estáticos. **Nenhuma conexão com banco.** Efeito colateral intencional: o preflight de integração aborta por migration pendente até a aplicação autorizada.

## 11. Painel administrativo
Seção "Pedidos" no `AdminDashboard` (só montada com sessão): comanda, cliente, referência, itens/quantidades, total, status e horários; ações = `allowedTransitions` da API; confirmação explícita (cancelar com motivo opcional);
409/422/404 → aviso + recarga; falha de rede/5xx sem detalhes; 401 → sessão local encerrada; loading/vazio/erro; polling de 10 s encadeado, sem sobreposição, cancelado na desmontagem; sem WebSocket/Socket.IO.

## 12. Testes backend
`order-admin.test.ts` (26): auth/anônimo/cookie de cliente, listagem, ordenação, limite, vazamento, query string, erro de banco sem detalhe, PATCH (id inválido, 404, corpo inválido ×14, 11 transições proibidas, cadeia válida, cancelamento, 409, duplo clique, concorrência, rollback, admin desativado, CSRF/415, ausência de DELETE/UPDATE direto).
`order-status-privilege-migration.test.ts` (8), `e2e-order-ops.test.ts`, ajustes em `least-privilege-migration`, `integration-db-support`. Total: **39 arquivos / 809 passando / 7 ignorados**.

## 13. Testes frontend
`admin-orders.test.mjs` (18): cliente (GET/PATCH, cabeçalhos, cookie, validação de resposta), mensagens de erro sem vazamento, ações por `allowedTransitions`, polling (intervalo, não sobrepõe, parada/reinício, 401 encerra), visão (loading/vazio/erro/lista/confirmação/aviso/truncado), estrutura (sem WebSocket, cleanup, proteção por sessão). Total **117/117** (99 anteriores preservados).

## 14. E2E preparado (não executado)
`frontend/tests/e2e.spec.ts` passo 7 (opt-in `RUSTIKA_E2E_ORDER_OPS=enabled`): admin vê o pedido, só ações válidas, transição pela interface com confirmação, PATCH conferido, 409 e 422 rejeitados. Manifesto ganhou `journey.orderOps`; `verifyJourney` exige IN_PREPARATION + 2 históricos do admin da execução; sem a variável tudo permanece idêntico. Sem DELETE global; resíduo zero pelo teardown existente. `ci.yml` **não** alterado.

## 15. Typecheck e builds
Backend: `tsc --noEmit` → 2 erros pré-existentes (`pg` sem tipos; import `./src/config/secrets`) em `tests/scripts/verify-fixtures-rotation.ts`, nenhum novo; `npm run build` ok. Frontend: `tsc --noEmit && vite build` ok.

## 16. Riscos e limitações
Sem paginação (roteador admin proíbe query string; teto 100); sessões/limites em memória; sem listagem de finalizados; sem notificação ao cliente; disponibilidade de produtos pendente (3D.4.2); a migration muda a postura de ACL (aprovar antes de aplicar);
os testes de concorrência/ACL reais só rodarão em CI; a regra "histórico só com CAS" depende da transação Serializable do PostgreSQL (não provada localmente).

## 17. Estado do Git original
HEAD `3b857ad`, nenhum remoto, 82 refs (`refs/cline/*`/`refs/codex/*` intactas), índice vazio, alterações apenas na árvore de trabalho. Históricos não mesclados.

## 18. Estado do snapshot
`C:\Users\u1n3c\RustikaPublish\cardapio-digital-snapshot`: HEAD `b09c084`, árvore limpa, **não modificado** nesta etapa.

## 19. Plano de transferência segura para o snapshot (não executado)
Copiar por lista fixa (sem `.git`, `.env`, segredos, backups, relatórios locais, cópias `*-Calil-Notebook*`): os arquivos dos itens 3 e 12–14 + `docs/order-operations.md` + a migration. Conferir hash origem/destino, rodar `npm run test:ci`/`npm test`/builds no snapshot,
varrer por valores sensíveis, `git status` revisado, commit com arquivos nomeados (sem `git add .`), `git push --no-tags origin main:main`. Os 4 testes sensíveis não são copiados; antes, aplicar a substituição sintética (item 20-C).
Acrescentar `RUSTIKA_E2E_ORDER_OPS: enabled` ao passo do Playwright no `ci.yml` somente com autorização (atualizar `ci-config.test.ts` junto).

## 20. Próximas autorizações
A) Transferir ao snapshot, commit/push e rodar o workflow (aplica as 6 migrations no PostgreSQL efêmero do CI, roda `order-operations.integration.ts` e o E2E com `ORDER_OPS`).
B) Aplicar a migration `…order_status_update_privilege` nos bancos persistentes (Test, depois Dev) por wrapper autorizado, com verificação de ACL.
C) Substituição sintética dos quatro testes sensíveis (paths: `backend/tests/domain/rules.test.ts`, `frontend/tests/cart.test.mjs`, `frontend/tests/checkout.test.mjs`, `frontend/tests/order-review.test.mjs`): trocar o literal por constante gerada no próprio teste, varrer por hash sem imprimir valores. Nada alterado agora.
D) Etapa 3D.4.2 — gestão de disponibilidade de produtos.

---
## IMPLEMENTADO
Backport FIX01/FIX02; rotas GET/PATCH; serviço de listagem e de atualização (CAS + Serializable + histórico); mapper administrativo sem dados sensíveis; helpers de domínio sobre a máquina existente; painel "Pedidos" com polling, confirmação e tratamento de conflito; cliente `patch`; migration de privilégio por coluna (arquivo); matriz de ACL e preflight atualizados; documentação técnica.
## TESTADO LOCALMENTE SEM BANCO
Backend 809 testes (rotas, serviço com duplo transacional/concorrência/rollback, migration estática, ACL estática, verificador E2E); frontend 117 testes; typecheck e builds; sintaxe SQL pelo parser do PostgreSQL; integridade FIX01/FIX02 por hash; quatro testes sensíveis sem alteração.
## PREPARADO PARA CI
`tests/integration-db/order-operations.integration.ts` (concorrência real, rollback, ACL por coluna); passo 7 do E2E (opt-in `RUSTIKA_E2E_ORDER_OPS`); verificação de teardown com histórico; plano de transferência ao snapshot.
## PENDENTE DE MIGRATION
`20261105000000_order_status_update_privilege` (preparada, não aplicada): necessária para qualquer PATCH real; o preflight/integração falha por "migrations pendentes" até lá.
## PENDENTE DE VALIDAÇÃO REAL
Isolamento Serializable e rollback no PostgreSQL; ACL por coluna efetiva; jornada E2E completa no navegador; polling e painel contra API real; disponibilidade de produtos (3D.4.2); substituição sintética dos testes sensíveis.
