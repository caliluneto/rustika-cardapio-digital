# RELATÓRIO DE ENTREGA — 3D.3.25-D

Eliminação da dependência da planilha privada e fechamento da preparação para o GitHub. A planilha real `backend/data/Exportacao-produtos.xlsx` **não foi modificada, movida nem lida para gerar a fixture**; permanece fora do Git. Não fiz commit, push, remoto, repositório, workflow, Playwright, PostgreSQL local, migration ou seed, não alterei senhas, bancos, histórico, refs do Cline/Codex nem outros projetos, e **não apaguei nenhum arquivo** (a `vitest.unit.config.mts` foi reescrita, não removida).

Legenda: **APROVADA** · **FALHOU** · **BLOQUEADA** · **PREPARADA, MAS NÃO EXECUTADA**.

## 1. Arquivos modificados nesta etapa

| Arquivo | Estado | O que mudou |
|---|---|---|
| `backend/scripts/seed-real.ts` | M | exporta `defaultCatalogPath` (planilha real); `generateClassificationReport(filePath = defaultCatalogPath)` e `validateAllPrices(filePath = defaultCatalogPath)` |
| `backend/scripts/executor-seed-real.ts` | M | opção `catalogPath?` (padrão: planilha real); repassa o caminho à validação e à leitura |
| `backend/scripts/inspect-reconciliation.ts` | M | `readExcelExpectations(filePath = defaultCatalogPath)` |
| `backend/tests/scripts/seed-real.test.ts` | M | lê a fixture sintética; nomes esperados vêm de `SYNTHETIC_EXPECTED` |
| `backend/tests/scripts/seed-real-corrected.test.ts` | M | idem (mesmos quantitativos 174/144/24/6) |
| `backend/tests/scripts/executor-seed-real.test.ts` | M | `catalogPath` sintético em todas as chamadas |
| `backend/tests/scripts/seed-dev.test.ts` | M | idem |
| `backend/tests/scripts/inspect-reconciliation.test.ts` | M | `readCatalog` e as asserções de totais/código alfanumérico usam a fixture |
| `backend/tests/ci-config.test.ts` | M (novo desde a etapa anterior) | trecho de "checkout limpo" reescrito para a nova abordagem (36 testes) |
| `backend/vitest.unit.config.mts` | N (reescrita) | deixa de excluir arquivos; só define `RUSTIKA_IGNORE_PRIVATE_CATALOG=1` |
| `backend/docs/github-actions-e2e.md` | N | parágrafo da planilha privada substituído |
| `backend/tests/fixtures/catalog/synthetic-catalog.ts` | N | gerador determinístico e constantes esperadas |
| `backend/tests/fixtures/catalog/synthetic-catalog.csv` | N | fixture sintética (204 linhas) |
| `backend/tests/fixtures/catalog/synthetic-catalog-invalid-prices.csv` | N | fixture de preços inválidos |
| `backend/tests/helpers/catalog-sources.ts` | N | caminhos e a chave `hasRealCatalog` |
| `backend/tests/scripts/synthetic-catalog.test.ts` | N | 10 testes da fixture e dos caminhos de falha |
| `backend/tests/scripts/private-catalog.test.ts` | N | 6 testes que só rodam com a planilha real |

O `ci.yml` não mudou nesta etapa (continua em `npm run test:ci`).

## 2. Fixture sintética criada

`backend/tests/fixtures/catalog/synthetic-catalog.csv`, gerada por `synthetic-catalog.ts` (determinística: a mesma saída em toda execução, conferida byte a byte por teste).

- **Formato:** CSV UTF-8 **com BOM** (sem o BOM o `xlsx` lê "Código" como mojibake). Escolhi CSV em vez de `.xlsx` porque é texto, revisável em diff e sem carimbo de data (um `.xlsx` gerado muda a cada geração). O leitor é o mesmo (`xlsx.read` em buffer).
- **Estrutura:** mesmas colunas da planilha real (`Imagem, Código, Nome curto, Estado, Grupo, Preço venda, Preço custo, Estoque`). 204 linhas: **174 ativos = 144 comercializados + 24 insumos + 6 incertos; 30 inativos; 168 candidatos**, ou seja, os mesmos quantitativos da planilha real, para que as **mesmas asserções numéricas** valham para os dois (nenhuma foi removida ou afrouxada).
- **Totalmente fictícia:** todos os nomes começam com `SINT `; preços saem de uma fórmula (`150 + (i*7919 mod 9000)` centavos); códigos sequenciais a partir de 1001; grupos `SINT GRUPO 01..10`. Nenhum produto, preço, código interno ou dado operacional real, nenhuma credencial (teste confere ausência de `postgres`, `password`, `secret`, e-mails e URLs).
- **Casos cobertos:** três preços `0.01` (→ INSUMO); exceções do grupo INSUMO (`SINT BALY 2L`, `SINT PANCETA SUINA` → COMERCIALIZADO); os seis tokens de incerto (CDB, CHICLETE, HALLS, GUARDA VOLUME, PALHEIRO, ISQUEIRO); um grupo com **espaço no fim** (`DIVERSOS `) para provar o aparo; um código alfanumérico (`SX000001`) para a incompatibilidade do inspetor; códigos `44` e `47` (números baixos que já estão nos testes) para "preserva IDs ERP"; códigos únicos.
- **Observação:** os tokens "BALY 2L", "PANCETA", "CDB" etc. aparecem nos nomes sintéticos porque `classifyProduct` decide por esses trechos de nome (são palavras-chave do código, já no repositório), não dados do catálogo.
- **Fixture de falha:** `synthetic-catalog-invalid-prices.csv` com quatro preços ativos inválidos (texto, negativo, múltiplos separadores, vazio), um inativo inválido (ignorado) e um válido.

## 3. Testes recuperados no CI

Medido em clone limpo (seção 5):

| Modo | Antes (3D.3.25-C) | Agora |
|---|---:|---:|
| `npm run test:ci` / `npm test` em clone limpo, sem planilha | 547 passaram, **5 arquivos excluídos** | **733 passaram, 6 skipped, 0 falhas** |

- **176 testes** dos cinco arquivos que eram excluídos voltaram a rodar, mais **10 testes novos** (`synthetic-catalog.test.ts`).
- Cenários recuperados no CI: `parsePrice` e `classifyProduct` (que nem precisavam da planilha e estavam excluídos à toa), relatório de classificação, `validateAllPrices`, plano do executor (dry-run, role, banco, confirmação), seed de Dev, inspetor de reconciliação (destino, identidade, leitura, SSL, totais, 23 testes), e novos caminhos de falha (preços inválidos, aborto antes de qualquer escrita).
- Nenhuma asserção foi removida. Os nomes `BALY 2L`/`PANCETA` viraram constantes sintéticas (`SYNTHETIC_EXPECTED`); o código real `PA062240` e os nomes reais foram para o teste privado (seção 4).

## 4. Testes ainda excluídos (skipped) e justificativas

`backend/tests/scripts/private-catalog.test.ts`: **6 testes**, `describe.skipIf(!hasRealCatalog)`. Rodam **apenas** quando `backend/data/Exportacao-produtos.xlsx` existe e `RUSTIKA_IGNORE_PRIVATE_CATALOG` não é `1`. No CI aparecem como *skipped*. Verificam o conteúdo **real**:

1. 174 ativos = 144 + 24 + 6.
2. `BALY 2L` e `PANCETA` reais comercializados, IDs `44` e `47`, grupos `INSUMO`/`DIVERSOS`, sem espaço no fim, `0.01 → INSUMO`.
3. Todos os preços ativos reais são válidos.
4. Plano do executor: 144/24/6/30/204.
5. Totais do inspetor e o código alfanumérico real `PA062240` (AUSENTE = 168).
6. Nenhum nome da fixture sintética coincide com um nome real.

Esses cenários **não podem ser reproduzidos com dados sintéticos**: dependem do conteúdo real (quais códigos existem, quais nomes, o código com letras). Local, com a planilha: **6/6 passam**. **A fixture sintética passar não prova que o conteúdo real esteja coberto**; essa prova só existe na máquina que tem a planilha, ou por `npm test` local antes de qualquer importação real.

## 5. Resultado do clone limpo

Cópia nova (`clean2`) com os 224 arquivos que o Git veria (rastreados + novos não ignorados, sem relatórios), **sem** `backend/data`, **sem** `.env`, **sem** cópias do OneDrive, **sem** arquivos ignorados, **sem** `node_modules` e com `CARDAPIO_SECRETS_DIR` apontando para uma pasta vazia.

| Passo | Resultado |
|---|---|
| `npm ci` backend | **APROVADA** (206 pacotes) com `--allow-remote=root` — ver achado A abaixo; **FALHOU** sem essa opção neste npm 12 |
| `prisma generate` | **APROVADA** |
| `tsc --noEmit` backend | **APROVADA** (0 erros; sem o arquivo legado) |
| `tsc -p tsconfig.build.json` | **APROVADA** |
| Vitest `npm test` e `npm run test:ci` | **APROVADA**: 35 arquivos, **733 passaram, 6 skipped, 0 falhas** |
| `npm ci` frontend | **APROVADA** |
| `tsc --noEmit` frontend | **APROVADA** |
| `npm test` frontend | **APROVADA**: **99/99** |
| `vite build` frontend | **APROVADA** (3,5 s) |
| Testes dos gatilhos do CI | **APROVADA** (os 36 de `ci-config.test.ts` estão dentro do Vitest acima) |

Achados do clone limpo:

- **A. `xlsx` vem de uma URL.** A dependência é `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (origem oficial da SheetJS; a versão do registro npm é antiga e tem vulnerabilidades conhecidas), com `integrity` no lockfile. O npm 12.2.0 desta máquina (Node 24.20) tem `allow-remote=none` por padrão e **recusa** instalá-la (`EALLOWREMOTE`); `--allow-remote=root` (só para dependências declaradas no projeto) resolve. O workflow usa `node-version: '22'` (npm 10, sem essa restrição), então **deve** funcionar, mas **não foi comprovado**. Não alterei a configuração global do npm. Se o runner um dia usar npm 12+, o `npm ci` falhará com esse erro.
- **B. O `package.json` do HEAD não declarava `xlsx` nem `pg`**, embora os scripts os importem: o HEAD sozinho não instala nem compila. As declarações estão no Commit 1.
- **C. Descoberta no `executor-seed-real.ts` (existente no HEAD, não alterada):** as chaves de coluna `"Código"` e `"Preço venda"` contêm o caractere de substituição U+FFFD (texto corrompido). O executor lê `codigo` vazio e preço `0`. Por isso, no executor, a regra `0.01 → INSUMO` nunca dispara e a contagem só bate porque, na planilha real, os itens de `0.01` já estão no grupo INSUMO. Não corrigi (mudaria a funcionalidade, fora do escopo); registrado como pendência para uma etapa própria. A fixture respeita isso (itens `0.01` só no grupo INSUMO), de modo que relatório e executor dão os mesmos quantitativos.

## 6. Resultado de backend e frontend (máquina local, planilha presente)

| Verificação | Resultado |
|---|---|
| Backend `npm test` | **APROVADA**: 35 arquivos, **739/739** |
| Backend `npm run test:ci` (simula o CI) | **APROVADA**: 733 passaram, 6 skipped |
| Backend `tsc --noEmit` | **APROVADA** exceto o arquivo legado (abaixo) |
| Frontend (testes, `tsc`, build) | **APROVADA** (reexecutados no clone limpo; arquivos do frontend não mudaram) |

### Arquivo legado `verify-fixtures-rotation.ts` (registrado separadamente)

Mantém os **2 erros** do `tsc` completo apenas nesta máquina (`TS7016` módulo `pg` sem tipos; `TS2307` módulo `./src/config/secrets` ausente). Está ignorado e não rastreado; **não foi alterado nem movido**. No clone limpo o arquivo não existe e o `tsc` passa com 0 erros.

## 7. Segurança dos dados

- **Fixture:** nenhum dado real, verificado por teste (nomes `SINT`, sem padrões de credencial) e, onde a planilha existe, pelo teste privado (nenhum nome sintético coincide com um real).
- **Rotinas reais não são substituídas silenciosamente:** o caminho padrão de todas as funções continua `backend/data/Exportacao-produtos.xlsx`; a fixture só entra por parâmetro passado pelos testes; a linha de comando do executor **não** repassa `catalogPath` (testado); nenhum script lê variável de ambiente para trocar a planilha nem cita a fixture em código (testado).
- **Planilha real:** `backend/data/` segue ignorado; a fixture **não** é ignorada (`git check-ignore` e teste).
- **Segredos:** comparação em memória das 3 senhas reais distintas contra a `main` e contra todos os arquivos rastreados e candidatos, imprimindo só contagens: as duas senhas fortes (8 e 26 caracteres) aparecem em **0** arquivos e **0** vezes no histórico. O valor de **6 caracteres** (`migrate-test`) continua aparecendo nos 4 testes já conhecidos e no histórico como dado comum (risco registrado desde a 3D.3.25-C; rotação recomendada). Nenhum token, chave privada ou URL com senha literal nos candidatos.
- **Segredos locais:** nenhum arquivo de segredo foi lido além da comparação em memória; nada foi impresso; nenhuma senha alterada.

## 8. Validação YAML e shell

| Verificação | Resultado |
|---|---|
| `ci.yml` (parser `yaml`, 3 jobs) | **APROVADA** |
| `bash -n` nos 23 blocos `run` | **APROVADA** |
| `ci.yml` do clone limpo idêntico ao do repositório | **APROVADA** (`cmp`) |
| SHAs das Actions | **APROVADA** (reconferidos na 3D.3.25-C; o workflow não mudou desde então) |
| Workflows remotos / PostgreSQL efêmero / Playwright | **PREPARADA, MAS NÃO EXECUTADA** |

## 9. Manifesto atualizado de arquivos (60)

**60 arquivos planejados, 60 reais, 0 esquecidos, 0 inexistentes, 0 duplicados, 0 ignorados, 0 em stage.** Os 49 da seção 2 do relatório 3D.3.25-C mantêm motivo, risco e dependências inalterados; os 11 a seguir são os novos ou alterados nesta etapa:

| Caminho | Git | Motivo | Risco | Dependências | Commit | Revisão |
|---|---|---|---|---|---|---|
| `backend/tests/fixtures/catalog/synthetic-catalog.ts` | N | gerador e constantes da fixture | nenhum (dados fictícios) | — | 1 | aprovado |
| `backend/tests/fixtures/catalog/synthetic-catalog.csv` | N | fixture sintética | nenhum | gerador | 1 | aprovado |
| `backend/tests/fixtures/catalog/synthetic-catalog-invalid-prices.csv` | N | falhas de preço | nenhum | gerador | 1 | aprovado |
| `backend/tests/helpers/catalog-sources.ts` | N | caminhos e `hasRealCatalog` | nenhum | fixture | 1 | aprovado |
| `backend/tests/scripts/synthetic-catalog.test.ts` | N | contrato e falhas da fixture | nenhum | scripts, fixture | 1 | aprovado |
| `backend/tests/scripts/private-catalog.test.ts` | N | verificações do conteúdo real (autoignora) | cita o código `PA062240` e o nome `BALY 2L`/`PANCETA` (já presentes no HEAD) | planilha real (local) | 1 | aprovado |
| `backend/tests/scripts/seed-real.test.ts` | M | usa a fixture | nenhum | helpers, fixture | 1 | aprovado |
| `backend/tests/scripts/seed-real-corrected.test.ts` | M | idem | nenhum | idem | 1 | aprovado |
| `backend/tests/scripts/executor-seed-real.test.ts` | M | idem | nenhum | idem | 1 | aprovado |
| `backend/tests/scripts/seed-dev.test.ts` | M | idem | nenhum | idem | 1 | aprovado |
| `backend/tests/scripts/inspect-reconciliation.test.ts` | M | idem | nenhum | idem | 1 | aprovado |

Alterados mas já no manifesto: `seed-real.ts`, `executor-seed-real.ts`, `inspect-reconciliation.ts` (Commit 1), `vitest.unit.config.mts`, `ci-config.test.ts`, `github-actions-e2e.md` (Commit 2).

Fora do manifesto (decididos): `README.md`, `backend/src/middleware/errorHandler.ts`, `frontend/src/App.tsx` (só final de linha); os relatórios `RELATORIO-ENTREGA-*.md` (66 não rastreados e `3.15`/`3.16`); arquivos ignorados e cópias `*-Calil-Notebook.*`; `refs/cline/*` e `refs/codex/*` (nunca publicadas).

## 10. Plano final dos três commits

Você executa; eu não executei nada. Sempre caminhos explícitos, nunca `git add .`. Os commits intermediários não são validados individualmente (não há gatilho em `push`); o estado final é o verificado.

**Commit 1 — Segurança e saneamento** (26 arquivos: `.gitignore`, dependências, dados sintéticos, ajustes seguros):

```bash
git add .gitignore backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json
git add backend/src/config/env.ts backend/tests/config/env.test.ts backend/tests/audit-secrets.test.ts backend/scripts/audit-secrets.ts backend/docs/secrets-rotation.md
git add backend/scripts/analyze-excel.ts backend/scripts/analyze-excel2.ts backend/scripts/executor-seed-real.ts backend/scripts/inspect-reconciliation.ts backend/scripts/seed-real.ts
git add backend/tests/fixtures/catalog/synthetic-catalog.ts backend/tests/fixtures/catalog/synthetic-catalog.csv backend/tests/fixtures/catalog/synthetic-catalog-invalid-prices.csv backend/tests/helpers/catalog-sources.ts
git add backend/tests/scripts/synthetic-catalog.test.ts backend/tests/scripts/private-catalog.test.ts backend/tests/scripts/seed-real.test.ts backend/tests/scripts/seed-real-corrected.test.ts backend/tests/scripts/executor-seed-real.test.ts backend/tests/scripts/seed-dev.test.ts backend/tests/scripts/inspect-reconciliation.test.ts
git diff --cached --stat
git commit -m "chore(seguranca): gitignore, auditoria de segredos, fixture sintetica do catalogo e ajustes seguros"
```

**Commit 2 — CI e infraestrutura** (6 arquivos):

```bash
git add .github/workflows/ci.yml .github/ci/bootstrap.sql .github/ci/pg_hba.ci.conf
git add backend/vitest.unit.config.mts backend/tests/ci-config.test.ts backend/docs/github-actions-e2e.md
git diff --cached --stat
git commit -m "ci: workflow do GitHub Actions com PostgreSQL efemero e testes estaticos do workflow"
```

**Commit 3 — Testes e E2E** (28 arquivos; lista inalterada):

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

Antes de cada commit, conferir `git diff --cached --name-only` com as listas acima; ao final, `git status --short` deve mostrar só `README.md`, `errorHandler.ts`, `App.tsx`, os relatórios e `3.15`/`3.16`.

Publicação (NÃO EXECUTADA; só após sua autorização): criar repositório **privado e vazio** → `gh repo view <dono>/<nome> --json visibility,isPrivate` → `git remote add origin <URL>` → commits acima → `git push --no-tags -u origin main:main` → `git ls-remote --heads --tags origin` (só `refs/heads/main`) → `git ls-tree -r --name-only origin/main | grep -E "(^|/)\.env($|\.)|\.dump$|\.pem$|secrets/|data/"` (só os dois `.env.example`) → configurar Actions (somente leitura; aprovação para forks) → rodar só backend/frontend (`run_e2e` desmarcado; esperado: 733 passam, 6 skipped no backend; 99 no frontend) → autorização específica para o primeiro E2E. Nunca `--all`, `--mirror`, `--tags`, nem refs `cline`/`codex`. Alternativa: clone `--single-branch` limpo a partir de `main`, fora do OneDrive (não criado).

## 11. Bloqueios restantes para a publicação

Nenhum bloqueio técnico local. Pendentes de decisão/execução:

1. **Sua autorização** para commits, remoto e push (nada disso foi feito).
2. **Primeira execução real do CI** (jobs `backend` e `frontend`) para confirmar, entre outros, que o `npm ci` do `xlsx` por URL funciona no runner (Node 22/npm 10) — achado A. Se falhar, a opção é fixar a versão do npm no workflow ou tratar a dependência.
3. O E2E com PostgreSQL efêmero segue **sem execução real** (bootstrap, `pg_hba`, Prisma × PostgreSQL 18 e Playwright no runner não validados).
4. Senha curta (6 caracteres) do `migrate-test`: rotação recomendada antes de uso fora do notebook.
5. Pendências técnicas fora de escopo: chaves corrompidas no `executor-seed-real.ts` (achado C); arquivo legado que quebra o `tsc` local; `path` importado e agora sem uso em `executor-seed-real.ts` (inofensivo).

## 12. Parecer final

**PRONTO para o primeiro conjunto de commits** (três commits locais, 60 arquivos, seção 10) **e PRONTO COM RESSALVAS para o push restrito de `main:main`** em repositório privado e vazio. A dependência da planilha privada foi eliminada do CI: em clone limpo, com `npm ci` real, **733 testes passam, 6 ficam *skipped* (somente os que exigem o conteúdo real), 0 falham**; o frontend passa 99/99; typecheck e builds passam. A cobertura real continua verificada apenas na máquina que tem a planilha. **Não afirmo que o CI funciona** antes de sua primeira execução real. Nada foi publicado.
