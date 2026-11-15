# E2E no GitHub Actions

**Estado: executado e aprovado (CI #5).** O workflow foi disparado manualmente contra o PostgreSQL efêmero do
runner; a jornada Playwright, o teardown e a prova de resíduo zero passaram. O fluxo local continua válido
(ver `e2e-real.md`).

## 1. Por que CI

O ambiente local tem 8 GB de RAM e o E2E real (backend + Vite + Chromium + Playwright) precisa de cerca de 1 GB livre além do uso normal. No GitHub Actions o E2E roda num runner descartável (`ubuntu-24.04`), contra um PostgreSQL 18 criado só para a execução. Nenhum banco local é tocado.

## 2. Arquitetura (`.github/workflows/ci.yml`)

| Job | Quando roda | O que faz | Banco / segredos |
| --- | --- | --- | --- |
| `backend` | `pull_request` e manual (`run_backend`) | `npm ci`, `prisma generate`, typecheck, build, Vitest | nenhum |
| `frontend` | `pull_request` e manual (`run_frontend`) | `npm ci`, typecheck, build, testes unitários | nenhum |
| `e2e` | **somente manual** (`run_e2e=true`) | PostgreSQL efêmero, migrations, fixtures, Playwright, prova de resíduo zero | banco do runner, senhas sintéticas |

`permissions: contents: read`; `persist-credentials: false` no checkout; nenhum `secrets.*` é usado; um `concurrency` cancela execuções repetidas da mesma ref. O E2E nunca roda em `push` nem em `pull_request`.

## 3. PostgreSQL efêmero

Passos do job `e2e` (todos no runner):

1. Gera 4 senhas aleatórias (`openssl rand -hex 24`), mascara-as (`::add-mask::`) e grava os três arquivos de segredo (`app-test.env`, `migrate-test.env`, `fixtures-test.env`) em `${{ runner.temp }}/cardapio-secrets`, com permissão `700/600`. A pasta fica **fora do workspace**, como exige `resolveSecretsDir`. É a mesma estrutura usada localmente em `%LOCALAPPDATA%\CardapioDigital\secrets`, com valores descartáveis.
2. Sobe `postgres:18` com `docker run --network host`. Em vez de *service container* porque `provision-test-fixtures.sql` e `enable-test-fixtures-login.sql` recusam servidores cujo `inet_server_addr()` não seja loopback, e a ponte do Docker mudaria o endereço. `listen_addresses=127.0.0.1`.
3. `.github/ci/pg_hba.ci.conf`: as cinco regras de `docs/sql/pg_hba-test-fixtures.conf.example` (role de fixtures só no banco Test, SCRAM, loopback; `reject` no resto), mais regras só para `cardapio_test_app` e `cardapio_migrator` e `local ... postgres trust` (administração dentro do container).
4. `.github/ci/bootstrap.sql`: cria `cardapio_migrator`, `cardapio_test_app` e `cardapio_dev_app` (sem login; exigida pela migration `20261104000000`), e os bancos `cardapio_digital_test` (dono `cardapio_migrator`) e `cardapio_digital_shadow` (exigido pelo perfil `migrate-test`).
5. `npm run db:migrate:deploy:test` — o script oficial, com `CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION` definida **somente nesse passo**.
6. Os scripts SQL oficiais, sem alteração: `provision-test-fixtures.sql`, senha por `ALTER ROLE`, `enable-test-fixtures-login.sql` (que valida o `pg_hba`) e `verify-test-fixtures.sql`.
7. `e2e:inspect` (somente leitura), Playwright, `e2e:inspect` final e uma verificação que falha se qualquer tabela de dados tiver linhas.
8. Em `always()`: remove o container e a pasta de segredos.

## 4. Isolamento e gates

Nenhum gate (`assertE2eGate`, `assertIntegrationGate`, preflight, `FIXTURES_REACHABLE_SQL`, `PERMISSIONS_SQL`) foi alterado. O CI satisfaz as verificações em vez de contorná-las: nomes exatos de banco e roles, host `127.0.0.1`, porta 5432, PostgreSQL ≥ 17, 8 migrations com checksums (a execução #5, anterior ao RF006, validou 5), ACL efetiva, `pg_hba` com recusa fora do banco Test, advisory lock. As variáveis `NODE_ENV=test`, `DB_PROFILE=app-test` e as três confirmações do projeto são as mesmas do uso local; `DATABASE_URL`, `SHADOW_DATABASE_URL` e `RUSTIKA_E2E_LEGACY_CLEANUP` não existem no job. `launch-env.ts` continua tratando o `.env` legado, que nem existe no runner.

O runner não alcança bancos locais, Supabase, PLATAFORMA_SITES_IA ou produção: não há credencial deles no job e a rede é a do runner.

## 5. Como executar manualmente

1. No GitHub: **Actions → CI → Run workflow**.
2. Escolha o branch, marque `run_e2e` (e desmarque `run_backend`/`run_frontend` se quiser economizar minutos).
3. Deixe `upload_diagnostics` desmarcado, salvo para diagnosticar uma falha.

Com a CLI: `gh workflow run ci.yml -f run_backend=false -f run_frontend=false -f run_e2e=true`.

## 6. Resultados e diagnóstico

- Logs: aba da execução, passo a passo. O reporter `line` mostra o teste, o resumo do teardown ("execução … limpa; pedido verificado: sim") e o `e2e:inspect` final.
- Falha no preflight/gates: o setup aborta **antes de escrever**; a mensagem lista o motivo (nenhuma senha é impressa; o `redactSecrets` do projeto é usado).
- Falha no bootstrap: é o ponto de maior risco da receita, validada no runner. Qualquer divergência de ACL/`pg_hba` aborta antes de gravar fixtures. Corrija `.github/ci/*` ou o passo e rode de novo; não relaxe gates.
- Falha do E2E: marque `upload_diagnostics`. O artefato é `playwright-diagnostics` (retenção 3 dias).

## 7. Artefatos e segredos

Por padrão **nada** é anexado. O `error-context.md` do Playwright é um snapshot da página e pode conter e-mail/ID sintéticos e o token do convite da execução; como o banco é destruído ao final, o risco é baixo, mas por isso o upload é opt-in. Nunca anexe dumps, `.env`, a pasta de segredos nem logs com URLs de conexão. O passo de logs do PostgreSQL mascara `://usuário:senha@`.

## 8. Custos e limites

Estimativa (não medida): `backend` 3–5 min, `frontend` 2–4 min, `e2e` 8–15 min (dependências do Chromium, imagem do Postgres, migrations, teste). Runner Linux de repositório privado consome minutos da cota do plano (conferir a cota atual no GitHub). Para economizar: use só `run_e2e`, não dispare por push, e mantenha `retries: 0`. `timeout-minutes` limita o custo de uma execução travada (15/15/30).

## 9. Testes locais continuam opcionais

`e2e-real.md` continua válido para quem tiver memória livre ≥ 1,8 GB. O CI não substitui a regra de autorização: o banco do runner é descartável, mas o fluxo de produção/Dev/Test locais não muda.

## 10. Histórico da primeira publicação

Antes do primeiro commit, o teste que continha uma senha real foi sanitizado (valores sintéticos), as Actions foram
fixadas por SHA e os arquivos E2E foram listados explicitamente. Continua valendo: nunca usar
`git push --all` ou `git push --mirror`; publique somente a `main` e confira o resultado com `git ls-remote`.

## 11. Actions fixadas por SHA de commit

Verificado com `git ls-remote --tags https://github.com/actions/<nome>.git` em 05/11/2026.

| Action | Versão | SHA do commit |
|---|---|---|
| actions/checkout | v6.1.0 | d23441a48e516b6c34aea4fa41551a30e30af803 |
| actions/setup-node | v6.5.0 | 249970729cb0ef3589644e2896645e5dc5ba9c38 |
| actions/upload-artifact | v6.0.0 | b7c566a772e6b6bfb58ed0dc250532a479d7789f |

Existem majors mais novos (checkout v7.0.1, setup-node v7.1.0, upload-artifact v7.0.2). Foram mantidos os anteriores por prudência; atualizar é uma decisão consciente.

Como atualizar: rodar `git ls-remote --tags https://github.com/actions/<nome>.git`, escolher a tag, copiar o SHA do commit (para tags anotadas, a linha com `^{}`), trocar no `ci.yml` mantendo o comentário com a versão e rodar `npx vitest run tests/ci-config.test.ts` (exige SHA de 40 hex). Nunca inventar ou copiar SHA de fonte não verificada.

## 12. Resumo de segurança do workflow

- `permissions: contents: read`; nenhum `secrets.*`; nenhum `pull_request_target`, `push` ou `schedule`.
- `persist-credentials: false` em todos os checkouts.
- O E2E só roda por `workflow_dispatch` com `run_e2e=true` e somente em repositório privado.
- Senhas do banco efêmero são geradas na execução (`openssl rand -hex 24`), mascaradas com `::add-mask::` e descartadas no passo final (`always()`).
- Os gates do projeto não foram alterados; o ambiente do job não define `DATABASE_URL`, `SHADOW_DATABASE_URL` nem `RUSTIKA_E2E_LEGACY_CLEANUP`.
- Artefatos de diagnóstico: opt-in, só em falha, só `frontend/test-results/`, retenção de 3 dias.
- Estes pontos são verificados estaticamente por `backend/tests/ci-config.test.ts`.

## 13. Cobertura e lacunas

Coberto pela suíte unitária/API (jobs `backend` e `frontend`): login, login inválido, acesso sem sessão, sessão expirada, convite reutilizado, logout, rate limit, catálogo, pedidos (idempotência, CSRF) e regras de domínio.

Coberto pelo E2E (quando executado): jornada catálogo → carrinho → convite/comanda → checkout → pedido persistido, e limpeza com prova de resíduo zero.

Planilha privada: `backend/data/Exportacao-produtos.xlsx` é dado comercial e **nunca vai ao GitHub** (`backend/data/` é ignorado). Os testes de importação e seed (`seed-real`, `seed-real-corrected`, `executor-seed-real`, `inspect-reconciliation`, `seed-dev`) agora leem uma **fixture sintética versionada**, `backend/tests/fixtures/catalog/synthetic-catalog.csv` (204 linhas fictícias com os mesmos quantitativos da planilha real: 174 ativos = 144 + 24 + 6, 30 inativos). Ela é gerada de forma determinística por `synthetic-catalog.ts` e conferida por `synthetic-catalog.test.ts`. As rotinas reais não mudaram: os parâmetros `filePath`/`catalogPath` têm como padrão a planilha real e só os testes os preenchem.

O que **só** a planilha real verifica está em `tests/scripts/private-catalog.test.ts` (6 testes: contagens reais, nomes e códigos reais conhecidos, código alfanumérico real, aparo de grupos, ausência de nomes reais na fixture). Esse arquivo se autoignora quando a planilha não existe; no CI aparece como *skipped*. A fixture passar **não** prova que o conteúdo real esteja correto. `npm run test:ci` força `RUSTIKA_IGNORE_PRIVATE_CATALOG=1` e reproduz localmente o que o CI enxerga; `RUSTIKA_REQUIRE_PRIVATE_CATALOG=1` transforma a ausência da planilha em erro.

Dependência `xlsx`: é instalada de **`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`**, a origem oficial da SheetJS (a versão publicada no registro npm é antiga, `0.18.x`, e tem vulnerabilidades conhecidas). O `package-lock.json` fixa a versão `0.20.3` e o hash `sha512` do tarball; `npm ci` recusa um arquivo cujo hash difira. Verificado em 05/11/2026: o hash do tarball baixado da CDN confere com o do lockfile, e `npm 10.9.10` (o do runner com Node 22) instala sem opções extras. Riscos: depende da disponibilidade de `cdn.sheetjs.com` (uma queda quebra o `npm ci`); o npm 12 recusa origens remotas por padrão (`allow-remote=none`), e nesse caso a instalação local exige `npm ci --allow-remote=root`, **sem** alterar a configuração global. `ci-config.test.ts` falha se o `xlsx` mudar de origem/versão, perder o hash, ou se surgir outro pacote fora do registro npm.

Lacunas conhecidas do E2E automatizado:
- Atualização de status de pedido e listagem administrativa: implementadas na API, mas a jornada correspondente é opt-in e não faz parte do teste padrão do CI.
- Quantidades no carrinho e categorias no navegador: sem especificações Playwright. Não foram escritas porque os seletores não podem ser validados sem executar o E2E.

## 14. Operação

1. Repositório **privado** (o job recusa repositório público).
2. Actions → CI → Run workflow → marcar `run_e2e`.
3. Acompanhar o resumo do job; em falha, os logs do PostgreSQL saem com a URL mascarada.
4. Para anexar diagnósticos, marcar `upload_diagnostics` (podem conter dados sintéticos da página).
5. Trocar versões de Node, Playwright ou PostgreSQL: editar `node-version`, `frontend/package.json` ou a imagem `postgres:18`; o provisionamento exige PostgreSQL ≥ 17.
6. O consumo de minutos do Actions não foi medido.
7. O bootstrap do banco efêmero (`.github/ci/bootstrap.sql`, `pg_hba.ci.conf`) é validado a cada execução manual; o CI #5 aprovou o fluxo completo.
8. Pausar a sincronização em nuvem durante operações Git evita cópias de conflito.

## 15. Publicar somente a `main`

O remoto privado está configurado. O procedimento abaixo permanece como referência e exige autorização:

```bash
git remote add origin <URL-do-repositorio-privado>
git push -u origin main:main
git ls-remote --heads --tags origin
```

A conferência final deve listar apenas `refs/heads/main`. Nunca usar `git push --all`, `--mirror` ou `refs/*`. Alternativa mais segura: clonar `main` com `git clone --single-branch --branch main` para uma pasta limpa e publicar a partir dela.

## 16. Reverter o CI

Remover `.github/workflows/ci.yml` e `.github/ci/` em um commit próprio, ou desativar o workflow em Actions. Nenhum recurso externo é criado pelo CI (o banco e os segredos vivem só no runner).

## 17. Registro da execução

O CI #5 executou o job `e2e` manualmente e aprovou a jornada, o teardown e a prova de resíduo zero. Os logs
permanecem disponíveis na aba Actions do repositório privado.
