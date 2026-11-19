# RÚSTIKA — Preparação do primeiro E2E completo (somente leitura)
Data: 05/11/2026 · Fase: 3D.3.23 (preparação) · Pedido de escrita: **nenhum**

Executado: inspeção de arquivos, processos, portas e **duas transações SQL `READ ONLY`** no `cardapio_digital_test`
(snapshot do `e2e:inspect` + detalhe dos resíduos, com colunas de hash/token omitidas). Não executado: limpeza,
`DELETE`/`TRUNCATE`/`DROP`, migrations, Seed, Playwright, testes de integração com escrita, rotação, encerramento de processos.
Dev e Shadow não foram consultados; o catálogo real não foi tocado.

## 1. Estado do ambiente
| Item | Estado |
| --- | --- |
| PostgreSQL | 18.6, `127.0.0.1:5432` (PID 7004) |
| Test | 5 migrations concluídas, nenhuma revertida; `orders`=0, `order_items`=0, `order_status_history`=0 |
| Advisory locks / transações preparadas | 0 / 0 |
| Roles | `dev_app`, `test_app`, `migrator`: sem limite de conexões; `test_fixtures`: `CONNECTION LIMIT 2` |
| Node | v24.20.0; Playwright `@playwright/test` 1.64.1; navegador `chromium-1248` e headless shell instalados |
| Memória livre | ~759 MB (a 3D.3.21-A caiu por falta de memória com 705 MB: **risco**) |
| Git (`main`) | 0 em stage; 117 entradas (20 modificadas, 97 não rastreadas); nada commitado nesta etapa |
| Credenciais | inalteradas (3D.3.22-C cancelada); `secrets:audit` continua com `FAIL`, risco aceito |

## 2. Funcionalidades existentes (por inspeção de arquivos)
- **Frontend:** `Checkout.tsx`, `AdminLogin.tsx`, `AdminDashboard.tsx`; `CartContext`, `comanda`, `orderReview`; serviços `catalogSource/Adapter/Store`, `orderSubmission`, `api`. Envio real de pedido só com `VITE_ORDER_SUBMISSION=enabled`; catálogo por `VITE_CATALOG_MODE`.
- **Backend:** `GET /categories`, `GET /products`, `GET /products/:id`, `POST /orders` (com `Idempotency-Key`), autenticação administrativa, convites/sessões de comanda.
- **E2E já escrito (3D.3.21-B, não executado):** `frontend/playwright.config.ts` (backend 4100, Vite 5174, `reuseExistingServer:false`, recusa carregar sem `RUSTIKA_E2E_CONFIRM`), `globalSetup.ts`/`globalTeardown.ts` (fixtures por manifesto, teardown cirúrgico), `e2e.spec.ts` (login admin → convite → resgate → carrinho → revisão → envio com botão habilitado → `POST /api/orders` 201 → replay 200).
- **Testes:** backend 662/662 e frontend 99/99 em 04/11; **não repetidos** nesta etapa.

## 3. Processos e portas
| Porta | Situação |
| --- | --- |
| 5173 | ocupada: Vite de desenvolvimento (PID 20708, desde 04/11 11:02, `frontend`). Não conflita com o E2E |
| 4000, 4100, 5174 | livres |
| 5432 | PostgreSQL |
| `%TEMP%\rustika-e2e` | sem manifestos |

Processos antigos do projeto (listados, **nenhum encerrado**): `20396` (`npx vitest run backend/tests/disposable-pr…`, 04/11 10:44), `20264` (`npx vitest run`, 10:46), `7316` (`node run_vitest.js`, 17:56), `35328` e `27780` (`vitest tests/integration-db/comandas…`, 17:56, `backend`), `20708` (Vite). Demais `node` (Codex, MCPs, 9router) não pertencem ao projeto. Sessões no banco Test: 4 `psql` ociosas do `cardapio_migrator` (15:10–15:17), 1 em `cardapio_restore_3d316`, 1 do `postgres`; **nenhuma** de `test_app` ou `test_fixtures`.

## 4. Configuração do Test
Banco `cardapio_digital_test`; runtime `cardapio_test_app` (`NODE_ENV=test`, `DB_PROFILE=app-test`, exatos); fixtures `cardapio_test_fixtures` (`fixtures-test.env`, `connection_limit=1`); segredos em `%LOCALAPPDATA%\CardapioDigital\secrets` (5 perfis: app-dev/test, fixtures-test, migrate-dev/test). Confirmações exigidas: `RUSTIKA_DB_INTEGRATION=1`, `RUSTIKA_DB_INTEGRATION_CONFIRM=WRITE_CARDAPIO_DIGITAL_TEST`, `RUSTIKA_E2E_CONFIRM=RUN_E2E_ON_CARDAPIO_DIGITAL_TEST`; proibidos `DATABASE_URL`, `SHADOW_DATABASE_URL`, `CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION`.

## 5. Resíduos encontrados
O Test **não contém catálogo real**: só 1 linha em cada tabela abaixo, todas do E2E antigo (`seed_raw.js`, 3D.3.21-A). A comanda `999999` **existe** (`OPEN`).

| Tabela | Identificador | Dependências (FK `RESTRICT`) |
| --- | --- | --- |
| `admins` | `ca000000-0000-4000-8000-000000000000` (`e2e@rustika.local`, "E2E Admin") | referenciada por `comanda_invitations.issued_by_admin_id` |
| `categories` | `cc000000-…-000000000000` (`e2e-cat`, "E2E Category") | pai de `products` |
| `products` | `cc000000-…-000000000001` (`rustika-E2E001`, "E2E Product", grupo "E2E Group", R$ 0,99) | filho de `categories`; sem `order_items` |
| `comandas` | `cc000000-…-000000000999` (número `999999`, aberta 04/11 19:13) | pai de `comanda_invitations`, `comanda_sessions`, `orders` (0) |
| `comanda_invitations` | `3d3a7928-328c-47ae-ad47-b8780411bc33` (emitido pelo admin E2E, consumido, expirou 04/11 20:34) | filho de `comandas` e `admins`; pai da sessão |
| `comanda_sessions` | `45866608-27e6-4747-b5a0-8da0bad75d25` (expirou 05/11 04:24) | filho de `comandas` e do convite; sem pedidos |

**Por que pertencem só ao teste:** ids com prefixos fixos `ca000000`/`cc000000` do script de teste, e-mail `@rustika.local`, nomes/`public_key`/`source_group` "E2E", criação em 04/11 durante o diagnóstico 3D.3.21-A, convite e sessão filhos exclusivos da comanda `999999` e do admin E2E, e **zero pedidos**. Nada aponta para o catálogo real ou para outro projeto. Resíduos do harness de fixtures (`fixture-3d39-*`): admins 0, categorias 0 (a única "comanda da faixa 9" é a `999999`).

## 6. Plano de limpeza restrita (NÃO executado; exige nova autorização)
1. **Antes:** `npm run e2e:inspect` (esperado: 6 linhas acima; `orders`=0; sem sessões de `test_app`/`test_fixtures`; sem locks) e backup recente do Test com SHA-256 conferido (existe `cardapio_digital_test_pre-migrations-3d311_…dump`; gerar um novo, se desejado).
2. **Dry-run:** `npm run e2e:cleanup-legacy` lista exatamente os ids fixos acima, mais os filhos da comanda `999999`, sem apagar.
3. **Execução** (autorização à parte): `RUSTIKA_E2E_LEGACY_CLEANUP=ERASE_LEGACY_E2E_FIXTURES` + `--execute`. O código apaga em uma transação, filho antes de pai, com filtros por id/comanda (convite só se emitido pelo admin E2E); aborta sem apagar se achar algo fora do escopo (pedido, convite de outro admin).
4. **Depois:** `npm run e2e:inspect`: resíduo legado = 0; demais tabelas inalteradas; 5 migrations intactas; catálogo real e migrations não são tocados.
5. **Recuperação:** a transação reverte sozinha em erro; restaurar as 6 linhas só por reexecução do `seed_raw` é **proibido**, então a recuperação é pelo dump do passo 1 (restauração para um banco de apoio, nunca sobre o Test sem autorização) ou pelas próprias linhas, que são sintéticas e recriáveis pelo setup do E2E.

## 7. Plano de execução do primeiro E2E (após limpeza e autorização)
Frontend 5174 e backend 4100 sobem pelo `webServer` do Playwright (sem reaproveitar servidores). Fluxo: setup cria admin/categoria/produto/comanda/convite sintéticos por `runId` → abrir a aplicação → login admin → convite → resgate → selecionar produto → carrinho → comanda de teste → revisão → enviar → `POST /api/orders` **201** → replay idempotente **200** → teardown verifica o pedido persistido (status `RECEIVED`, itens, total, histórico, idempotência) e remove só o manifesto da execução → `e2e:inspect` confirma resíduo zero. Evidências: saída do Playwright, relatório HTML, resultado do `e2e:inspect` antes/depois.

## 8. Riscos e bloqueios
| # | Item | Natureza |
| --- | --- | --- |
| 1 | Resíduo `999999` bloqueia o preflight (colisão) | **bloqueio**: exige limpeza autorizada |
| 2 | Memória livre ~759 MB | risco: fechar programas pesados antes |
| 3 | Processos vitest antigos (20396, 20264, 7316, 35328, 27780) | risco: sem sessão deles no Test hoje; encerrar só com autorização por PID |
| 4 | 4 sessões `psql` ociosas do migrator no Test | informativo; confirmar que o preflight não as trata como bloqueio |
| 5 | Credenciais fracas/compartilhadas | risco aceito pelo usuário; não bloqueia |
| 6 | Dependência `xlsx` por URL do CDN | risco aceito na 3D.3.21-B; irrelevante ao E2E |
| 7 | Scripts soltos com senha em `backend/` | manter fora de checkpoints Git |
| 8 | `npm` falhou uma vez neste shell ("Could not determine Node.js install directory"); `node`/`tsx` direto funcionam | operacional; abrir PowerShell novo antes de rodar |

## 9. Comandos para a próxima etapa (não executar sem autorização)
```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
npm run e2e:inspect                    # somente leitura
npm run e2e:cleanup-legacy             # dry-run, não apaga
# com autorização escrita:
$env:NODE_ENV='test'; $env:DB_PROFILE='app-test'; $env:RUSTIKA_DB_INTEGRATION='1'
$env:RUSTIKA_DB_INTEGRATION_CONFIRM='WRITE_CARDAPIO_DIGITAL_TEST'; $env:RUSTIKA_E2E_CONFIRM='RUN_E2E_ON_CARDAPIO_DIGITAL_TEST'
$env:RUSTIKA_E2E_LEGACY_CLEANUP='ERASE_LEGACY_E2E_FIXTURES'; npm run e2e:cleanup-legacy -- --execute
cd ..\frontend; npx playwright test
cd ..\backend; npm run e2e:inspect
```

## 10. Critérios de aceite
- Limpeza: somente os 6 registros listados removidos; `orders`=0; dumps e catálogo real intactos; 5 migrations idênticas.
- E2E: `POST /api/orders` 201, replay 200, "Pedido recebido" visível, pedido persistido conferido pelo teardown.
- Pós-execução: resíduo zero, nenhum manifesto remanescente, portas 4100/5174 livres, nenhuma sessão de `test_app`/`test_fixtures`.
- Nenhum segredo em log, relatório ou manifesto; nenhum commit/push automático.

**Próxima fase: PREPARAÇÃO E2E SOMENTE LEITURA concluída — aguardando auditoria e autorização para limpeza e execução.**
