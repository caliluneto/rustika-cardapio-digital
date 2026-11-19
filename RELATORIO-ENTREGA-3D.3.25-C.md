# RELATÓRIO DE ENTREGA — 3D.3.25-C

Auditoria final, preparação do primeiro commit e validação **estática** do GitHub Actions. Nada foi commitado, publicado ou executado remotamente. Não criei remoto nem repositório, não rodei workflow, Playwright, migrations, seeds ou containers, não alterei senhas, bancos, histórico, refs do Cline/Codex, configuração global do Git/Windows nem outros projetos.

Legenda: **APROVADA** · **FALHOU** · **BLOQUEADA** · **PREPARADA, MAS NÃO EXECUTADA**.

## 1. Parecer final de segurança

**Aprovado para o primeiro commit e para o push restrito de `main:main` em repositório privado e vazio**, com as ressalvas da seção 8. Fundamentos:

- Os 49 arquivos do plano (seção 2) não contêm nenhuma das três senhas reais carregadas dos arquivos de segredos (comparação em memória, só contagens impressas), nem chave privada, token ou URL de banco com senha literal.
- As 3 commits de `main` (a publicar) não contêm as duas senhas fortes (8 e 26 caracteres). Um valor de **6 caracteres**, do perfil `migrate-test`, aparece no histórico e em 4 testes como dado comum de teste (`backend/tests/domain/rules.test.ts`, `frontend/tests/cart.test.mjs`, `checkout.test.mjs`, `order-review.test.mjs`). Não consegui separar "coincidência" de "senha real reaproveitada" sem imprimir o valor; trato como risco baixo-mas-real (seção 11) e a senha é fraca de qualquer modo.
- 16 linhas de `main` têm o formato `postgresql://usuario:senha@…` (testes e scripts `.ps1` do laboratório RF004). Nenhuma contém uma senha real carregada; são valores de exemplo/teste.
- `main` tem 3 commits, 0 tags, nenhum `.env` real (só `backend/.env.example` e `frontend/.env.example`), maior blob 116 KB.
- Não há configuração de push (`push.*`, `remote.*`, `push.followTags`) em nenhum escopo do Git; o único remoto futuro será o que o usuário criar.
- O E2E e o PostgreSQL efêmero **seguem sem execução real**: não afirmo que o CI funciona.

## 2. Manifesto dos arquivos publicáveis (49)

Estado: **M** = rastreado e modificado; **N** = novo. Risco de exposição: **nenhum** salvo indicação. "Verificado" = revisado nesta etapa ou na 3D.3.25-B e coberto pela varredura de segredos.

### Commit 1 — Segurança e saneamento (15)

| Caminho | Git | Motivo | Dependências | Resultado |
|---|---|---|---|---|
| `.gitignore` | M | impede publicar segredos, dumps, planilha privada, scripts soltos, cópias do OneDrive | — | aprovado |
| `backend/package.json` | M | scripts `e2e:*`, `secrets:audit`, `test:ci`; deps `xlsx`, `pg` | `package-lock.json` | aprovado |
| `backend/package-lock.json` | M | coerente com o package (`npm ci --dry-run` ok) | — | aprovado |
| `frontend/package.json` | M | Playwright 1.64.1 e testes de guarda no `test` | lockfile | aprovado |
| `frontend/package-lock.json` | M | idem (`npm ci --dry-run` ok) | — | aprovado |
| `backend/src/config/env.ts` | M | `.trim()` de `NODE_ENV` (evita `"test "` desligar a guarda) | `env.test.ts` | aprovado |
| `backend/tests/config/env.test.ts` | M | cobre o `trim` | `env.ts` | aprovado |
| `backend/tests/audit-secrets.test.ts` | N | testa a auditoria; **valores sintéticos** | `audit-secrets.ts` | aprovado |
| `backend/scripts/audit-secrets.ts` | N | auditoria de segredos sem imprimir valores | `src/config/secrets.ts` (rastreado) | aprovado |
| `backend/docs/secrets-rotation.md` | N | procedimento de rotação, sem valores | — | aprovado |
| `backend/scripts/analyze-excel.ts` | M | `xlsx.readFile` → `xlsx.read(readFileSync(...))` | `xlsx` | aprovado (seção 3) |
| `backend/scripts/analyze-excel2.ts` | M | idem | `xlsx` | aprovado |
| `backend/scripts/executor-seed-real.ts` | M | idem | `seed-real.ts` | aprovado |
| `backend/scripts/inspect-reconciliation.ts` | M | idem | `seed-real.ts`, `secrets.ts` | aprovado |
| `backend/scripts/seed-real.ts` | M | idem (3 pontos) | `xlsx` | aprovado |

### Commit 2 — CI e infraestrutura (6)

| Caminho | Git | Motivo | Dependências | Resultado |
|---|---|---|---|---|
| `.github/workflows/ci.yml` | N | workflow; Actions por SHA; sem secrets | `bootstrap.sql`, `pg_hba.ci.conf`, SQL do projeto | aprovado (estático) |
| `.github/ci/bootstrap.sql` | N | roles e bancos efêmeros; senhas por variável psql | — | **não executado** |
| `.github/ci/pg_hba.ci.conf` | N | `pg_hba` do runner (fixtures só no banco Test; SCRAM; loopback) | — | **não executado** |
| `backend/vitest.unit.config.mts` | N | config do `npm run test:ci`; exclui testes da planilha privada **só se ela estiver ausente** | `package.json` | aprovado |
| `backend/tests/ci-config.test.ts` | N | 36 testes estáticos do workflow, do `.gitignore` e do checkout limpo | `ci.yml`, `.gitignore` | aprovado |
| `backend/docs/github-actions-e2e.md` | N | operação, SHAs, publicação só de `main`, reversão | — | aprovado |

### Commit 3 — Testes e E2E (28)

| Caminho | Git | Motivo | Dependências | Resultado |
|---|---|---|---|---|
| `frontend/playwright.config.ts` | N | 1 worker, 0 retries, portas 4100/5174, exige confirmação | `globalSetup/Teardown` | aprovado |
| `frontend/tests/e2e.spec.ts` | N | jornada catálogo→pedido | config, backend E2E | **não executado** |
| `frontend/tests/globalSetup.ts` | N | chama `run-setup.ts` (processo filho) | `backend/tests/integration-db/e2e/*` | **não executado** |
| `frontend/tests/globalTeardown.ts` | N | chama `run-teardown.ts` | idem | **não executado** |
| `frontend/tests/e2e-guard.test.mjs` | N | trava da config sem confirmação | config | aprovado |
| `frontend/tests/vite-env-injection.test.mjs` | N | injeção `VITE_*` | `api.ts`, `vite-env.d.ts` | aprovado |
| `frontend/src/components/Header.tsx` | M | alteração de UI de fases anteriores | — | aprovado (sem segredo) |
| `frontend/src/services/api.ts` | M | `configuredApiUrl` exportada | `vite-env.d.ts` | aprovado |
| `frontend/src/services/orderSubmission.ts` | M | flag de envio de pedido | — | aprovado |
| `frontend/src/vite-env.d.ts` | M | tipos `VITE_*` | — | aprovado |
| `backend/scripts/inspect-e2e-state.ts` | N | inspeção somente leitura (`e2e:inspect`) | `databases.ts` | aprovado |
| `backend/tests/e2e-fixtures.test.ts` | N | 83 testes do ciclo E2E sem banco | `e2e/*` | aprovado |
| `backend/tests/e2e-launch-env.test.ts` | N | `guardedLaunch` | `launch-env.ts`, `launch-probe.ts` | aprovado |
| `backend/tests/helpers/fake-fixtures-db.ts` | N | banco falso para testes | — | aprovado |
| `backend/tests/helpers/launch-probe.ts` | N | sonda de ambiente | `launch-env.ts` | aprovado |
| `backend/tests/integration-db/comandas.integration.ts` | M | integração (fora do `npm test`) | gates | aprovado |
| `backend/tests/integration-db/support/databases.ts` | M | perfis/gates de integração | `secrets.ts` | aprovado |
| `backend/tests/scripts/pg-hba-isolation.test.ts` | M | isolamento do `pg_hba` | — | aprovado |
| `backend/tests/integration-db/e2e/cleanup-legacy.ts` | N | limpeza restrita (já usada na 3D.3.23-E) | `launch-env`, `gate`, `legacy` | aprovado |
| `backend/tests/integration-db/e2e/gate.ts` | N | gates do E2E | — | aprovado |
| `backend/tests/integration-db/e2e/launch-env.ts` | N | snapshot do ambiente de lançamento | — | aprovado |
| `backend/tests/integration-db/e2e/legacy.ts` | N | inspeção do resíduo legado | — | aprovado |
| `backend/tests/integration-db/e2e/lifecycle.ts` | N | ciclo setup/teardown | `manifest.ts` | aprovado |
| `backend/tests/integration-db/e2e/manifest.ts` | N | manifesto fora do repositório e do OneDrive | — | aprovado |
| `backend/tests/integration-db/e2e/real.ts` | N | fixtures reais sintéticas | — | aprovado |
| `backend/tests/integration-db/e2e/run-setup.ts` | N | entrada do setup | `launch-env.ts` (1º import) | **não executado** |
| `backend/tests/integration-db/e2e/run-teardown.ts` | N | entrada do teardown | idem | **não executado** |
| `backend/docs/e2e-real.md` | N | procedimento local do E2E | — | aprovado |

### Fora do manifesto (decididos)

- `README.md`, `backend/src/middleware/errorHandler.ts`, `frontend/src/App.tsx`: só diferem em final de linha; **não** incluir.
- `RELATORIO-ENTREGA-3D.3.15.md`, `3.16.md` (alterações reais pequenas) e os 66 relatórios não rastreados (60 na raiz e 6 em `backend/`): contêm caminhos locais e o nome do usuário; **não incluídos por padrão**.
- Arquivos ignorados e as 32 cópias `*-Calil-Notebook.*`: não publicáveis.

### Verificação de integridade do manifesto

Comparação automática entre o plano e `git status` (excluindo relatórios e os 3 só de final de linha): **49 planejados, 49 reais, 0 esquecidos, 0 inexistentes, 0 duplicados**. A contagem passou de 48 para 49 por causa de `backend/vitest.unit.config.mts`, criado nesta etapa.

## 3. Auditoria dos cinco scripts sensíveis

Arquivos reais: `backend/scripts/analyze-excel.ts`, `analyze-excel2.ts`, `executor-seed-real.ts`, `inspect-reconciliation.ts`, `seed-real.ts` (todos `.ts`, rastreados em HEAD). Comparação com HEAD (ignorando final de linha): **3 a 5 linhas por arquivo**, todas do mesmo tipo.

| Item | Resultado |
|---|---|
| Alteração | `xlsx.readFile(caminho)` → `xlsx.read(readFileSync(caminho), { type: 'buffer' })` + `import { readFileSync } from 'fs'`. Mesmo arquivo lido, mesma planilha; só muda a forma de abrir (compatibilidade ESM/`xlsx`). Funcionalidade inalterada. |
| Credenciais hardcoded | nenhuma (varredura por senha/segredo/token/URL) |
| Caminhos absolutos locais | nenhum; todos usam `path.join(__dirname, '../data/Exportacao-produtos.xlsx')` |
| Operações destrutivas | nenhuma nestes cinco arquivos (sem `deleteMany`, `DROP`, `TRUNCATE`); o único SQL cru é `SET TRANSACTION READ ONLY` em `inspect-reconciliation.ts` |
| Planilha privada | os cinco dependem de `backend/data/Exportacao-produtos.xlsx` (ignorada, fora do Git) |
| Banco real | `inspect-reconciliation.ts` usa `loadDatabaseProfile('app-dev')` somente leitura e restringe o destino (`assertDevTarget`); nenhum executa por import |
| Variáveis de ambiente | só `process.env` em `inspect-reconciliation.ts` (injeção do ambiente para validar destino) |
| Necessários ao CI? | **Sim**: testes do CI (`tests/scripts/*`) importam esses módulos e o `tsc` os inclui (`include: scripts`). Sem eles o typecheck de um clone limpo quebra. |

Decisão: **incluir no Commit 1** (alteração mínima, sem segredo, funcionalidade preservada). Nenhum script foi executado e nada foi alterado neles.

**Achado novo (corrigido):** os testes desses scripts leem a planilha real. Em um clone limpo **50 testes falhavam** (5 arquivos, `ENOENT`). Isso derrubaria o job `backend` no primeiro run. Correção: `vitest.unit.config.mts` + script `test:ci`, que exclui esses cinco arquivos somente quando a planilha está ausente (seção 7). Um teste existente proíbe `vitest.config.ts` (garante que a suíte com escrita nunca entre em `npm test`); **não o afrouxei**, por isso usei outro nome de arquivo.

## 4. Verificação dos gatilhos do CI

Todos verificados por leitura do `ci.yml` e por 12 novos testes de regressão (em `ci-config.test.ts`). Não executei workflow.

| # | Requisito | Resultado |
|---|---|---|
| 1 | backend/frontend só nos eventos previstos | **APROVADA**: `pull_request` e `workflow_dispatch`; jobs com `if` explícito |
| 2 | E2E depende de `workflow_dispatch` e `run_e2e=true` | **APROVADA**: condição única, sem `||`, mais repositório privado |
| 3 | PR não inicia Playwright com escrita | **APROVADA**: a condição do job exclui `pull_request` |
| 4 | push não dispara E2E | **APROVADA**: não há gatilho `push` nem `schedule` nem `pull_request_target` |
| 5 | sem URL arbitrária de PostgreSQL | **APROVADA**: os 4 inputs são booleanos; nenhum `inputs.*` é interpolado em comandos; banco só em loopback, fixo |
| 6 | sem credencial local | **APROVADA**: nenhum `secrets.*`; senhas geradas no runner e mascaradas |
| 7 | permissões mínimas | **APROVADA**: `contents: read`; sem `id-token`/`write` |
| 8 | SHAs = ações oficiais | **APROVADA**: reconferidos agora com `git ls-remote` em `github.com/actions/*`; os três SHAs completos estão logo abaixo da tabela |
| 9 | timeouts | **APROVADA**: 15, 15 e 30 minutos |
| 10 | artefatos sem secrets | **APROVADA**: só `frontend/test-results/`, opt-in, só em falha, retenção de 3 dias; a pasta de segredos e o estado final ficam fora |

SHAs completos: `d23441a48e516b6c34aea4fa41551a30e30af803` (checkout), `249970729cb0ef3589644e2896645e5dc5ba9c38` (setup-node), `b7c566a772e6b6bfb58ed0dc250532a479d7789f` (upload-artifact).

Limite: PRs vindos de forks recebem token somente leitura e nenhum secret, e o E2E não roda neles. Não configurei nada no GitHub (sem remoto). O ajuste "exigir aprovação para workflows de forks" é do passo 7 do manual (seção 10).

## 5. Revisão da receita do PostgreSQL efêmero

**Validação estática. Nada disto foi executado** (sem Docker, sem banco local).

| Ponto | Avaliação |
|---|---|
| Sequência | pré-condições → deps → senhas/segredos → container → bootstrap → migrations → fixtures → inspeção → Playwright → inspeção final → limpeza. Coerente. |
| Roles | `bootstrap.sql` cria `cardapio_migrator`, `cardapio_test_app` (LOGIN, sem privilégios) e `cardapio_dev_app` (NOLOGIN, exigida pela migration `20261104000000`). `cardapio_test_fixtures` vem do SQL oficial do projeto, sem alteração. |
| `pg_hba` | fixtures só no banco Test, SCRAM, loopback; as 5 regras do exemplo do projeto vêm primeiro; nenhuma regra `all`/grupo/regex; `local all postgres trust` só no socket do container. Qualquer outra conexão cai em "sem regra" = recusada, o que o preflight exige. |
| Rede | `--network host` + `listen_addresses=127.0.0.1`: o servidor enxerga `127.0.0.1`, como exigem os scripts de provisão (`inet_server_addr`). Ponte do Docker mudaria isso. |
| Secrets | `openssl rand -hex 24`, `::add-mask::`, `umask 077`, pasta em `${{ runner.temp }}` (fora do workspace e sem "onedrive"), como exige `resolveSecretsDir`. |
| Versões | `postgres:18` (≥ 17 exigido). O ambiente local do projeto já roda PostgreSQL 18.6 com Prisma 6.19.3, mas **a compatibilidade Prisma × PostgreSQL 18 não foi verificada neste workflow**; só a primeira execução mostra. |
| Healthcheck | laço de 40 tentativas com `pg_isready` pelo socket; falha silenciosa se esgotar, mas o `psql select version()` seguinte falharia (`set -e`). |
| Correção desta etapa | `ALTER ROLE … PASSWORD :'fix_pw'` estava em `psql -c`; a interpolação de variáveis não é garantida em `-c`. Passou a ir por `stdin` (`printf … \| psql -v`). Mudança no `ci.yml`, não nos scripts SQL do projeto. |
| Cleanup | `always()`: remove container, pasta de segredos, estado final e `rustika-e2e`. Se o runner morrer, o ambiente descartável some junto. |
| Dependência de Windows/OneDrive/caminho local | **nenhuma encontrada** no caminho do E2E; as únicas menções a "OneDrive" são proibições (rejeitam pastas do OneDrive). O código não usa `win32`, PowerShell nem `cmd`. `globalSetup/Teardown` usam `process.execPath` + `tsx` (portátil). |
| Ubuntu 24.04 | `ss`, `openssl`, `docker`, `bash` presentes na imagem `ubuntu-24.04`. Sem teste real. |
| Riscos não descartados | `localhost` do Vite/Playwright (IPv4 × IPv6); tempo do `playwright install --with-deps`; nomes/ordem de roles; `enable-test-fixtures-login.sql` conferindo o `pg_hba` pelo caminho do container; `trace`/`screenshot` do Playwright. Só a primeira execução esclarece. |

Gates não foram modificados.

## 6. Cobertura Playwright preparada

- Arquivos necessários estão todos no manifesto: `playwright.config.ts`, `e2e.spec.ts`, `globalSetup.ts`, `globalTeardown.ts`, `e2e-guard`/`vite-env-injection`, e o backend E2E (`gate`, `launch-env`, `legacy`, `lifecycle`, `manifest`, `real`, `run-setup`, `run-teardown`, `cleanup-legacy`), mais `inspect-e2e-state.ts`.
- Config: **1 worker**, **0 retries**, Chromium (`devices['Desktop Chrome']`), `reuseExistingServer: false`, portas 4100/5174 com `--strictPort`, recusa carregar sem `RUSTIKA_E2E_CONFIRM`. O CI instala `chromium` com `npx playwright install --with-deps chromium` e roda `--workers=1 --project=chromium --reporter=line`.
- Versão do Chromium: a do Playwright 1.64.1 do lockfile (não fixada separadamente).
- Relatórios de falha: saída `line`; `trace: 'on-first-retry'` não produz nada com 0 retries, e não há `screenshot`. Deixei assim para não ampliar o que pode vazar; diagnóstico só por opt-in (`upload_diagnostics`) e `test-results/`.
- Cobertura real: **um** teste de jornada (catálogo → carrinho → login admin → convite → comanda → checkout → pedido persistido → limpeza com prova de resíduo zero). Não há teste de administração, quantidades ou categorias no navegador. Não foram acrescentados para não exigir seletores não validados nem funcionalidades inexistentes.
- **PREPARADA, MAS NÃO EXECUTADA.**

## 7. Testes executados e resultados

| Verificação | Resultado |
|---|---|
| Backend `vitest run` (local, planilha presente) | **APROVADA**: 33 arquivos, **723/723** |
| Backend `npm run test:ci` (local) | **APROVADA**: 723/723 |
| Backend em **clone limpo simulado** (cópia dos arquivos rastreados + candidatos, sem planilha, sem `node_modules` próprio) com `test:ci` | **APROVADA**: 28 arquivos, **547/547** (aviso de exclusão impresso) |
| Mesmo clone limpo com `npm test` simples | **FALHOU**: 50 testes em 5 arquivos (`ENOENT` da planilha) — era o problema encontrado; o CI usa `test:ci` |
| Backend `tsc --noEmit` em clone limpo | **APROVADA** (0 erros) |
| Frontend `npm test` em clone limpo | **APROVADA**: 99/99 |
| Frontend `tsc --noEmit` em clone limpo | **APROVADA** |
| Frontend `tsc` e `vite build` (local, antes da etapa) | **APROVADA**; arquivos do frontend não mudaram nesta etapa |
| YAML do `ci.yml` (parser `yaml`) | **APROVADA** (3 jobs), reexecutado após as edições |
| `bash -n` nos 23 blocos `run` | **APROVADA**, reexecutado após as edições |
| SHAs das Actions (`git ls-remote`) | **APROVADA** (iguais aos do workflow) |
| `npm ci --dry-run` backend e frontend | **APROVADA** |
| Varredura de segredos (49 arquivos + `main`) | **APROVADA** (seção 1) |
| `ci-config.test.ts` | **APROVADA**: 36 testes (eram 24) |
| Testes de integração, E2E, workflows remotos | **PREPARADA, MAS NÃO EXECUTADA** |

### Erros do arquivo legado `verify-fixtures-rotation.ts` (registrados separadamente)

`backend/tests/scripts/verify-fixtures-rotation.ts` (não rastreado, ignorado, não alterado, não movido):

1. `TS7016`: módulo `pg` sem declaração de tipos (linha 1).
2. `TS2307`: módulo `./src/config/secrets` não encontrado (linha 2).

Eles quebram o `tsc --noEmit` completo **apenas nesta máquina**. Em clone limpo o arquivo não existe, e o `tsc` passou com 0 erros. Não afeta Vitest nem o CI.

## 8. Pendências remanescentes

1. Primeira execução real do CI e do E2E (bootstrap do banco efêmero e Playwright nunca rodaram).
2. **Decisão do usuário:** a planilha `Exportacao-produtos.xlsx` fica fora do Git, e no CI os 5 arquivos de teste que dependem dela não rodam. Alternativas: manter assim (padrão adotado); ou versionar a planilha no repositório privado (decisão sobre dado comercial); ou criar uma planilha sintética e ajustar os testes (trabalho futuro).
3. **Decisão do usuário:** o valor de 6 caracteres do `migrate-test` (seção 1): rotação é recomendada antes de qualquer uso fora do notebook.
4. Commits intermediários não são validados individualmente pelo CI (não há gatilho em `push`; o CI roda em PR/manual). O estado final é o verificado.
5. Mudanças em `README.md`, `errorHandler.ts` e `App.tsx` (final de linha) ficam fora; o Git as mostrará como modificadas.
6. Os 66 relatórios e `3.15/3.16` ficam fora do primeiro conjunto.
7. Majors mais novos das Actions (v7) não adotados.
8. Quem adicionou ao índice (`A`) três documentos na etapa anterior segue desconhecido; estão sem stage.
9. O serviço claude-mem do assistente segue sem credenciais (não afeta o projeto).

## 9. Plano dos três commits

Ordem e mensagens sugeridas (você executa; eu não executei nada). Cada comando usa caminhos explícitos; nunca `git add .`.

**Commit 1 — Segurança e saneamento** (15 arquivos):

```bash
git add .gitignore backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json
git add backend/src/config/env.ts backend/tests/config/env.test.ts backend/tests/audit-secrets.test.ts backend/scripts/audit-secrets.ts backend/docs/secrets-rotation.md
git add backend/scripts/analyze-excel.ts backend/scripts/analyze-excel2.ts backend/scripts/executor-seed-real.ts backend/scripts/inspect-reconciliation.ts backend/scripts/seed-real.ts
git diff --cached --stat
git commit -m "chore(seguranca): gitignore, auditoria de segredos e ajustes seguros de configuracao"
```

**Commit 2 — CI e infraestrutura** (6 arquivos):

```bash
git add .github/workflows/ci.yml .github/ci/bootstrap.sql .github/ci/pg_hba.ci.conf
git add backend/vitest.unit.config.mts backend/tests/ci-config.test.ts backend/docs/github-actions-e2e.md
git diff --cached --stat
git commit -m "ci: workflow do GitHub Actions com PostgreSQL efemero e testes estaticos do workflow"
```

**Commit 3 — Testes e E2E** (28 arquivos):

```bash
git add frontend/playwright.config.ts frontend/tests/e2e.spec.ts frontend/tests/globalSetup.ts frontend/tests/globalTeardown.ts frontend/tests/e2e-guard.test.mjs frontend/tests/vite-env-injection.test.mjs
git add frontend/src/components/Header.tsx frontend/src/services/api.ts frontend/src/services/orderSubmission.ts frontend/src/vite-env.d.ts
git add backend/scripts/inspect-e2e-state.ts backend/tests/e2e-fixtures.test.ts backend/tests/e2e-launch-env.test.ts backend/tests/helpers/fake-fixtures-db.ts backend/tests/helpers/launch-probe.ts
git add backend/tests/integration-db/comandas.integration.ts backend/tests/integration-db/support/databases.ts backend/tests/scripts/pg-hba-isolation.test.ts
git add backend/tests/integration-db/e2e/cleanup-legacy.ts backend/tests/integration-db/e2e/gate.ts backend/tests/integration-db/e2e/launch-env.ts backend/tests/integration-db/e2e/legacy.ts backend/tests/integration-db/e2e/lifecycle.ts backend/tests/integration-db/e2e/manifest.ts backend/tests/integration-db/e2e/real.ts backend/tests/integration-db/e2e/run-setup.ts backend/tests/integration-db/e2e/run-teardown.ts
git add backend/docs/e2e-real.md
git diff --cached --stat
git commit -m "test: E2E Playwright com gates, fixtures sinteticas e regressoes"
```

Antes de cada `git commit`, conferir `git diff --cached --name-only` contra as tabelas da seção 2. Conferir também `git status --short` ao final: devem sobrar apenas `README.md`, `errorHandler.ts`, `App.tsx`, `RELATORIO-*` e `3.15/3.16`.

## 10. Comandos de publicação (NÃO EXECUTADOS)

Só depois da sua autorização e da auditoria dos três commits.

1. **Criar o repositório privado e vazio** no GitHub (sem README, sem `.gitignore`, sem licença). Pela interface web: New repository → *Private* → não inicializar. Alternativa pela CLI: `gh repo create <dono>/<nome> --private`.
2. **Verificar a privacidade:**

```bash
gh repo view <dono>/<nome> --json visibility,isPrivate
```

3. **Configurar o remoto** (só depois de verificar):

```bash
git remote add origin https://github.com/<dono>/<nome>.git
git remote -v
git config --get-regexp "^(push|remote)\."
```

4. **Executar os commits** da seção 9.
5. **Publicar somente `main:main`**, sem tags e sem outras refs:

```bash
git push --no-tags -u origin main:main
```

Nunca `--all`, `--mirror`, `--tags` ou `refs/*`.

6. **Confirmar o que foi publicado** (deve listar só `refs/heads/main`):

```bash
git ls-remote --heads --tags origin
git ls-tree -r --name-only origin/main | grep -E "(^|/)\.env($|\.)|\.dump$|\.pem$|secrets/|data/"
```

O segundo comando só deve devolver os dois `.env.example`.

7. **Configurar o Actions no GitHub** (interface): Settings → Actions → General: permitir apenas ações do próprio GitHub (ou "selected"), *Workflow permissions* = somente leitura, *Fork pull request workflows* = exigir aprovação.
8. **Executar primeiro só os jobs não destrutivos:** Actions → CI → *Run workflow* com `run_backend` e `run_frontend` marcados e `run_e2e` **desmarcado**. Esperado: backend 547 testes (aviso de planilha ausente) e frontend 99.
9. **Pedir autorização específica** (nova etapa) para o primeiro E2E com PostgreSQL efêmero (`run_e2e` marcado), com `upload_diagnostics` desmarcado na primeira tentativa.
10. **Inspecionar os resultados:** resumo do job, passo "Estado final" (resíduo zero), cauda dos logs do PostgreSQL (URLs mascaradas) e, se anexados, os artefatos de `frontend/test-results/`.

**Alternativa mais segura** (recomendada se houver dúvida sobre refs): em outra pasta fora do OneDrive, `git clone --single-branch --branch main <caminho-do-repo-local> limpo` e publicar a partir dele. Não criei esse clone.

## 11. Lista de riscos

| Risco | Gravidade | Mitigação |
|---|---|---|
| CI/E2E nunca executados; o primeiro run pode falhar por detalhes do runner | média | rodar primeiro só backend/frontend; E2E só com autorização |
| 231 commits com credenciais reais em `refs/cline/*` e `refs/codex/*` | **alta se publicadas** | `push main:main` com `--no-tags`; conferir `ls-remote`; clone limpo como alternativa |
| Valor de 6 caracteres do `migrate-test` no histórico/testes | baixa a média | rotação antes de uso fora do notebook |
| Senhas reais fracas/compartilhadas (8 dígitos; 3 papéis) | média | rotação (proibida nesta etapa); risco aceito pelo usuário |
| Planilha privada ausente no CI: 5 arquivos de teste não rodam lá | média (cobertura) | decisão do usuário (seção 8, item 2) |
| Compatibilidade Prisma 6 × PostgreSQL 18 no runner não testada | baixa | primeira execução do E2E |
| OneDrive pode criar novas cópias de conflito ou alterar `.git` | média | pausar a sincronização durante Git; publicar de clone limpo |
| Commits intermediários não validados pelo CI | baixa | o estado final é o verificado |
| Majors novos das Actions não adotados | baixa | atualizar por SHA verificado |
| Arquivo legado quebra o `tsc` local | baixa | ignorado; fora do CI |

## 12. Parecer final

**PRONTO para o primeiro commit** (três commits locais, seção 9) e **PRONTO COM RESSALVAS para o push restrito de `main:main`** em repositório privado e vazio: as ressalvas são as decisões da seção 8 (planilha e senha curta) e a autorização expressa do usuário. **NÃO** há parecer sobre o funcionamento do CI nem do E2E: dependem da primeira execução real.

Etapa aprovada no escopo local. Nada foi publicado.
