# RELATÓRIO DA ENTREGA 3D.3.13

Recuperação do CSS, validação visual e fechamento do checkpoint Git  
Data: 04/11/2026 (America/Sao_Paulo)

**Parecer: PARCIAL.** O CSS funcional está ativo, a regressão visual passou a ser detectada pelo `npm test`, os testes e builds passaram e o checkpoint está pronto para aprovação. A visualização do dashboard autenticado não ocorreu sem login real; o Claude Code instalado respondeu `loggedIn: false`, portanto esta sessão foi executada pelo Codex. Não houve `git add`, commit, migration ou escrita em PostgreSQL.

Legenda: **[EXEC]** confirmado nesta sessão; **[INSP]** inspeção; **[HERD]** relatório anterior; **[PEND]** não validado.

## 1. Estado inicial

- [EXEC] Repositório `C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital`, branch `main`, HEAD `1e80bdb086aed59b08e3b35e5141f03f840d7fa9`, sem remote e sem arquivos staged.
- [HERD] A 3D.3.12 registrou `index.css` regredido com 176 linhas e 122 classes do React sem regra; seu Anexo A tinha 171 arquivos.
- [EXEC] Ao iniciar **esta** sessão, o CSS ativo já tinha 273 linhas e correspondia byte a byte ao blob do `HEAD`. A recuperação da base ocorreu antes desta execução; não atribuo essa substituição à 3D.3.13 atual.
- [EXEC] `frontend/tests/style-rules.mjs` e `styles-smoke.test.mjs` já existiam, mas não estavam no script `npm test` e o segundo falhava em Node ao renderizar o `Header` (`import.meta.env.BASE_URL`).
- [EXEC] A leitura de `git status` exigiu acesso fora do sandbox do Codex porque `.git` é um reparse point. Nenhum comando de escrita Git foi empregado.

## 2. Evidência da regressão e versões comparadas

| Versão | Linhas | SHA-256 dos bytes | Resultado |
|---|---:|---|---|
| CSS ativo no início desta sessão | 273 | `fbed2c789db0b05e03f10750708d21f0d0e3f425146f38191ee1edda76d5b8ee` | Blob Git `b0fb6afc…`, igual ao `HEAD` [EXEC] |
| `HEAD:frontend/src/index.css` | 273 | `fbed2c789db0b05e03f10750708d21f0d0e3f425146f38191ee1edda76d5b8ee` | Base funcional comprovada [EXEC] |
| `index-Calil-Notebook.css` | 273 | `f3bf6aa176725e7c17724296fe6ec912c4e6a918070eff81138f10d611927153` | Diferença de fim de linha; com filtro Git produz o mesmo blob `b0fb6afc…` [EXEC] |
| CSS ativo após esta sessão | 291 | `63dd291c3de5e05c16dd1b1c7b2f9255605649dedc235fa20448e2704e85a321` | Base do `HEAD` + 18 linhas de estilo necessário; sem remoções [EXEC] |

O CSS de 176 linhas documentado na 3D.3.12 já não estava ativo quando comecei [HERD]. Nenhuma cópia de conflito foi apagada ou modificada [EXEC].

## 3. Backup do CSS anterior

`C:\Users\u1n3c\AppData\Local\RustikaBackups\index-active-pre-3d313-head.css` [EXEC]: 23.559 bytes, SHA-256 `fbed2c789db0b05e03f10750708d21f0d0e3f425146f38191ee1edda76d5b8ee`. Arquivo fora do OneDrive e do repositório. Foi reconstruído com bytes de `git show HEAD:frontend/src/index.css`, cujo blob havia sido comprovado idêntico ao CSS ativo antes das edições desta sessão. A primeira cópia feita no TEMP do sandbox não ficou acessível fora daquele processo; a cópia durável acima foi validada por SHA-256. Não há cópia local comprovada do CSS regredido de 176 linhas.

## 4. Arquivos modificados nesta sessão

| Arquivo | Alteração |
|---|---|
| `frontend/src/index.css` | +18 linhas: estado de catálogo, reserva de espaço no banner mobile e estilos mínimos de login, dashboard, erro e formulário de resgate, usando cores/tokens já existentes |
| `frontend/tests/styles-smoke.test.mjs` | Corrigido o teste do cabeçalho para ler classes literais do componente, pois o SSR em Node não fornece `import.meta.env`; mantém renderização real do catálogo e demais componentes |
| `frontend/tests/style-rules.mjs` | Contratos adicionais para banner mobile, formulários administrativos e quebra de linha do resgate |
| `frontend/package.json` | Incluído `styles-smoke.test.mjs` no `npm test` regular |
| `RELATORIO-ENTREGA-3D.3.13.md` | Este relatório |

Os dois módulos de teste CSS já existiam como não rastreados antes desta sessão. Não houve mudança de componente React, rotas, banco ou configuração de envio de pedidos.

## 5. Alterações recuperadas e proteção visual

- [EXEC] O CSS ativo no início já continha os seletores centrais: `.app-shell`, `.category-nav`, `.product-grid`, `.product-card`, `.product-modal`, `.cart-drawer` e `.order-review`.
- [EXEC] O teste antes não passava: 3/5, com duas falhas causadas pela renderização do `Header` sob Node. Depois do ajuste passou 5/5 e integra o `npm test` (87/87).
- [INSP] Os 82 testes anteriores cobriam lógica/markup, sem carregar `index.css`. O teste novo lê o CSS real, resolve regras de largura 390/1366 px e verifica propriedades de layout, relaciona classes ao markup produzido por componentes reais e demonstra que um CSS esqueleto é rejeitado. O cabeçalho é verificado pelas classes literais do arquivo fonte; o navegador confirmou seu layout.
- [EXEC] Adicionei `.catalog-state` porque as mensagens de carregamento/erro usavam classe sem regra. `.connection--idle` herda de `.connection` intencionalmente. Os formulários administrativos estavam sem organização de campos; o CSS novo reutiliza `--paper`, `--ink`, `--line` e `--display-font`.
- [EXEC] No mobile, o link Admin se sobrepunha ao texto do banner. A regra de `padding-right: 4.5rem` em `.academic-banner` com largura até 559 px separou as áreas sem alterar o link ou o componente.

Limite do teste: o parser de CSS não substitui o motor de layout do navegador. As medições de `getComputedStyle` e geometria no navegador complementam a suíte automatizada.

## 6. Evidência visual desktop e mobile

Inspeção em navegador local com Vite e API local apenas para GETs públicos [EXEC]; nenhuma credencial foi inserida e nenhuma ação de pedido foi enviada. Screenshots foram observados durante a sessão, sem arquivo de imagem persistido.

| Fluxo | Desktop 1366 px | Mobile 390 px |
|---|---|---|
| Catálogo | 144 cards, 12 categorias (mais botão Todos); grid com 3 colunas de 368 px | grid com 1 coluna de 335 px; navegação de categorias rola dentro do próprio elemento |
| Cabeçalho/hero | fonte de destaque, símbolo e foto aplicados; fundo de madeira carregado | composição em coluna; banner e Admin sem interseção do texto (texto até x=292,75, link a partir de x=314,16) |
| Modal de produto | aberto e legível, 544 × 354 px | regras responsivas verificadas pelo contrato CSS; abertura mobile não fotografada nesta sessão |
| Carrinho/resgate | painel lateral, campos e botões legíveis | painel de 375 px; formulário de 291 px, input de 184 px e botão de 99 px; sem overflow |
| Revisão | diálogo aberto após comanda **local** fictícia 123; nenhum POST | diálogo com 375 px e botões legíveis; sem overflow |
| Login administrativo | rota `#admin` abriu sem login | formulário de 326 px, inputs de 292 px, campos em grid; sem overflow |
| Dashboard administrativo | [PEND] exige sessão administrativa real; não houve login | [PEND] idem; regras CSS inspecionadas, sem prova visual autenticada |
| Erro/carregamento | estados vistos quando a API estava indisponível inicialmente; após conexão, catálogo carregou | estilo `.catalog-state` coberto pelo smoke; estado final não fotografado |

No mobile `document.documentElement.scrollWidth` foi 375 px para viewport de 390 px; não houve rolagem horizontal da página. O navegador bloqueou uma tentativa de abrir prévia local `file:` do dashboard por política de URL. Não foi feita outra tentativa de contornar essa barreira.

## 7. Regressão completa

| Projeto | Typecheck | Testes | Build |
|---|---|---|---|
| Frontend | exit 0 [EXEC] | **87/87**, 82 anteriores + 5 de CSS [EXEC] | exit 0, Vite 6.4.5, 55 módulos [EXEC] |
| Backend (`NODE_ENV=test`, `DB_PROFILE=app-test`) | exit 0 [EXEC] | **579/579**, 29 arquivos [EXEC] | exit 0 [EXEC] |

Uma tentativa inicial do build frontend e da suíte backend falhou por `EPERM` do sandbox em arquivos temporários do Vite/Vitest. Reexecutados com acesso ao workspace, ambos passaram. A falha inicial não foi uma falha de código. Nenhum teste real com escrita em PostgreSQL foi iniciado.

## 8. Integridade das migrations e `.gitattributes`

| Migration | SHA-256 [EXEC] |
|---|---|
| `20261023000000_initial_schema` | `1a9cd08b9d49fa9f70eabcceaa4a696f5aee07555f6a88562ec789340f0d3983` |
| `20261027000000_rf004_comandas_catalogo_pedidos` | `05f583e854a87b77612c2f7d10a0a178ef45ea099d3237808b5bf0bd7c698122` |
| `20261031000000_rf004_fix_permissions` | `960766a8fb1576e6094622f112e1a3a9cd7455f56907a3405a8fbb183959e10b` |
| `20261102000000_update_products_source_identity_constraint` | `885b8de5dcc0cf5e7618d574ba5c013ae8b60c9b983260706c5819422564454f` |
| `20261104000000_runtime_least_privilege` | `24471ed369980bc861d885dc68d9edd3747de73457be620d166eae8b1ec47d6e` |
| `migration_lock.toml` | `99836963713b4f5b269ad49af0ed3d7b0b2e336115c2f92dc9ac683d139d0900` |

Todos iguais aos da 3D.3.12. `git check-attr text` retornou `unset` e `git hash-object --no-filters` = `git hash-object --path` para cada um dos cinco SQL: a regra `.gitattributes` preserva os bytes. Nenhum SQL foi editado.

## 9. Checkpoint Git revalidado, sem stage nem commit

- [EXEC] Reutilizei as 171 entradas do Anexo A da 3D.3.12; todas existem. Acrescentei `frontend/tests/style-rules.mjs`, `frontend/tests/styles-smoke.test.mjs` e este relatório: **174 arquivos**, sendo **149 novos e 25 modificados com conteúdo**. O `index.css` permanece na lista porque recebeu 18 linhas legítimas após a recuperação da base.
- [EXEC] Todos os 25 modificados com conteúdo estão na lista. Os 35 não rastreados fora dela são cópias `Calil-Notebook`, resíduos, dados de origem ou reconciliação; nenhum foi removido.
- [EXEC] A lista não contém cópias de conflito, `.env` sensíveis, `fixtures-test.env`, dumps, backups, `backend/data`, `changes.diff`, `vitest-report.json` ou `$testRunner`. Os dois SQL versionados no `HEAD` ficam preservados por não terem mudado; os três SQL não rastreados estão incluídos.
- [EXEC] O índice Git permanece vazio; o HEAD continua `1e80bdb`, sem remote. `git diff --check` não apontou erro de whitespace. Os avisos de `core.autocrlf=true` para arquivos comuns continuam; as migrations estão protegidas por `-text`.

**Manifesto para revisão:** `C:\Users\u1n3c\AppData\Local\RustikaBackups\checkpoint-3d313-pathspec.txt`, UTF-8 sem BOM, 174 linhas. A lista idêntica consta no Anexo A. O manifesto está fora do repositório e do OneDrive.

**Comandos previstos, somente após aprovação explícita para o checkpoint** (não executados nesta entrega):

```powershell
Set-Location 'C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital'
$manifest = 'C:\Users\u1n3c\AppData\Local\RustikaBackups\checkpoint-3d313-pathspec.txt'
(Get-Content -LiteralPath $manifest).Count                    # 174
Get-ChildItem backend/prisma/migrations -Recurse -Filter migration.sql -File | Get-FileHash -Algorithm SHA256
git add --pathspec-from-file="$manifest"
git diff --cached --name-only | Measure-Object -Line           # 174
git diff --cached --check
git diff --cached --name-only | Select-String 'Calil-Notebook|\.env$|\.dump$|\.backup$|backend/data/|changes\.diff|vitest-report|\$testRunner'  # vazio
git ls-files --eol -- backend/prisma/migrations               # attr/-text; bytes conferidos
git commit -m 'chore: checkpoint funcional RUSTIKA 3D.3.7-3D.3.13'
git log --oneline -2
Get-ChildItem backend/prisma/migrations -Recurse -Filter migration.sql -File | Get-FileHash -Algorithm SHA256  # hashes iguais
git status --short                                             # só exclusões planejadas
```

Não há push: nenhum remote está configurado.

## 10. Riscos restantes e parecer

- [PEND] Dashboard autenticado sem screenshot/medição em navegador; depende de ambiente de teste com sessão legítima, sem usar o Dev para login.
- [PEND] O backup do PostgreSQL e migrations continuam aguardando autorizações separadas da 3D.3.12. Esta entrega não validou nem alterou dados do banco.
- [EXEC] Claude Code 2.1.317 está instalado, mas `claude auth status` retornou `loggedIn: false`; esta execução usou Codex. Requer `claude auth login` para futuras entregas que exijam Claude Code.
- [INSP] O OneDrive já causou reversão de arquivos ativos. Falta o checkpoint aprovado e um remoto; até lá, as alterações continuam apenas nesta árvore de trabalho.

**PARCIAL**, pelos dois pontos de visualização/execução acima. Os critérios técnicos de CSS ativo, smoke automatizado, catálogo visual, regressão, migrations intactas e checkpoint documentado foram atendidos com evidência. Nenhuma operação seguinte foi iniciada.

## Anexo A — Lista exata do checkpoint (174 caminhos)

O arquivo `checkpoint-3d313-pathspec.txt` contém exatamente os caminhos abaixo, um por linha, sem os marcadores `(M)` do relatório anterior:

```text
.gitattributes
backend/docs/access-api.md
backend/docs/admin-provisioning.md
backend/docs/catalog-api.md
backend/docs/fixture-role.md
backend/docs/integration-db.md
backend/docs/orders-api.md
backend/docs/restore-backup.md
backend/docs/sql/enable-test-fixtures-login.sql
backend/docs/sql/pg_hba-test-fixtures.conf.example
backend/docs/sql/provision-test-fixtures.sql
backend/docs/sql/README.md
backend/docs/sql/rollback-test-fixtures.sql
backend/docs/sql/verify-restore.sql
backend/docs/sql/verify-test-fixtures.sql
backend/package.json
backend/prisma/migrations/20261031000000_rf004_fix_permissions/migration.sql
backend/prisma/migrations/20261102000000_update_products_source_identity_constraint/migration.sql
backend/prisma/migrations/20261104000000_runtime_least_privilege/migration.sql
backend/RELATORIO-ENTREGA-3D.2.10.md
backend/RELATORIO-ENTREGA-3D.2.4.md
backend/RELATORIO-ENTREGA-3D.2.6.md
backend/RELATORIO-ENTREGA-3D.2.7.md
backend/RELATORIO-ENTREGA-3D.2.8.md
backend/RELATORIO-ENTREGA-3D.2.9.md
backend/scripts/_gen-seed-real.js
backend/scripts/analyze-excel.ts
backend/scripts/analyze-excel2.ts
backend/scripts/check-cats.ts
backend/scripts/check-products.ts
backend/scripts/dry-run-recovery.ts
backend/scripts/executor-3d-2-14d-2.ts
backend/scripts/executor-seed-real.ts
backend/scripts/generate-map.ts
backend/scripts/inspect-db-dev.ts
backend/scripts/inspect-reconciliation.ts
backend/scripts/inspect-role.ts
backend/scripts/preflight-category-publication.ts
backend/scripts/publish-category-publication.ts
backend/scripts/seed-real.ts
backend/scripts/test-app-connection.ts
backend/scripts/test-catalog-http.js
backend/scripts/test-validation.ts
backend/scripts/validate-api.ts
backend/scripts/validate-links.ts
backend/scripts/verify-db.ts
backend/src/app.ts
backend/src/config/env.ts
backend/src/domain/categoryPublication.ts
backend/src/domain/orderInput.ts
backend/src/domain/rules.ts
backend/src/lib/prisma.ts
backend/src/mappers/catalog.mapper.ts
backend/src/mappers/order.mapper.ts
backend/src/middleware/errorHandler.ts
backend/src/routes/access.routes.ts
backend/src/routes/catalog.routes.ts
backend/src/routes/order.routes.ts
backend/src/security/accessLimits.ts
backend/src/security/adminSessions.ts
backend/src/security/password.ts
backend/src/security/writeGuard.ts
backend/src/services/adminAuth.service.ts
backend/src/services/catalog.service.ts
backend/src/services/comandaAccess.service.ts
backend/src/services/order.service.ts
backend/src/services/orderSession.ts
backend/tests/access.test.ts
backend/tests/catalog.test.ts
backend/tests/categoryPublication.test.ts
backend/tests/domain/rules.test.ts
backend/tests/fixtures/access.ts
backend/tests/fixtures/catalog.ts
backend/tests/fixtures/orders.ts
backend/tests/health.test.ts
backend/tests/integration-db-support.test.ts
backend/tests/integration-db/auth.integration.ts
backend/tests/integration-db/cleanup-stale.ts
backend/tests/integration-db/comandas.integration.ts
backend/tests/integration-db/globalSetup.ts
backend/tests/integration-db/orders.integration.ts
backend/tests/integration-db/security.integration.ts
backend/tests/integration-db/support/databases.ts
backend/tests/integration-db/support/fixtures.ts
backend/tests/integration-db/support/harness.ts
backend/tests/integration-db/support/permissions.ts
backend/tests/integration-db/support/preflight.ts
backend/tests/orders-csrf.test.ts
backend/tests/orders-rate-limit.test.ts
backend/tests/orders.test.ts
backend/tests/scripts/backup-restore-plan.test.ts
backend/tests/scripts/executor-seed-real.test.ts
backend/tests/scripts/fix-permissions-migration.test.ts
backend/tests/scripts/fixtures-role-provisioning.test.ts
backend/tests/scripts/inspect-reconciliation.test.ts
backend/tests/scripts/least-privilege-migration.test.ts
backend/tests/scripts/pg-hba-isolation.test.ts
backend/tests/scripts/seed-dev.test.ts
backend/tests/scripts/seed-real-corrected.test.ts
backend/tests/scripts/seed-real.test.ts
backend/tests/security/accessLimits-adversarial.test.ts
backend/tests/security/accessLimits.test.ts
backend/tests/services/access.service.test.ts
backend/tests/services/catalog.service.test.ts
backend/tests/services/order.service.test.ts
backend/tsconfig.build.json
backend/tsconfig.json
backend/vitest.integration.config.mts
frontend/docs/catalog-integration.md
frontend/package.json
frontend/src/App.tsx
frontend/src/AppWrapper.tsx
frontend/src/components/CartDrawer.tsx
frontend/src/components/Catalog.tsx
frontend/src/components/CatalogStatus.tsx
frontend/src/components/ComandaRedeem.tsx
frontend/src/components/ConnectionIndicator.tsx
frontend/src/components/OrderReview.tsx
frontend/src/components/ProductCard.tsx
frontend/src/components/ProductModal.tsx
frontend/src/contexts/CartContext.tsx
frontend/src/hooks/useCatalog.ts
frontend/src/index.css
frontend/src/main.tsx
frontend/src/pages/AdminDashboard.tsx
frontend/src/pages/AdminLogin.tsx
frontend/src/pages/Checkout.tsx
frontend/src/services/api.ts
frontend/src/services/catalogAdapter.ts
frontend/src/services/catalogSource.ts
frontend/src/services/catalogStore.ts
frontend/src/services/orderSubmission.ts
frontend/src/types/catalog.ts
frontend/tests/catalog-api.test.mjs
frontend/tests/catalog-fixtures.mjs
frontend/tests/catalog-state.test.mjs
frontend/tests/checkout.test.mjs
frontend/tests/http-client.test.mjs
frontend/tests/order-recovery.test.mjs
frontend/tests/order-submission.test.mjs
frontend/tests/register.mjs
frontend/tests/style-rules.mjs
frontend/tests/styles-smoke.test.mjs
frontend/tests/typescript-loader.mjs
frontend/tsconfig.json
Invoke-Validacao-3D37H.ps1
RELATORIO-ENTREGA-3D.2.11.md
RELATORIO-ENTREGA-3D.2.12.md
RELATORIO-ENTREGA-3D.2.13.1.md
RELATORIO-ENTREGA-3D.2.13.2.md
RELATORIO-ENTREGA-3D.2.13.3.md
RELATORIO-ENTREGA-3D.2.13.4.md
RELATORIO-ENTREGA-3D.2.13.5.md
RELATORIO-ENTREGA-3D.2.13.md
RELATORIO-ENTREGA-3D.2.14A.md
RELATORIO-ENTREGA-3D.2.14B.1.md
RELATORIO-ENTREGA-3D.2.14B.md
RELATORIO-ENTREGA-3D.2.14C.md
RELATORIO-ENTREGA-3D.2.14D.1.md
RELATORIO-ENTREGA-3D.2.14D.2.md
RELATORIO-ENTREGA-3D.3.1.md
RELATORIO-ENTREGA-3D.3.10.md
RELATORIO-ENTREGA-3D.3.11.md
RELATORIO-ENTREGA-3D.3.12.md
RELATORIO-ENTREGA-3D.3.13.md
RELATORIO-ENTREGA-3D.3.2.md
RELATORIO-ENTREGA-3D.3.3.md
RELATORIO-ENTREGA-3D.3.4.md
RELATORIO-ENTREGA-3D.3.5.md
RELATORIO-ENTREGA-3D.3.6.md
RELATORIO-ENTREGA-3D.3.7.md
RELATORIO-ENTREGA-3D.3.8.md
RELATORIO-ENTREGA-3D.3.9-ADENDO-3D.3.10.md
RELATORIO-ENTREGA-3D.3.9.md
```
