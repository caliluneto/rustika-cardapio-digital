# RELATÓRIO DE ENTREGA — 3D.3.25-E

Correção do parser de cabeçalhos do executor, validação definitiva da dependência `xlsx` e preparação final dos três commits. **Nada foi commitado, publicado ou executado remotamente.** Não rodei o seed real, PostgreSQL, migrations, Playwright nem workflows, não alterei senhas, bancos, planilha real, histórico, refs do Cline/Codex, configuração global do npm/Git/Windows nem outros projetos, e não apaguei arquivos.

Legenda: **APROVADA** · **FALHOU** · **BLOQUEADA** · **PREPARADA, MAS NÃO EXECUTADA**.

## 1. Correção do parser

**Causa comprovada.** Em `backend/scripts/executor-seed-real.ts` (idêntico no HEAD), os acessos às colunas `"Código"` e `"Preço venda"` estavam gravados com os bytes `EF BF BD` (U+FFFD, texto corrompido). A planilha real tem os cabeçalhos `Código` e `Preço venda` (confirmado lendo só os nomes dos cabeçalhos). Como a chave nunca existia, o executor lia **`codigo` = `""` e `preco` = `0`**, em silêncio, para todas as linhas.

**Efeitos que isso mascarava** (agora corrigidos):
- a regra `0.01 → INSUMO` nunca disparava no executor (o preço sempre era 0);
- a reconciliação do dry-run comparava todos os produtos com o código `""`, portanto não casava nenhum produto existente por `sourceCode`;
- os quantitativos 144/24/6 só batiam porque, na planilha real, os itens de `0.01` já estão no grupo INSUMO.

**Correção (somente interpretação dos cabeçalhos):**
- `CATALOG_COLUMNS` com os nomes reais (`Código`, `Preço venda`, `Nome curto`, `Estado`, `Grupo`);
- `assertCatalogColumns(data)`: falha com mensagem nomeando os cabeçalhos ausentes ou inválidos (um cabeçalho com U+FFFD é recusado);
- `toCatalogRecord(row)`: código vazio em produto ativo e preço ilegível agora **interrompem** a importação, em vez de virarem `""` e `0`;
- ordem do executor: ler dados → checar cabeçalhos → validar preços → classificar.

Regras de negócio, classificação, preços e PostgreSQL **não foram alterados**; o seed real não foi executado.

**Pendência cosmética, não corrigida:** a mensagem de console da linha 192 ("execu��o real") também tem U+FFFD. Não é leitura de cabeçalho e foi mantida por escopo.

**Prova de que o comportamento de negócio não mudou na planilha real** (teste somente leitura, passou aqui): o plano do executor continua **144 / 24 / 6 / 30 / 204** e o executor e o relatório de `seed-real` classificam as 174 linhas ativas com os mesmos códigos e classes.

## 2. Testes de regressão

`backend/tests/scripts/executor-columns.test.ts` (10 testes) e +1 teste em `private-catalog.test.ts`:

| Requisito | Teste | Resultado |
|---|---|---|
| leitura correta do código | `Código` 44→`'44'`, `' 77 '`→`'77'` | APROVADA |
| códigos alfanuméricos preservados | `SX000001` mantido | APROVADA |
| leitura correta do preço | 12.5, `'26'`; `0.01` em DIVERSOS → INSUMO (antes não disparava) | APROVADA |
| sem código vazio silencioso | linha ativa sem código → erro "Codigo vazio" | APROVADA |
| sem preço zero silencioso | preço ausente ou `abc` → erro "Preco ilegivel" | APROVADA |
| cabeçalhos ausentes/inválidos | sem `Código`, sem `Preço venda`, `C�digo`, vazio → erro nomeado; no executor aborta antes de consultar o banco | APROVADA |
| nenhum U+FFFD em acesso a coluna | varredura do código-fonte | APROVADA |
| planilha sintética | executor = relatório (mesmos códigos/classes); plano 144/24/6/30/204; reconciliação enxerga o código `44` (1 correto, 173 ausentes) | APROVADA |
| planilha real, somente leitura | cabeçalhos OK, nenhum código vazio, preços > 0, mesma classificação do relatório | APROVADA localmente (skipped no CI) |

## 3. Instalação de `xlsx`

| Item | Resultado |
|---|---|
| Declaração | `backend/package.json`: `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` |
| Lockfile | versão `0.20.3`, `resolved` = a mesma URL oficial, `integrity` sha512 presente |
| Integridade | **APROVADA**: baixei o tarball da CDN (2.409.319 bytes, HTTP 200) e o sha512 **confere** com o do lockfile; `package.json` interno: `xlsx 0.20.3`, Apache-2.0 |
| Pacotes fora do registro npm | apenas o `xlsx`; todos os pacotes resolvidos têm `integrity` |
| npm 10 (o do runner com Node 22) | **APROVADA**: `npx npm@10` = 10.9.10, `npm ci` instala 206 pacotes no backend e 72 no frontend, **sem opção extra** |
| npm 12 (esta máquina, Node 24) | **FALHA** com `EALLOWREMOTE` (`allow-remote=none` por padrão); `--allow-remote=root` resolve, só nesse comando |
| Política de downloads remotos | o workflow usa `npm ci`, sem `--force`, `--ignore-scripts`, `allow-remote` ou desativação de integridade/TLS (testado) |
| Ubuntu / Node 22 | `ubuntu-24.04` + `node-version: '22'`; **não** testei com Node 22 nem em Ubuntu real (testei npm 10.9.10 sobre Node 24 no Windows) |
| Lockfile/config alterados | **nenhum**: sem justificativa comprovada |

Origem externa e riscos (documentados em `backend/docs/github-actions-e2e.md`): URL oficial `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`; a versão do registro npm (`0.18.x`) é antiga e tem vulnerabilidades conhecidas, por isso a CDN oficial; riscos: indisponibilidade da CDN quebra o `npm ci`; npm ≥ 12 bloqueia origens remotas por padrão. Três testes novos em `ci-config.test.ts` falham se a origem/versão mudar, o hash sumir, surgir outro pacote fora do registro, ou o workflow desligar integridade.

## 4. Resultados do clone limpo

Cópia nova (`clean3`): 225 arquivos que o Git veria, **sem** `backend/data`, `.env`, cópias do OneDrive, relatórios, `node_modules` nem arquivos ignorados; `CARDAPIO_SECRETS_DIR` vazio; `npm ci` real com **npm 10.9.10** (com scripts).

| Passo | Resultado |
|---|---|
| Testes de importação (`tests/scripts`) | **APROVADA**: 278 passaram, 7 skipped |
| Testes de segurança (`audit-secrets`, `ci-config`, `e2e-launch-env`, `integration-db-support`) | **APROVADA**: 103/103 |
| Backend completo (`npm test` e `npm run test:ci`) | **APROVADA**: **746 passaram, 7 skipped, 0 falhas** |
| Frontend `npm test` | **APROVADA**: 99/99 |
| Typecheck backend e frontend | **APROVADA** (0 erros) |
| Build backend (`tsc -p tsconfig.build.json`) e frontend (`vite build`) | **APROVADA** |

Os 7 *skipped* são exatamente os testes que exigem a planilha real. Na máquina local (planilha presente): `npm test` **753/753**. O arquivo legado `verify-fixtures-rotation.ts` mantém **2 erros** no `tsc` local (`TS7016` módulo `pg` sem tipos; `TS2307` módulo `./src/config/secrets` ausente), só aqui; no clone limpo ele não existe. Não foi alterado nem movido.

## 5. Verificações estáticas

| Verificação | Resultado |
|---|---|
| YAML do `ci.yml` (3 jobs) | **APROVADA** |
| `bash -n` nos 23 blocos `run` | **APROVADA** |
| `ci.yml` do clone idêntico ao do repositório | **APROVADA** |
| SHAs das Actions (`git ls-remote`) | **APROVADA** (iguais aos do workflow) |
| Workflows remotos, PostgreSQL efêmero, Playwright | **PREPARADA, MAS NÃO EXECUTADA** |

## 6. Segurança do primeiro commit

- Comparação em memória das 3 senhas reais distintas contra os 61 arquivos do plano e contra a `main` (só contagens): as senhas de **8** e **26** caracteres aparecem em **0** arquivos e **0** vezes no histórico. O valor de **6** caracteres do `migrate-test` continua nos mesmos 4 testes (`rules.test.ts`, `cart.test.mjs`, `checkout.test.mjs`, `order-review.test.mjs`) e no histórico como dado comum; rotação recomendada antes de uso fora do notebook.
- Nenhuma chave privada, token nem senha de 8 dígitos nos 61 arquivos. A única linha com formato `postgresql://usuário:senha@…` é um valor fictício já presente no HEAD (`inspect-reconciliation.test.ts`, linha 41), que não coincide com nenhuma senha real.
- Plano **sem**: planilha real, `backend/data`, segredos, `.env`, dumps, backups, cópias do OneDrive, relatórios, refs do Cline/Codex (varredura do plano: 0 ocorrências).
- Git: HEAD `a39247b`, 3 commits, **0 tags**, **0 remotos**, **0 em stage**, **nenhuma** configuração de push/remote/branch (`push.followTags` etc. inexistente). As 81 refs `refs/cline/*` e `refs/codex/*` (82 refs no total, com `main`) seguem só locais.

## 7. Manifesto final (61 arquivos)

**61 planejados, 61 reais, 0 esquecidos, 0 inexistentes, 0 duplicados, 0 ignorados.** Acréscimo desta etapa: `backend/tests/scripts/executor-columns.test.ts` (N, Commit 1). Alterados dentro do manifesto: `executor-seed-real.ts`, `private-catalog.test.ts`, `ci-config.test.ts` e `github-actions-e2e.md`. Os 60 anteriores mantêm motivo, risco e dependências dos relatórios 3D.3.25-C (seção 2) e 3D.3.25-D (seção 9).

Fora do manifesto: `README.md`, `backend/src/middleware/errorHandler.ts`, `frontend/src/App.tsx` (só final de linha); relatórios `RELATORIO-ENTREGA-*.md` e `3.15`/`3.16`; arquivos ignorados; cópias `*-Calil-Notebook.*`.

## 8. Plano dos três commits (NÃO EXECUTADOS)

Sempre caminhos explícitos, nunca `git add .`. Commits intermediários não são validados individualmente (não há gatilho em `push`).

**Commit 1 — Segurança e saneamento** (27 arquivos):

```bash
git add .gitignore backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json
git add backend/src/config/env.ts backend/tests/config/env.test.ts backend/tests/audit-secrets.test.ts backend/scripts/audit-secrets.ts backend/docs/secrets-rotation.md
git add backend/scripts/analyze-excel.ts backend/scripts/analyze-excel2.ts backend/scripts/executor-seed-real.ts backend/scripts/inspect-reconciliation.ts backend/scripts/seed-real.ts
git add backend/tests/fixtures/catalog/synthetic-catalog.ts backend/tests/fixtures/catalog/synthetic-catalog.csv backend/tests/fixtures/catalog/synthetic-catalog-invalid-prices.csv backend/tests/helpers/catalog-sources.ts
git add backend/tests/scripts/synthetic-catalog.test.ts backend/tests/scripts/private-catalog.test.ts backend/tests/scripts/executor-columns.test.ts
git add backend/tests/scripts/seed-real.test.ts backend/tests/scripts/seed-real-corrected.test.ts backend/tests/scripts/executor-seed-real.test.ts backend/tests/scripts/seed-dev.test.ts backend/tests/scripts/inspect-reconciliation.test.ts
git diff --cached --stat
git commit -m "chore(seguranca): gitignore, fixture sintetica do catalogo e correcao dos cabecalhos do executor"
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

Antes de cada `git commit`, conferir `git diff --cached --name-only` com as listas acima. Ao final, `git status --short` deve mostrar só `README.md`, `errorHandler.ts`, `App.tsx`, os relatórios e `3.15`/`3.16`.

## 9. Comandos exatos de publicação (NÃO EXECUTADOS)

Somente após a autorização final do usuário e com repositório **privado e vazio**.

```bash
gh repo create <dono>/<nome> --private
gh repo view <dono>/<nome> --json visibility,isPrivate,defaultBranchRef
```

(`visibility` deve ser `PRIVATE` e `defaultBranchRef` nulo. Pela interface web: New repository → Private → sem README/.gitignore/licença.)

```bash
git remote add origin https://github.com/<dono>/<nome>.git
git remote -v
git config --get-regexp "^(push|remote)\."
```

Executar os três commits da seção 8. Depois:

```bash
git push --no-tags -u origin main:main
git ls-remote --heads --tags origin
git ls-tree -r --name-only origin/main | grep -E "(^|/)\.env($|\.)|\.dump$|\.pem$|secrets/|backend/data/"
```

Esperado: `ls-remote` lista **só** `refs/heads/main` (o SHA do HEAD local após os 3 commits); o `grep` devolve apenas `backend/.env.example` e `frontend/.env.example`. Nunca `--all`, `--mirror`, `--tags` ou `refs/*`; as refs `refs/cline/*` e `refs/codex/*` não sobem porque `main:main` envia só `main`. Se houver qualquer dúvida sobre refs, publicar de um clone limpo: `git clone --single-branch --branch main <repo-local> <pasta-fora-do-OneDrive>` (não criado).

No GitHub: Settings → Actions → General (ações do próprio GitHub, permissões de workflow somente leitura, aprovação para PRs de forks). Primeiro run: Actions → CI → *Run workflow* com `run_backend` e `run_frontend` marcados e `run_e2e` **desmarcado** (esperado: backend 746 passam + 7 skipped; frontend 99). O E2E com PostgreSQL efêmero só com autorização específica nova.

## 10. Pendências reais que dependem do GitHub

1. Primeira execução real do CI (backend/frontend): confirmar `npm ci` do `xlsx` na CDN no runner, Node 22 e Ubuntu 24.04 (só validei npm 10.9.10 sobre Node 24 no Windows).
2. Disponibilidade de `cdn.sheetjs.com` no runner (risco de rede).
3. Primeiro E2E com PostgreSQL efêmero (bootstrap, `pg_hba`, Prisma × PostgreSQL 18, Playwright, `localhost` IPv4/IPv6): **nunca executado**.
4. Configurações do repositório (permissões do Actions, aprovação para forks) só existem após criá-lo.
5. Consumo de minutos do Actions não medido.

Pendências locais, fora do GitHub: rotação da senha curta do `migrate-test` (e das senhas fracas, risco aceito); arquivo legado que quebra o `tsc` local; mensagem de console com U+FFFD (cosmética); `path` importado e agora sem uso em `executor-seed-real.ts` (inofensivo); 231 commits com credenciais reais em refs locais do Cline/Codex (nunca publicar).

## 11. Parecer final

**PRONTO** para os três commits locais e **PRONTO COM RESSALVAS** para o push restrito de `main:main` em repositório privado e vazio. O bug dos cabeçalhos foi corrigido com testes de regressão e sem alterar regras de negócio (plano real 144/24/6/30/204 inalterado, verificado em leitura). A dependência `xlsx` tem origem oficial, versão e hash fixos, hash conferido contra a CDN e instalação reproduzível com npm 10 em clone limpo (746 testes passam, 7 skipped, 0 falhas; frontend 99/99; typecheck e builds ok). **Não afirmo que o CI nem o E2E funcionam**: dependem da primeira execução real. Nada foi publicado, e a autorização final é do usuário.
