# RÚSTIKA — Relatório da Entrega 3D.3.21-B
**Correção das Fixtures E2E, Credenciais e Dependências do Backend** — 04/11/2026

Nenhum segredo é exibido neste relatório. Nenhum `git add`/`commit`/`push`, nenhuma migration, Seed, DML,
alteração de role/ACL/`pg_hba.conf`, exclusão de banco/backup ou execução de Playwright com escrita.

---

## 1. Diagnóstico do `seed_raw.js`
Arquivo **preservado sem alteração e não executado** (não rastreado pelo git). Nada mais o invoca.

| Achado | Detalhe |
| --- | --- |
| Exclusões | 8 `DELETE FROM`, **5 sem filtro** (pedidos, itens, histórico, sessões, convites): apagariam dados reais do Test |
| Inserções | 4 `INSERT` com IDs fixos (admin `e2e@rustika.local`, categoria `e2e-cat`, produto `rustika-E2E001`, comanda `999999`) |
| Reabertura | `ON CONFLICT (number) DO UPDATE SET status='OPEN', closed_at=NULL` altera comanda preexistente |
| Credencial | senha vigente de `cardapio_test_fixtures` embutida |
| Teardown | inexistente (resíduo permanente) |

## 2. Correção de setup/teardown
Código em `backend/tests/integration-db/e2e/` (`gate`, `manifest`, `lifecycle`, `real`, `run-setup`,
`run-teardown`, `legacy`, `cleanup-legacy`) reaproveitando o harness aprovado (`support/*`).

- **Setup:** gates (`RUSTIKA_E2E_CONFIRM`, `NODE_ENV=test`, `DB_PROFILE=app-test` exatos; proíbe `DATABASE_URL`/`SHADOW_DATABASE_URL`/confirmação de deploy); só `cardapio_digital_test`; falha com manifesto anterior; preflight completo; manifesto gravado **antes** de escrever; uma transação com registros sintéticos por `runId`; faixa de comandas reservada.
- **Teardown:** lê/valida manifesto (rejeita adulteração); aborta **sem apagar** se o banco tem registro da identidade que o manifesto não explica; remove só ids do manifesto, filho→pai, em transação; prova resíduo zero; só então apaga o manifesto. Sem manifesto não há limpeza por varredura.
- **Verificação do pedido persistido** somente leitura antes da limpeza (status, cliente, total, item, histórico, chave/digest de idempotência, convite/sessão).
- Resíduo do E2E antigo: `npm run e2e:cleanup-legacy` (dry-run por padrão; `--execute` exige variável de confirmação e apaga apenas os ids fixos do `seed_raw.js`).

## 3. Evidências de isolamento
Somente `cardapio_digital_test` (nome validado); 5 migrations + checksums; ACL efetiva; sondagem do `pg_hba` nos demais bancos (aborta se algum aceitar); advisory lock 3039390001 (bloqueia execução concorrente); `CONNECTION LIMIT 2` respeitado (`connection_limit=1`); Dev/Shadow/Restore/prod bloqueados por nome; nenhuma credencial em log (`redactSecrets`); manifesto em `%TEMP%` fora do repositório/OneDrive, só ids.
Prova adversarial: `tests/e2e-fixtures.test.ts` (**73 testes**, Prisma em memória com FK RESTRICT): dados reais, resíduo de outra execução, E2E legado, comanda 999999 e faixa de outra execução **sobrevivem**; FK violada reverte a transação; manifesto adulterado/incompleto é recusado.
Snapshot somente leitura do Test (inalterado): 0 pedidos, resíduo legado presente, 5 migrations concluídas.

## 4. Auditoria dos scripts com credencial (11 + novos)
Classificação (valores nunca impressos; `npm run secrets:audit`, `scripts/audit-secrets.ts`):

| Script (`backend/`, não rastreados) | Credencial | Classe |
| --- | --- | --- |
| `seed_raw.js` | fixtures (vigente) | **Potencialmente perigoso** (DML global) — preservado, bloqueado |
| `check_invites.js`, `check_orders.js`, `check_products.js`, `check_sessions.js` | fixtures (vigente) | Temporários de diagnóstico → substituídos por `npm run e2e:inspect` |
| `seed_pg.js` | senha compartilhada dev/test/migrator (vigente) | **Potencialmente perigoso** (escrita) |
| `db-dumper.js`, `db-check.js`, `check_db.js` | idem | Dev/diagnóstico; legados |
| `seed_e2e.js`, `check_admin_app.js` | valores **não** mais vigentes | Legados |

Os necessários passam a usar o mecanismo existente (`loadDatabaseProfile` + pasta de segredos fora do repo/OneDrive): `inspect-e2e-state.ts` (transação READ ONLY), `audit-secrets.ts`, E2E (`fixtures-test.env`). Nenhum legado foi apagado.
**Git:** nenhuma credencial real em arquivo rastreado nem no histórico de `main` (achados rastreados são fictícios); sem remoto, nada enviado. Cópias locais: 71 refs `refs/cline/checkpoints/*`; pasta no OneDrive sincroniza scripts e `.git`. Varredura de 513 arquivos: nenhuma senha vigente em relatórios/docs/dumps.

## 5. Credenciais que exigem rotação
**Todas as quatro roles:** `cardapio_dev_app`, `cardapio_test_app`, `cardapio_migrator`, `cardapio_test_fixtures`.
- `dev_app`, `test_app` e `migrator` compartilham **a mesma senha**, fraca (8 dígitos; a do shadow tem 6). Quem obtém a do runtime obtém a da role dona dos objetos.
- `migrator`: senha divergente entre URLs (ao menos uma não autentica).
- `test_fixtures`: forte, mas vigente e embutida em 5 scripts.
Procedimento preparado e **não executado**: `backend/docs/secrets-rotation.md` (política: distinta por role, ≥16 caracteres, não numérica; `\password` no psql; rollback). Não reescrever o histórico de `main` (não há segredo real nele).

## 6. Estado do `xlsx`
Pacote do npm (0.18.5) vulnerável (prototype pollution + ReDoS) → **não aceito**. Instalado SheetJS **0.20.3** do CDN oficial (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), com `--allow-remote=root --ignore-scripts`, lock com `sha512`; `npm audit` sem o achado. O ESM do 0.20 não tem `fs` embutido: 5 scripts passaram de `xlsx.readFile(p)` para `xlsx.read(readFileSync(p), {type:'buffer'})` (`seed-real.ts`, `executor-seed-real.ts`, `inspect-reconciliation.ts`, `analyze-excel.ts`, `analyze-excel2.ts`). **Parser/contratos do catálogo intactos**; `seed-real-corrected.test.ts` 8/8. Risco residual: dependência por URL (depende do CDN e do hash do lock).

## 7. Correções realizadas
Frontend: `playwright.config.ts` (recusa carregar sem confirmação; portas 4100/5174; `reuseExistingServer:false`; `VITE_ORDER_SUBMISSION=enabled` apenas no servidor temporário; `VITE_API_URL=http://localhost:4100/api`; env do backend com `NODE_ENV=test`, `DB_PROFILE=app-test`), `globalSetup.ts`, `globalTeardown.ts` (novo), `e2e.spec.ts` (sem bypass de janela/clique forçado; botão deve estar habilitado; POST 201; replay idempotente 200). Backend: `env.ts` faz `.trim()` de `NODE_ENV` (corrige o `set X=y &&` do Windows), scripts `e2e:*`/`secrets:audit`, `databases.ts` com `allowCollisions`. `.env` habitual de Dev não alterado.

## 8. Testes e resultados (sem DML)
| Verificação | Resultado |
| --- | --- |
| Backend `npm test` (2 execuções, `NODE_ENV=test`, `DB_PROFILE=app-test`) | 31 arquivos, **662/662** |
| Backend `typecheck` / `build` | 0 erros / ok |
| Frontend `typecheck` / `build` | 0 erros / ok |
| Frontend `npm test` | **99/99** (inclui `vite-env-injection`, `e2e-guard`) |
| `tests/audit-secrets.test.ts`, `e2e-fixtures.test.ts` | passam |
| Gate do `integration-db` sem confirmação | continua abortando |
Não executados (proibidos): Playwright com `globalSetup` de escrita, `test:integration:db`, migrations, Seed.

## 9. Processos antigos (apenas listados; nenhum encerrado)
Relacionados ao projeto (hoje, 04/11):

| PID | Executável / comando | Início | Porta | Relação |
| --- | --- | --- | --- | --- |
| 14952 | `npm run dev --prefix frontend` | 11:02 | — | Cardapio_Digital |
| 20708 | `vite.js` (`frontend`) | 11:02 | **5173** | Cardapio_Digital (Vite de Dev) |
| 20396 | `npx vitest run backend/tests/disposable-pr…` | 10:44 | — | Cardapio_Digital, parado/antigo |
| 20264 | `npx vitest run` | 10:46 | — | provável Cardapio_Digital, cwd não verificável |
| 7316 | `node run_vitest.js` | 17:56 | — | provável, cwd não verificável |
| 35328 / 27780 | `npx vitest tests/integration-db/comandas…` | 17:56 | — | Cardapio_Digital `backend`; **suite com acesso ao banco, pode manter sessão de Test** |

Demais `node` (MCP Playwright/Desktop Commander, 9router, Codex, claude-mem, data-agent-kit) são ferramentas do ambiente, sem relação com o projeto; não tocados. Portas 4000/4100/5174: livres; 5173 ocupada pelo PID 20708 (não conflita com a 5174 do E2E).
**Autorização solicitada (específica, PID a PID):** 20396, 20264, 7316, 35328, 27780 e, se desejar, 14952/20708. Nenhum `taskkill /IM`.

## 10. Estado do git
Branch `master`, **nada em stage** (0 arquivos), nenhum commit. ~110 entradas de status (modificados/não rastreados), incluindo os desta entrega: `backend/docs/{e2e-real,secrets-rotation}.md`, `backend/scripts/{audit-secrets,inspect-e2e-state}.ts`, 5 scripts de xlsx, `backend/tests/{audit-secrets,e2e-fixtures}.test.ts`, `backend/tests/helpers/`, `backend/tests/integration-db/e2e/`, `integration-db/support/databases.ts`, `frontend/tests/globalTeardown.ts`, `package.json`/`package-lock.json`. Os 11 scripts com credencial **devem ficar fora do checkpoint** (lista explícita).

## 11. Integridade das migrations
As 5 migrations têm SHA-256 idênticos aos da linha de base (comparados ao `mig.sha256` da sessão). Nenhuma criada, alterada ou aplicada.

## 12. Pendências
1. **Rotação das 4 credenciais** (bloqueia a execução real).
2. **Limpeza do resíduo legado** (comanda `999999` etc.) via `e2e:cleanup-legacy --execute`, com autorização (é DML).
3. Autorizar/encerrar os PIDs da seção 9 (sessões de vitest podem segurar conexões de Test).
4. Decidir destino dos scripts soltos (quarentena fora do OneDrive) e dos refs `refs/cline` (só após a rotação).
5. Backup recente do Test com SHA-256 conferido; memória livre suficiente (a 3D.3.21-A medeu 705 MB e uma queda por falta de memória).
6. Aceitar a dependência `xlsx` por URL do CDN.

## 13. Comandos E2E preparados (NÃO executados; detalhes em `backend/docs/e2e-real.md`)
```powershell
$env:NODE_ENV='test'; $env:DB_PROFILE='app-test'; $env:RUSTIKA_DB_INTEGRATION='1'
$env:RUSTIKA_DB_INTEGRATION_CONFIRM='WRITE_CARDAPIO_DIGITAL_TEST'
$env:RUSTIKA_E2E_CONFIRM='RUN_E2E_ON_CARDAPIO_DIGITAL_TEST'
cd backend;  npm run secrets:audit; npm run e2e:inspect; npm run e2e:cleanup-legacy
# com autorização: $env:RUSTIKA_E2E_LEGACY_CLEANUP='ERASE_LEGACY_E2E_FIXTURES'; npm run e2e:cleanup-legacy -- --execute
cd ..\frontend; npx playwright test      # setup -> jornada (POST 201, replay 200) -> teardown cirúrgico
cd ..\backend; npm run e2e:inspect        # resíduo zero
```
Paradas: confirmação ausente, porta 4100/5174 ocupada, preflight reprovado, manifesto anterior, botão desabilitado, POST ≠ 201, registro não explicado pelo manifesto (teardown aborta sem apagar, exit 2). Em estado incerto não limpar à mão.

## 14. Parecer final
Infraestrutura E2E reescrita, sem limpeza global, com setup/teardown restritos aos registros da própria execução e provados por 73 testes adversariais; credenciais embutidas auditadas (rotação obrigatória e documentada); `xlsx` seguro; guardrails revalidados; regressões verdes (backend 662, frontend 99); migrations íntegras; nenhum DML real. A execução real continua dependendo das pendências da seção 12 e de autorização expressa.

**3D.3.21-B — INFRAESTRUTURA E2E SEGURA, NOVA EXECUÇÃO AGUARDANDO AUTORIZAÇÃO.**
