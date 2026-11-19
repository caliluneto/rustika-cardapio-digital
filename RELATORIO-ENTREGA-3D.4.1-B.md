# RELATÓRIO DE ENTREGA — ETAPA 3D.4.1-B
Revisão técnica, integração PostgreSQL e preparação da publicação segura

Data: 2026-11-05. Original em `3b857ad` (sem remoto, índice vazio); snapshot em `b09c084`, árvore limpa e **não tocado**.
Não houve commit, push, migration, seed, Playwright, workflow nem escrita em banco. Nenhum item abaixo declara a operação de pedidos aprovada no banco.

## 1. Auditoria das rotas
Revisados `orderOperations.service.ts` e `access.routes.ts`: `expectedStatus`/`toStatus` validados contra `ORDER_STATUSES` (400 `INVALID_STATUS`); corpo estrito; `canTransitionOrder` único (máquina de estados não alterada);
filtro ativo + ordem determinística + teto 100; CAS `updateMany WHERE id AND status=expected`; histórico na mesma transação; 409 (`STATUS_CONFLICT`/`ORDER_CONFLICT`), 422, 404, 500 genérico.
Idempotência: repetir a mesma requisição devolve 409 e **não** duplica histórico (decisão documentada; não é "200 idempotente"). **Nenhum defeito de lógica encontrado** no serviço; nada alterado nele.
Achados corrigidos (fora do serviço): (a) `ordersFor` do harness não ordenava o histórico — leitura do segundo registro poderia variar no PostgreSQL real → `orderBy createdAt, id`; (b) o logout só desmontava o painel depois do POST → agora `loggingOut` desmonta o painel (para o polling) **antes** do POST.

## 2. Auditoria de concorrência
Serializable + CAS + reautenticação dentro da transação; `P2034` repetido até 2×, depois 409. Duas requisições concorrentes não concluem a mesma transição: a segunda lê o novo status (409) ou perde o CAS/serialização (409/`ORDER_CONFLICT`). Provado com duplo transacional (orquestração).
Prova real: `order-operations.integration.ts` (agora com 8 requisições idênticas simultâneas: 1×200, 7×409, histórico único) — **preparado, não executado**.

## 3. Migration e privilégios
`20261105000000_order_status_update_privilege` revisada (sem alteração; SHA `3d6a7a6d…1d84`). Sintaxe: parser real do PostgreSQL (libpg-query, offline, scratchpad) — script e corpo PL/pgSQL aprovados.
Compatibilidade PG18: usa só catálogos/funções estáveis (`has_column_privilege`, `has_any_column_privilege`, `aclexplode`); guarda exige PG ≥ 17. Privilégios existentes (da migration anterior): SELECT/INSERT em `orders`/`order_status_history`/`order_items`, SELECT em `order_items` para releitura — suficientes para CAS + histórico + releitura; o `INSERT` do histórico não exige `REFERENCES` (FK é verificada com a identidade do dono).
GRANT único: `UPDATE (status, updated_at) ON public.orders`. Sem DELETE/TRUNCATE/UPDATE de tabela/GRANT OPTION; pós-condição na mesma transação; `ALTER DEFAULT PRIVILEGES` não usado. Prisma: o `UPDATE` do `updateMany` emite só `status` e `updated_at` (`@updatedAt`) → coberto. `migrate deploy`: mesmo padrão BEGIN/COMMIT da migration anterior; vale só para o banco do nome permitido (Test/Dev), aborta nos demais.
Ressalva: `docs/sql/inspect-*.sql` usa `information_schema.role_table_grants` (nível de tabela) e **não mostra** o privilégio por coluna; a prova de coluna está em `PERMISSIONS_SQL`/`security.integration.ts`. Registrado como limitação, sem alteração.

## 4. Preflight de seis migrations
`EXPECTED_MIGRATIONS` tem 6 entradas (validação exata por nome e checksum, não genérica). Novos testes: lista literal das 6 com checksums + diretório em disco igual (rejeita migration desconhecida); preflight aprova 6, aborta com 5 (sexta pendente), 7 (desconhecida extra), nome trocado, checksum gravado ou de disco divergente.
Verificados sem contagem fixa: `inspect-e2e-state`/`e2e-state-contract`/`validate-e2e-state` (exigem apenas migrations finalizadas, sem reverter), `ci.yml`, harness. Documentação atualizada (README, `e2e-real.md`, `integration-db.md`, `lifecycle.ts` comentário). `provision-test-fixtures.sql` continua exigindo a migration 5 (correto, a 6 vem depois).

## 5. Testes de integração (revisão)
`order-operations.integration.ts` cobre: runtime role; UPDATE permitido em `status`/`updated_at`; negado em `customerName`, `totalAmount`, `notes`, `customerPhone`, `orderNumber`, `tableOrReference`, `order_items`, histórico (update/delete), DELETE e TRUNCATE; cadeia válida; transição inválida (422) e divergência (409); 2 e 8 requisições concorrentes; rollback no banco (FK inexistente desfaz status+histórico — prova da atomicidade do PostgreSQL, não de uma falha forçada do serviço); CAS no banco (`count: 0`); nenhum outro dado do pedido muda. `tsc` limpo. Não executado.

## 6. E2E ampliado
Passo 7 preservado e opt-in. Disponibilização no CI: novos inputs booleanos `run_integration` (padrão false), `run_playwright` (padrão true), `run_order_ops` (padrão false). Dois passos Playwright mutuamente exclusivos; `RUSTIKA_E2E_ORDER_OPS: enabled` é constante e existe **somente** no env do passo ampliado (nunca no job, nem em backend/frontend; teste de regressão). O setup lê a variável, grava `journey.orderOps` no manifesto e o teardown verifica `IN_PREPARATION` + 2 históricos do admin da execução; sem ela, comportamento antigo. Fluxo coberto: fixtures sintéticas → login admin → pedido do cliente → admin vê → muda status → conflito/422 rejeitados → teardown remove só a execução → inspeção final e validação de resíduo zero (passos já existentes do job).
Integração roda **antes** do Playwright (priorização pedida). Nenhuma migration automática em banco persistente: o único `db:migrate:deploy` do workflow é o do banco efêmero, com confirmação `APPLY_CARDAPIO_DIGITAL_TEST` (testado). Job continua só por `workflow_dispatch`, repositório privado, nunca PR/push.

## 7. Testes frontend
117 passando (inclui nova asserção: painel desmontado antes do POST de logout; sessão obrigatória; sem WebSocket; polling sem sobreposição e parado na desmontagem; 401 encerra; 409 tratado; ações só por `allowedTransitions`; dados mínimos). Layout geral não alterado. Build ok.

## 8. Testes backend
812 passando, 7 ignorados (integração), 39 arquivos. `tsc --noEmit`: 2 erros legados em `tests/scripts/verify-fixtures-rotation.ts` (sem `@types/pg`; import inexistente), nenhum novo. Build ok.

## 9. Arquivos corrigidos nesta etapa
`tests/integration-db/support/fixtures.ts` (ordem do histórico), `tests/integration-db/order-operations.integration.ts`, `tests/integration-db-support.test.ts`, `tests/scripts/order-status-privilege-migration.test.ts`, `.github/workflows/ci.yml` (+inputs/passos, aditivo), `tests/ci-config.test.ts`, `frontend/src/pages/AdminDashboard.tsx`, `frontend/tests/admin-orders.test.mjs`, `lifecycle.ts` (comentário), `README.md`, `docs/{e2e-real,integration-db}.md`.

## 10. Manifesto de transferência
`manifest-3d41b-transfer.txt` (34 arquivos; 7 de código novo/serviço, migration, testes, frontend, docs, `ci.yml`). Excluídos de propósito: `README.md` (o do snapshot é o publicado e já difere; não tem a linha de contagem), os quatro testes sensíveis, relatórios `RELATORIO-*`, `manifest-*.txt`, `*-Calil-Notebook*`, `.env`, segredos, backups, planilha.
Varredura de segredos nos 34 arquivos: só modelos de URL com `%s`, valores fictícios de teste de redação e cabeçalhos de `ALTER ROLE … :'var'`; nenhuma credencial real. Os quatro testes com valor sensível seguem **sem alteração** (`git diff` vazio) e não entram no manifesto.

## 11. Diferenças original × snapshot (pré-transferência)
Todos os arquivos do manifesto existentes no snapshot diferem **apenas pelas adições da 3D.4.1/3D.4.1-B** (diffs de 1 a 50 linhas, sem remoções no `ci.yml`: `diff` mostra 0 linhas removidas, logo FIX01/FIX02 preservados); 10 arquivos são novos. `ci.yml` do snapshot **não** é sobrescrito por versão antiga: a cópia parte da versão idêntica ao snapshot + adições. Sanitização necessária: nenhuma nos arquivos do manifesto.

## 12. Resultados locais
Backend 812/819 (7 ignorados); frontend 117/117; builds ok; YAML do `ci.yml` válido, 27 blocos `run` com `bash -n` sem erro; SQL validado offline; sintaxe do Playwright (transpilação) ok; integridade FIX01/FIX02 por hash e `ci-config` 42/42.

## 13. Riscos restantes
Isolamento Serializable, rollback e ACL por coluna **sem prova real**; suíte `test:integration:db` nunca rodou no CI (pode revelar falhas antigas nos testes de integração existentes, independentes desta etapa); duração do job (timeout 30 min) com integração + Playwright; sessões e limites em memória; disponibilidade de produtos (3D.4.2) ainda bloqueia pedidos reais; inspeção SQL por tabela não enxerga ACL de coluna.

## 14. Procedimento no CI (proposto; **não executado**)
1. Copiar os 34 arquivos ao snapshot (comandos abaixo), conferir hashes, rodar `npm run test:ci`/`typecheck`/`build` e `npm test`/`build` no snapshot.
2. Commit com arquivos nomeados; `git push --no-tags origin main:main`.
3. Disparar `workflow_dispatch` (repositório privado): **1ª rodada** `run_e2e=true`, `run_integration=true`, `run_playwright=false` → valida as 6 migrations, ACL e operação de pedidos; **2ª rodada** (só se a 1ª passar) `run_e2e=true`, `run_playwright=true`, `run_order_ops=false` → jornada original; **3ª** com `run_order_ops=true` → jornada ampliada. Cada rodada termina com inspeção de estado final e prova de resíduo zero.

```bash
O=/c/Users/u1n3c/OneDrive/Documentos/Cardapio_Digital; S=/c/Users/u1n3c/RustikaPublish/cardapio-digital-snapshot
cd "$S" && git status --short   # deve estar vazio
while IFS= read -r f; do mkdir -p "$(dirname "$S/$f")" && cp "$O/$f" "$S/$f"; done < "$O/manifest-3d41b-transfer.txt"
while IFS= read -r f; do [ "$(tr -d '\r' < "$O/$f" | sha256sum)" = "$(tr -d '\r' < "$S/$f" | sha256sum)" ] || echo "HASH DIFERE $f"; done < "$O/manifest-3d41b-transfer.txt"
git status --short
```

```bash
cd /c/Users/u1n3c/RustikaPublish/cardapio-digital-snapshot
git add -- $(tr '\n' ' ' < /c/Users/u1n3c/OneDrive/Documentos/Cardapio_Digital/manifest-3d41b-transfer.txt)
git diff --cached --stat && git diff --cached --name-only | wc -l   # esperado: 34
git commit -m "feat: gestao administrativa de pedidos (3D.4.1) com preflight de 6 migrations" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push --no-tags origin main:main
```

## 15. Próxima autorização necessária
Autorizar: (1) transferência ao snapshot + commit + `push main:main` com o manifesto acima; (2) disparo das três rodadas do workflow na ordem indicada. Não autorizados e não pedidos aqui: migration em banco persistente, Playwright local, mesclar históricos. Após o CI, rodar a substituição sintética dos quatro testes sensíveis e a etapa 3D.4.2.

---
## APROVADO LOCALMENTE
Lógica do serviço/rotas (testes com duplo), preflight exato de 6 migrations, ACL estática, migration (sintaxe offline), frontend, workflow (YAML/shell/regressão), manifesto sem segredos, testes sensíveis intactos.
## PREPARADO PARA CI
Integração PostgreSQL (`run_integration`), E2E ampliado (`run_order_ops`), rodadas em 3 fases, comandos de staging/commit/push.
## NÃO EXECUTADO
Migration (qualquer banco), testes de integração reais, Playwright, workflow, cópia ao snapshot, commit, push.
## BLOQUEADO
Operação de pedidos "aprovada no banco" (aguarda integração real); uso real de pedidos (aguarda 3D.4.2); substituição dos quatro testes sensíveis (aguarda autorização).
