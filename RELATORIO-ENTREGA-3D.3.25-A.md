# RELATÓRIO DE ENTREGA — 3D.3.25-A

Integração com GitHub e preparação do GitHub Actions. **Nada foi publicado nem executado**: sem commit, push, reset, clean; nenhum repositório remoto criado ou alterado; nenhum workflow disparado; nenhum Playwright, seed ou migration local; nenhum banco local tocado; senhas e secrets intactos; nenhuma cópia de conflito apagada.

## 1. Estado atual do Git

- Branch `main`; **nenhum remote configurado**; 0 itens em stage.
- `main` tem 3 commits (`1e80bdb` baseline, `05344fd` checkpoint 3D.3.15, `a39247b` relatório 3D.3.16); 197 arquivos rastreados (pack de 849 KiB; nenhum arquivo rastreado > 1 MB).
- 21 arquivos rastreados modificados; 91 não rastreados e não ignorados (antes desta etapa); 104 entradas em `git status` agora (inclui os 4 novos arquivos de CI e a alteração do `.gitignore`).
- **Refs locais extras:** 234 commits ao todo, dos quais 231 vêm de `refs/cline/checkpoints/*` e `refs/codex/turn-diffs/*` (checkpoints de ferramentas). Eles não são enviados por `git push origin main`, mas **seriam enviados por `git push --all`, `--mirror` ou `--tags`-equivalentes**; ver riscos.
- Regressões pós-3D.3.23-D: hashes dos módulos de segurança e dos arquivos do E2E idênticos aos da 3D.3.24-A; 32 cópias de conflito, nenhuma nova.

## 2. Auditoria de sensíveis e do histórico

Método: extraí as senhas reais da pasta de segredos local (em memória, sem imprimir) e procurei cada uma, literalmente, em (a) árvore de trabalho incluindo não rastreados, (b) os 3 commits de `main` e (c) os 234 commits de todas as refs. Também varri URLs `postgresql://usuario:senha@` e nomes de arquivos sensíveis em todo o histórico.

| Local | Resultado |
| --- | --- |
| Histórico de `main` (3 commits) | **Nenhuma senha real do projeto** (as duas senhas de URL reais e a de fixtures não aparecem). URLs com senha em `main` são de `database.env.example` e testes com valores fictícios/placeholder |
| Refs `cline/` e `codex/` (231 commits) | **Contêm as senhas reais** em scripts avulsos (`db-dumper.js`, `db-check.js`, `check_*.js`, `seed_pg.js`, `seed_raw.js`, `seed_e2e.js`…) e em `tests/scripts/seed-dev.test.ts` |
| Árvore de trabalho | Senhas reais em 9 scripts avulsos **não rastreados** (agora ignorados, ver seção 4) e em `backend/tests/audit-secrets.test.ts` (**não rastreado, NÃO ignorado**: contém o valor real de 8 dígitos usado como senha, em dados de teste) |
| Valor numérico de 6 dígitos de `migrate-test` | Coincide com trechos de dado de exemplo (ex.: código de produto `…062240`) em 4 testes rastreados de `main`; tratado como coincidência/falso positivo, mas indica segredo fraco e previsível |
| Nomes sensíveis no histórico | `backend/data/Exportacao-produtos.xlsx` (dados reais do catálogo) só aparece nas refs de checkpoint, **não em `main`**; hoje não rastreado e agora ignorado |
| `.env`, `.env.e2e`, `frontend/.env.e2e`, `recovery-run.log` | Ignorados e não rastreados |

**Conclusão:** a história de `main` está limpa de credenciais reais, mas o repositório local **não é publicável como está** (ver seção 12). Nenhuma credencial foi alterada, rotacionada ou removida do histórico; a solução segura proposta evita reescrever histórico (publicar só `main`).

## 3. Arquivos que podem ser publicados

Código-fonte, testes, migrations, documentação e relatórios já rastreados em `main`; os arquivos novos de CI (`.github/**`, `backend/docs/github-actions-e2e.md`); e, **depois de revisão**, os fontes hoje não rastreados e necessários ao CI: `backend/tests/integration-db/e2e/*`, `backend/scripts/inspect-e2e-state.ts`, `backend/scripts/audit-secrets.ts`, `backend/tests/e2e-*.test.ts`, `backend/tests/helpers/launch-probe.ts`, `frontend/playwright.config.ts`, `frontend/tests/{globalSetup,globalTeardown,e2e.spec}.ts`, `frontend/tests/{e2e-guard,vite-env-injection}.test.mjs`, docs novas. Os lockfiles `backend/package-lock.json` e `frontend/package-lock.json` ficam (e passam em `npm ci --dry-run`).

## 4. Arquivos que devem permanecer locais

Regras adicionadas ao `.gitignore` (**apenas acréscimos**; backup do original no scratchpad; as 40+ regras anteriores foram preservadas):
`test-results/`, `playwright-report/`, `blob-report/`, `playwright/.cache/`; `*-Calil-Notebook*`; `*.dump.sha256`, `*.sql.gz`, `*.tmp`, `*.tmp_restore`, `RustikaBackups/`, `RustikaQuarantine/`, `CardapioDigital/`; `backend/data/`; e 20 scripts/anotações avulsos com credenciais embutidas (`backend/seed_raw.js`, `db-dumper.js`, `check_*.js` etc.) mais o legado `backend/tests/scripts/verify-fixtures-rotation.ts`. Ignorar não apaga nada; verificado com `git check-ignore`. Já cobertos antes: `node_modules/`, `dist/`, `build/`, `.env*`, `*.dump`, `*.log`, `.npmrc`, `secrets/`. **Nenhum arquivo já rastreado precisa sair do índice.**

## 5. Workflow proposto

`.github/workflows/ci.yml` (YAML validado com o parser `yaml`; `bash -n` ok nos 21 scripts embutidos):

- Gatilhos: `pull_request` e `workflow_dispatch` (com `run_backend`, `run_frontend`, `run_e2e`, `upload_diagnostics`). **Sem `push`.** O job `e2e` só roda com `workflow_dispatch` e `run_e2e=true`.
- `permissions: contents: read`; `persist-credentials: false`; `concurrency` por ref; sem `secrets.*`.
- Runner `ubuntu-24.04`, Node 22 (projeto exige ≥ 20.19), `npm ci` com cache, `timeout-minutes` 15/15/30.
- Job `backend`: `prisma generate`, typecheck, build, Vitest. Job `frontend`: typecheck, build, testes. Job `e2e`: ver seção 6.
- Actions usadas (oficiais): `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`.

## 6. PostgreSQL efêmero

`postgres:18` com `docker run --network host` (não service container, pois as rotinas SQL de provisão do projeto recusam `inet_server_addr()` fora de loopback), `listen_addresses=127.0.0.1`, `hba_file` próprio (`.github/ci/pg_hba.ci.conf`, baseado em `docs/sql/pg_hba-test-fixtures.conf.example`). `.github/ci/bootstrap.sql` cria `cardapio_migrator`, `cardapio_test_app`, `cardapio_dev_app` (NOLOGIN, exigida pela migration `20261104000000`) e os bancos `cardapio_digital_test` (dono migrator) e `cardapio_digital_shadow` (exigido pelo perfil `migrate-test`). Em seguida: `npm run db:migrate:deploy:test` (script oficial), `provision-test-fixtures.sql`, `ALTER ROLE … PASSWORD`, `enable-test-fixtures-login.sql` e `verify-test-fixtures.sql`, **todos inalterados**. Senhas: 4 valores `openssl rand -hex 24`, mascarados; arquivos de segredo em `${{ runner.temp }}/cardapio-secrets` (fora do workspace, como exige `resolveSecretsDir`), removidos em `always()` junto com o container.

## 7. Adaptações necessárias aos gates

**Nenhuma alteração de código de segurança.** O CI satisfaz os gates (nomes exatos, host 127.0.0.1:5432, PostgreSQL ≥ 17, 5 migrations/checksums, ACL efetiva, `pg_hba` com recusa fora do Test, advisory lock) em vez de contorná-los. Limite honesto: a receita de bootstrap **não foi executada** (nem pode ser localmente dentro das regras desta etapa); a primeira execução manual é a validação. Qualquer divergência faz o preflight/setup abortar antes de escrever.

## 8. Compatibilidade Playwright

Playwright 1.64.1 (lockfile), Chromium headless, `workers: 1`, `retries: 0`, portas 4100/5174, `reuseExistingServer: false`, timeout do teste 60 s: tudo da configuração existente, sem mudança. `npx playwright install --with-deps chromium` no runner. O `webServer` herda o ambiente do job (inclui `CARDAPIO_SECRETS_DIR` e os gates). O teste existente cobre login, convite, resgate, carrinho, checkout, persistência, idempotência e limpeza (verificação de resíduo zero reforçada por passo próprio do CI). Sem funcionalidades novas. Diagnósticos (trace/screenshot) não são produzidos pela configuração atual; o upload de `test-results/` é opt-in.

## 9. Arquivos criados/modificados nesta etapa

Criados: `.github/workflows/ci.yml`, `.github/ci/bootstrap.sql`, `.github/ci/pg_hba.ci.conf`, `backend/docs/github-actions-e2e.md`, este relatório.
Modificados: `.gitignore` (acréscimos), `backend/docs/e2e-real.md` (nota de 2 linhas sobre a limpeza concluída e o CI).
Nenhum arquivo de `src/`, gate, teste ou configuração do Playwright foi alterado.

## 10. Verificações estáticas

- YAML do workflow: válido; 3 jobs; permissões `contents: read`; gatilho do `e2e` restrito a `workflow_dispatch`.
- `bash -n` em todos os blocos `run`: sem erros. Nenhuma senha literal no workflow e nenhuma `DATABASE_URL`/`SHADOW_DATABASE_URL` definida no ambiente do job (só nos arquivos de segredo sintéticos).
- `npm ci --dry-run`: lockfiles sincronizados no backend e no frontend.
- Varredura de senhas reais em `git ls-files -co --exclude-standard` (o que entraria num `git add .`): só `backend/tests/audit-secrets.test.ts` (8 dígitos) e os 4 testes do valor numérico fraco.
- Testes locais desta sessão (inalterados por esta etapa): backend 687/687, frontend 99/99.

## 11. Riscos encontrados

1. **Alto:** `git push --all`/`--mirror` publicaria as refs `cline/` e `codex/` com senhas reais e a planilha do catálogo.
2. **Alto:** `backend/tests/audit-secrets.test.ts` contém um valor real de senha e não está ignorado.
3. **Médio:** a receita do PostgreSQL efêmero é inédita (primeira execução pode falhar no bootstrap, de forma segura).
4. **Médio:** `npm test` no CI roda sem a pasta de segredos local; algum teste pode depender dela (conferir na primeira execução do job `backend`).
5. **Médio:** o CI só funciona depois de versionar os fontes do E2E, hoje não rastreados (seção 3), e de resolver as 21 modificações rastreadas.
6. **Baixo:** Actions fixadas por tag (`@v4`), não por SHA; confirmar versões atuais e fixar por SHA antes do primeiro push (não consegui consultar o GitHub offline).
7. Senhas atuais fracas e compartilhadas: risco aceito pelo usuário; no CI são substituídas por valores aleatórios.

## 12. Pendências para publicar o repositório

1. Sanear `backend/tests/audit-secrets.test.ts`: trocar o valor real por um sintético (`app`-like) **sem alterar a lógica do teste** (proposta; exige sua autorização).
2. Decidir a lista exata de arquivos a versionar (seção 3); nunca usar `git add .` sem conferir `git status`.
3. Confirmar que o valor numérico fraco de `migrate-test` não é segredo reutilizado fora do repositório.
4. Publicar **só `main`** (`git push -u origin main`), nunca `--all`/`--mirror`; considerar `git config push.default simple`. Opcional: clone limpo (`git clone --single-branch`) para criar o repositório remoto sem as refs de checkpoint.
5. Resolver ou descartar as cópias de conflito do OneDrive (já ignoradas) e o `verify-fixtures-rotation.ts` (já ignorado; continua local).
6. Fixar as Actions por SHA e habilitar, no repositório privado, branch protection e Dependabot para Actions.
7. Fazer a primeira execução manual do `e2e` (autorização à parte), com `upload_diagnostics` desmarcado.

## 13. Estimativa de uso do GitHub Actions

Por execução (estimativa, não medida): `backend` 3–5 min, `frontend` 2–4 min, `e2e` 8–15 min. Um PR com os dois jobs unitários consome ~6–9 min; uma execução E2E manual ~10–15 min. Planos gratuitos têm cota mensal limitada para repositórios privados em Linux (conferir a cota atual): algumas dezenas de execuções por mês cabem, desde que o E2E fique manual.

## 14. Como conectar o repositório privado

1. Criar um repositório **privado** vazio no GitHub, sem README/.gitignore.
2. Cumprir as pendências 1 a 4 da seção 12.
3. Localmente: `git remote add origin <URL do repositório privado>` e `git push -u origin main` (só `main`).
4. Em Settings → Actions: permissões padrão do `GITHUB_TOKEN` somente leitura; em Branches, proteger `main`.
5. Actions → CI → Run workflow para a primeira execução manual (E2E com autorização prévia).
Nada disso foi feito.

## 15. Parecer final

**CI: PRONTO PARA REVISÃO. PUBLICAÇÃO: BLOQUEADA.** A proposta de CI preserva o projeto, não depende da RAM do notebook, usa banco efêmero, não expõe secrets, respeita os gates e pode ser disparada manualmente. A publicação está **bloqueada** até sanear `audit-secrets.test.ts` (senha real em arquivo que seria versionado), definir os arquivos a versionar e garantir que só `main` seja enviado (as refs locais de checkpoint contêm credenciais reais). Nenhuma credencial foi tocada.
