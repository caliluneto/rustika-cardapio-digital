# RELATÓRIO DE ENTREGA — 3D.3.25-B

Consolidação de GitHub, CI/CD, segurança e qualidade, com o Playwright E2E preparado para o GitHub Actions. **Nada foi commitado, publicado ou executado remotamente.** Não criei remoto, não rodei workflow, não rodei Playwright, migrations, seeds nem escrita em banco, não troquei senhas e não alterei arquivos de segredos reais.

Legenda: **APROVADA** (executada e passou) · **FALHOU** · **BLOQUEADA** · **PREPARADA, MAS NÃO EXECUTADA**.

## 1. Resumo executivo

- Teste que continha uma senha real (`audit-secrets.test.ts`) foi **sanitizado** (valores sintéticos); nenhum segredo real restou nos arquivos candidatos.
- Workflow `ci.yml` endurecido: Actions fixadas por **SHA de commit verificado** (`git ls-remote`), E2E só manual, só em repositório privado, sem `secrets.*`, resumos de falha, limpeza `always()`.
- `.gitignore` ampliado (artefatos do Playwright, dumps, backups, scripts soltos com credenciais, cópias de conflito do OneDrive).
- Novo teste estático `ci-config.test.ts` (24 testes) protege essas garantias.
- Backend **711/711**, frontend **99/99**; typecheck e build do frontend e typecheck de build do backend passam.
- O E2E no CI está **PREPARADO, MAS NÃO EXECUTADO**: o banco efêmero nunca foi criado de verdade; só a primeira execução manual valida.
- Lista explícita de arquivos do primeiro commit e comandos `git add <caminho>` na seção 21 (não executados).

## 2. Correções realizadas

| Item | Resultado |
|---|---|
| `backend/tests/audit-secrets.test.ts` | 3 literais reais trocados por sintéticos; título ajustado; 8 testes passam |
| `.github/workflows/ci.yml` | SHAs de commit; guarda de repositório privado; `tee` + resumo da falha; `upload_diagnostics` opt-in |
| `.gitignore` | entradas adicionadas (seção 6); original preservado no scratchpad |
| `backend/tests/ci-config.test.ts` | novo, 24 testes |
| `backend/docs/github-actions-e2e.md` | estendido (SHAs, segurança, cobertura, operação, publicação só da `main`, reversão) |
| Código de produção | **nenhuma alteração nesta etapa** |

## 3. Segurança e sanitização

- Varredura nos 51 arquivos candidatos (modificados e não rastreados, exceto relatórios): **0** ocorrências da senha compartilhada de 8 dígitos, **0** URLs de banco com senha literal, **0** chaves privadas/tokens.
- Falso positivo conhecido: um valor curto de 6 caracteres aparece como dado de exemplo em 4 testes rastreados do frontend/backend (`rules.test.ts`, `cart.test.mjs`, `checkout.test.mjs`, `order-review.test.mjs`). Não é segredo.
- Arquivos de segredos reais (`CARDAPIO_SECRETS_DIR`, `backend/.env`) não foram lidos nem alterados nesta etapa. Valores reais não foram impressos.
- 33 arquivos citam o nome de usuário/caminho local (risco baixo, informacional).
- **Senhas reais continuam fracas e compartilhadas** (risco aceito pelo usuário anteriormente); rotação não foi feita (proibida nesta etapa) e é recomendada antes de qualquer uso fora do notebook.

## 4. Auditoria Git

- Branch `main`, HEAD `a39247b`, 3 commits (`1e80bdb`, `05344fd`, `a39247b`), **0 remotos**, 0 stashes.
- Índice: ao final havia 3 arquivos em stage (`backend/docs/e2e-real.md`, `github-actions-e2e.md`, `secrets-rotation.md`, status `A`) que **não identifiquei quem adicionou**. Desfiz apenas o stage (`git restore --staged`, conteúdo intacto). Estado final: **0 em stage**.
- `git status`: 22 modificados + 29 não rastreados (fora dos relatórios) + 60 relatórios `RELATORIO-ENTREGA-*.md` não rastreados.
- Incidente isolado: um comando de shell com crases dentro de aspas duplas executou substituição de comando e gerou apenas um erro de uso do `git push` (sem remoto, nada publicado). Verifiquei depois: sem remoto, mesmo HEAD, mesmas refs, sem stash. A documentação foi regravada depois por ferramenta de arquivo.

## 5. Histórico e refs perigosas

- `main` está limpa de senhas reais.
- Existem **234 commits no total** entre todas as refs; **231** estão em `refs/cline/checkpoints/*` e `refs/codex/turn-diffs/*` e contêm scripts soltos com credenciais reais.
- **Nunca** usar `git push --all`, `--mirror` ou `refs/*`. Publicar somente `main:main`. Alternativa mais segura: clone `--single-branch` limpo fora do OneDrive.
- Não removi nem alterei essas refs (limpeza exigiria autorização).

## 6. Arquivos preparados para publicação

Resumo (detalhe na seção 21):

| Classe | Arquivos |
|---|---:|
| Código de aplicação | 5 |
| Testes | 24 |
| Configurações | 6 |
| Workflows/CI | 3 |
| Documentação | 3 |
| Scripts auxiliares | 7 |
| **Total (3 commits)** | **48** |

Fora dos commits: 3 arquivos que o Git mostra como modificados só por final de linha (`README.md`, `backend/src/middleware/errorHandler.ts`, `frontend/src/App.tsx`: sem diferença de conteúdo), `RELATORIO-ENTREGA-3D.3.15.md`/`3.16.md` (alterações reais pequenas, docs) e os 60 relatórios (commit de docs opcional, pois contêm caminhos locais e o nome do usuário).

Entradas novas no `.gitignore` (verificadas com `git check-ignore`): `test-results/`, `playwright-report/`, `blob-report/`, `playwright/.cache/`, `*-Calil-Notebook*`, `*.dump.sha256`, `*.sql.gz`, `*.tmp`, `*.tmp_restore`, `RustikaBackups/`, `RustikaQuarantine/`, `CardapioDigital/`, `backend/data/`, cerca de 20 scripts soltos com credenciais em `backend/`, `backend/tests/scripts/verify-fixtures-rotation.ts`, `/check_out.txt`, `/inventory_*.txt`. As regras existentes foram mantidas e nenhum lockfile é ignorado.

## 7. Workflows do GitHub Actions

`.github/workflows/ci.yml` — **PREPARADA, MAS NÃO EXECUTADA**.

- Gatilhos: `pull_request` e `workflow_dispatch` (`run_backend`, `run_frontend`, `run_e2e` padrão `false`, `upload_diagnostics`). Sem `push`, `schedule` ou `pull_request_target`.
- `permissions: contents: read`; `concurrency` por ref; sem `secrets.*`; `persist-credentials: false`.
- Actions por SHA de commit (verificados com `git ls-remote` em 05/11/2026):
  - checkout v6.1.0 = `d23441a48e516b6c34aea4fa41551a30e30af803`
  - setup-node v6.5.0 = `249970729cb0ef3589644e2896645e5dc5ba9c38`
  - upload-artifact v6.0.0 = `b7c566a772e6b6bfb58ed0dc250532a479d7789f`
  - Existem majors mais novos (v7); mantive os anteriores por prudência.
- Jobs: `backend`, `frontend`, `e2e` (condição: `workflow_dispatch` + `run_e2e == true` + repositório privado).

## 8. PostgreSQL efêmero

**PREPARADO, MAS NÃO EXECUTADO.** `docker run --network host postgres:18` com `hba_file` próprio (`pg_hba.ci.conf`), `listen_addresses=127.0.0.1`; `bootstrap.sql` cria `cardapio_migrator`, `cardapio_test_app`, `cardapio_dev_app` (NOLOGIN) e os bancos `cardapio_digital_test`/`cardapio_digital_shadow`; migrations pelo script oficial; fixtures pelos SQL oficiais do projeto sem alteração; senhas geradas com `openssl rand -hex 24` e mascaradas; segredos em `${{ runner.temp }}` fora do workspace. Nunca foi criado de verdade: erros de bootstrap só aparecem na primeira execução manual.

## 9. Gates de segurança

Não foram alterados nem afrouxados: `assertE2eGate`, `assertIntegrationGate`, gate da limpeza legada, preflight (nomes exatos, 127.0.0.1:5432, 5 migrations, PostgreSQL ≥ 17, ACL, `pg_hba`, lock), `launch-env.ts`. O job `e2e` define apenas as variáveis de confirmação e não define `DATABASE_URL`, `SHADOW_DATABASE_URL` nem `RUSTIKA_E2E_LEGACY_CLEANUP`; `CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION` aparece só no passo de migration. Verificação estática: **APROVADA** (`ci-config.test.ts`).

## 10. Testes do backend

**APROVADA** — `vitest run`, com `CARDAPIO_SECRETS_DIR` apontando para uma pasta temporária vazia (simula o runner sem segredos): **33 arquivos, 711/711 testes** (33 s). Os testes de integração com banco ficam fora (exigem gates e banco).

## 11. Testes do frontend

**APROVADA** — `node --test`: **99/99**, 0 falhas.

## 12. Testes de API

**APROVADA** (dentro dos 711): login, login inválido, acesso sem sessão, sessão expirada, convite reutilizado, logout, rate limit, catálogo, pedidos (idempotência, CSRF), segurança. **Lacuna:** a API não tem rota de atualização de status nem listagem administrativa de pedidos; documentado, **não implementado**.

## 13. Testes Playwright preparados

**PREPARADA, MAS NÃO EXECUTADA.** Um teste (`e2e.spec.ts`, jornada completa), Chromium, 1 worker, sem retentativas, setup/teardown com manifesto e prova de resíduo zero. Eu **não** afirmo que o E2E funciona no CI: depende de uma execução real.

## 14. Cobertura adicional

Adicionada: `ci-config.test.ts` (24 testes estáticos do workflow, do bootstrap, do `pg_hba` e do `.gitignore`). **Não** adicionei especificações de navegador (quantidades, categorias): os seletores não podem ser validados sem rodar o E2E, e testes não validados no primeiro run remoto trariam falha por motivo errado. Registrado como lacuna.

## 15. Typecheck e builds

| Verificação | Resultado |
|---|---|
| Frontend `tsc --noEmit` | **APROVADA** (exit 0) |
| Frontend `vite build` | **APROVADA** (4,15 s) |
| Backend `tsc -p tsconfig.build.json --noEmit` | **APROVADA** (exit 0) |
| Backend `tsc --noEmit` completo, máquina local | **FALHOU** localmente: 2 erros, ambos em `tests/scripts/verify-fixtures-rotation.ts` (arquivo legado, ignorado e não rastreado) |
| Backend `tsc --noEmit` sem o legado (como um checkout limpo do CI) | **APROVADA** (verificado antes nesta etapa; sem mudança no `tsconfig`) |
| `npm run build` do backend | **PREPARADA, MAS NÃO EXECUTADA** como script (só o typecheck de build foi executado) |
| `npm ci --dry-run` (backend e frontend) | **APROVADA** |

O arquivo legado não foi movido nem apagado (instrução do usuário). Como está no `.gitignore`, não vai ao GitHub e não afeta o CI.

## 16. YAML e shell

- `ci.yml` interpretado com o pacote `yaml`: **APROVADA** (3 jobs).
- `bash -n` nos **23** blocos `run`: **APROVADA** (todos).
- Execução real dos workflows: **PREPARADA, MAS NÃO EXECUTADA** (proibido localmente e sem remoto).

## 17. Documentação

`backend/docs/github-actions-e2e.md` (estendida, seções 1–17), `backend/docs/e2e-real.md` (nota sobre limpeza já feita e alternativa de CI), `backend/docs/secrets-rotation.md`. Os dois primeiros já constavam como parte da 3D.3.25-A.

## 18. Estado do OneDrive

Repositório dentro do OneDrive. 32 cópias `*-Calil-Notebook.*` de conflitos anteriores seguem no disco (nenhuma apagada ou movida); agora são ignoradas pelo Git. Risco de novas cópias persiste enquanto o OneDrive sincronizar `.git` e `node_modules`: recomendo pausar a sincronização durante operações Git, ou publicar a partir de um clone limpo fora do OneDrive.

## 19. Estado Git final

Branch `main`, HEAD `a39247b`, **0 remotos**, **0 em stage**, 0 stashes, sem novos commits e sem novas refs. Nenhum `commit`, `push`, `reset` ou `clean` executado.

## 20. Riscos e pendências

1. Bootstrap do PostgreSQL efêmero e o job `e2e` nunca foram executados (primeiro run manual validará; pode falhar por detalhes do runner).
2. Consumo de minutos do Actions não medido.
3. Lacunas funcionais: sem status de pedido na API; E2E sem quantidades/categorias.
4. 231 commits em refs locais com credenciais reais: nunca publicar essas refs; considerar rotação das senhas reais (não feita).
5. Arquivo legado impede `tsc` completo local (ignorado, fora do CI).
6. Origem do stage dos 3 documentos não identificada (desfeito).
7. Três arquivos só com diferença de final de linha ficaram fora dos commits; `RELATORIO-ENTREGA-3D.3.15/16.md` têm pequenas alterações de conteúdo (decidir se entram no commit de docs).
8. Majors mais novos das Actions (v7) não adotados.
9. O claude-mem (memória do assistente) está sem credenciais há ~39 h; não afeta o projeto.

## 21. Comandos sugeridos para o primeiro commit (NÃO EXECUTADOS)

Revisar antes. Nunca `git add .`. Cada comando lista caminhos explícitos. Rastreado: M = já rastreado; N = novo.

**Commit 1 — aplicação, testes e configurações**

| Classe | Caminho | Motivo | Risco de segredo | Rastr. | Pronto |
|---|---|---|---|---|---|
| config | `.gitignore` | entradas de segurança | nenhum | M | sim |
| config | `backend/package.json` | scripts `e2e:*`, `secrets:audit`, deps | nenhum | M | sim |
| config | `backend/package-lock.json` | coerente com o package | nenhum | M | sim |
| config | `frontend/package.json` | Playwright e testes | nenhum | M | sim |
| config | `frontend/package-lock.json` | coerente com o package | nenhum | M | sim |
| config | `frontend/playwright.config.ts` | config do E2E | nenhum | N | sim |
| app | `backend/src/config/env.ts` | `.trim()` de `NODE_ENV` | nenhum | M | sim |
| app | `frontend/src/components/Header.tsx` | alteração de UI de fases anteriores | nenhum | M | sim |
| app | `frontend/src/services/api.ts` | `configuredApiUrl` | nenhum | M | sim |
| app | `frontend/src/services/orderSubmission.ts` | envio de pedido | nenhum | M | sim |
| app | `frontend/src/vite-env.d.ts` | tipos `VITE_*` | nenhum | M | sim |
| teste | `backend/tests/config/env.test.ts` | cobre env | nenhum | M | sim |
| teste | `backend/tests/integration-db/comandas.integration.ts` | integração | nenhum (gate) | M | sim |
| teste | `backend/tests/integration-db/support/databases.ts` | perfis/gates | nenhum | M | sim |
| teste | `backend/tests/scripts/pg-hba-isolation.test.ts` | isolamento | nenhum | M | sim |
| teste | `backend/tests/audit-secrets.test.ts` | auditoria (sanitizado) | **sanitizado, 0 reais** | N | sim |
| teste | `backend/tests/ci-config.test.ts` | valida o workflow | nenhum | N | sim |
| teste | `backend/tests/e2e-fixtures.test.ts` | E2E | nenhum | N | sim |
| teste | `backend/tests/e2e-launch-env.test.ts` | launch env | nenhum | N | sim |
| teste | `backend/tests/helpers/fake-fixtures-db.ts` | helper | nenhum | N | sim |
| teste | `backend/tests/helpers/launch-probe.ts` | helper | nenhum | N | sim |
| teste | `backend/tests/integration-db/e2e/cleanup-legacy.ts` | limpeza restrita | nenhum (gate) | N | sim |
| teste | `backend/tests/integration-db/e2e/gate.ts` | gates E2E | nenhum | N | sim |
| teste | `backend/tests/integration-db/e2e/launch-env.ts` | `guardedLaunch` | nenhum | N | sim |
| teste | `backend/tests/integration-db/e2e/legacy.ts` | resíduo legado | nenhum | N | sim |
| teste | `backend/tests/integration-db/e2e/lifecycle.ts` | ciclo | nenhum | N | sim |
| teste | `backend/tests/integration-db/e2e/manifest.ts` | manifesto | nenhum | N | sim |
| teste | `backend/tests/integration-db/e2e/real.ts` | E2E real | nenhum | N | sim |
| teste | `backend/tests/integration-db/e2e/run-setup.ts` | setup | nenhum | N | sim |
| teste | `backend/tests/integration-db/e2e/run-teardown.ts` | teardown | nenhum | N | sim |
| teste | `frontend/tests/e2e.spec.ts` | jornada | senha efêmera só em memória | N | sim |
| teste | `frontend/tests/globalSetup.ts` | setup | nenhum | N | sim |
| teste | `frontend/tests/globalTeardown.ts` | teardown | nenhum | N | sim |
| teste | `frontend/tests/e2e-guard.test.mjs` | trava | nenhum | N | sim |
| teste | `frontend/tests/vite-env-injection.test.mjs` | injeção | nenhum | N | sim |
| script | `backend/scripts/audit-secrets.ts` | auditoria sem imprimir valores | nenhum | N | sim |
| script | `backend/scripts/inspect-e2e-state.ts` | inspeção somente leitura | nenhum | N | sim |
| script | `backend/scripts/analyze-excel.ts` | alterado em fases anteriores | **revisar** | M | revisar diff |
| script | `backend/scripts/analyze-excel2.ts` | idem | **revisar** | M | revisar diff |
| script | `backend/scripts/executor-seed-real.ts` | idem | **revisar** | M | revisar diff |
| script | `backend/scripts/inspect-reconciliation.ts` | idem | **revisar** | M | revisar diff |
| script | `backend/scripts/seed-real.ts` | idem | **revisar** | M | revisar diff |

```bash
git add .gitignore backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json frontend/playwright.config.ts
git add backend/src/config/env.ts frontend/src/components/Header.tsx frontend/src/services/api.ts frontend/src/services/orderSubmission.ts frontend/src/vite-env.d.ts
git add backend/tests/config/env.test.ts backend/tests/integration-db/comandas.integration.ts backend/tests/integration-db/support/databases.ts backend/tests/scripts/pg-hba-isolation.test.ts
git add backend/tests/audit-secrets.test.ts backend/tests/ci-config.test.ts backend/tests/e2e-fixtures.test.ts backend/tests/e2e-launch-env.test.ts
git add backend/tests/helpers/fake-fixtures-db.ts backend/tests/helpers/launch-probe.ts
git add backend/tests/integration-db/e2e/cleanup-legacy.ts backend/tests/integration-db/e2e/gate.ts backend/tests/integration-db/e2e/launch-env.ts backend/tests/integration-db/e2e/legacy.ts backend/tests/integration-db/e2e/lifecycle.ts backend/tests/integration-db/e2e/manifest.ts backend/tests/integration-db/e2e/real.ts backend/tests/integration-db/e2e/run-setup.ts backend/tests/integration-db/e2e/run-teardown.ts
git add frontend/tests/e2e.spec.ts frontend/tests/globalSetup.ts frontend/tests/globalTeardown.ts frontend/tests/e2e-guard.test.mjs frontend/tests/vite-env-injection.test.mjs
git add backend/scripts/audit-secrets.ts backend/scripts/inspect-e2e-state.ts
git diff --cached --stat
```

Os cinco scripts modificados (`analyze-excel`, `analyze-excel2`, `executor-seed-real`, `inspect-reconciliation`, `seed-real`) não foram reabertos nesta etapa; a varredura não achou segredos neles, mas revise o `git diff` antes de adicioná-los:

```bash
git add backend/scripts/analyze-excel.ts backend/scripts/analyze-excel2.ts backend/scripts/executor-seed-real.ts backend/scripts/inspect-reconciliation.ts backend/scripts/seed-real.ts
```

Mensagem sugerida (o `git commit` em si é decisão sua): `test: E2E real com gates, auditoria de segredos e testes de CI`.

**Commit 2 — workflows**

| Classe | Caminho | Motivo | Risco | Rastr. | Pronto |
|---|---|---|---|---|---|
| workflow | `.github/workflows/ci.yml` | CI | nenhum (sem secrets; SHAs verificados) | N | sim |
| workflow | `.github/ci/bootstrap.sql` | roles/bancos efêmeros | nenhum (senhas por variável) | N | sim, **não executado** |
| workflow | `.github/ci/pg_hba.ci.conf` | `pg_hba` do runner | nenhum | N | sim, **não executado** |

```bash
git add .github/workflows/ci.yml .github/ci/bootstrap.sql .github/ci/pg_hba.ci.conf
```

**Commit 3 — documentação**

| Classe | Caminho | Motivo | Risco | Rastr. | Pronto |
|---|---|---|---|---|---|
| doc | `backend/docs/github-actions-e2e.md` | operação do CI | nenhum | N | sim |
| doc | `backend/docs/e2e-real.md` | E2E local | nenhum | N | sim |
| doc | `backend/docs/secrets-rotation.md` | rotação | nenhum (sem valores) | N | sim |

```bash
git add backend/docs/github-actions-e2e.md backend/docs/e2e-real.md backend/docs/secrets-rotation.md
```

**Opcional — relatórios** (60 arquivos `RELATORIO-ENTREGA-*.md` + `3.15`/`3.16` modificados): contêm caminhos locais e o nome do usuário; recomendo commit separado ou mantê-los fora do GitHub. Não incluí comandos individuais; liste com `git status --short | grep RELATORIO` e adicione por nome.

**Fora de qualquer commit:** `README.md`, `backend/src/middleware/errorHandler.ts`, `frontend/src/App.tsx` (somente final de linha), arquivos ignorados e as cópias `*-Calil-Notebook.*`.

Publicação, **somente após autorização e remoto privado**:

```bash
git remote add origin <URL-do-repositorio-privado>
git push -u origin main:main
git ls-remote --heads --tags origin
```

A conferência final deve listar só `refs/heads/main`.

## 22. Parecer final

**3D.3.25-B — CONCLUÍDA NO ESCOPO LOCAL; E2E NO CI NÃO VALIDADO.** Código, testes, YAML, scripts embutidos, SHAs das Actions e varredura de segredos estão aprovados; backend 711/711 e frontend 99/99. O `main` é publicável (limpo), desde que se publique **apenas** `main:main`, em repositório **privado**. O que não posso afirmar: que o PostgreSQL efêmero e o Playwright funcionam no runner. Isso só se prova com a primeira execução manual (`run_e2e`), que depende da sua autorização.
