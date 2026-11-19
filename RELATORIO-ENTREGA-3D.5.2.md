# RELATÓRIO DE ENTREGA — ETAPA 3D.5.2
Ambiente de homologação reproduzível, bootstrap seguro e primeiro administrador (arquivos locais; **sem commit, sem push, sem execução em banco**)

## 0. Achado que condiciona a etapa (decisão necessária — leia primeiro)
As migrations 3, 5, 6 e 7 (imutáveis, com checksum) contêm guardas fixas: `current_database()` ∈ {`cardapio_digital_test`, `cardapio_digital_dev`}, role de runtime derivada (`cardapio_test_app`/`cardapio_dev_app`), **as duas** roles existentes, dono do banco e executor `cardapio_migrator`, PostgreSQL ≥ 17. Sem alterar migrations, **um banco de homologação só pode ter esses nomes**. Isso contradiz literalmente a diretriz "homologação não pode usar `cardapio_digital_test`". Solução implementada: o isolamento é por **host** (instância dedicada e remota), não por nome — perfis locais exigem loopback; perfis de homologação **proíbem** loopback/localhost/metadados/rótulo único, exigem TLS, `EXPECTED_DATABASE_HOST` e pasta de segredos própria; `cardapio_digital_dev`, `cardapio_digital_shadow`, `postgres` e outros bancos são rejeitados. Risco residual: confusão operacional pelo nome. **Decisão pedida ao auditor/dono:** aceitar esta solução ou autorizar, em etapa própria, uma alternativa que contrarie a regra de preservar as sete migrations.

## 1. Arquitetura proposta
* Três ambientes formalizados (Dev local / Test CI efêmero / Homologação remota dedicada) em `backend/docs/homologation-environment.md`.
* Três perfis novos, marcados `environment: "homolog"`, com finalidades separadas: `app-homolog` (runtime), `migrate-homolog` (migração), `bootstrap-homolog` (primeiro administrador). Inspeção = pré-voo offline + `07-verify-acl.sql` somente leitura.
* Integridade das migrations (nomes + SHA-256) **separada** da política de autorização do ambiente (`scripts/bootstrap/migrationIntegrity.ts` × `prisma-run-policy.ts`/`secrets.ts`).
* Procedimento de provisionamento em 7 scripts SQL (`backend/ops/homolog/sql`) + wrapper de migrations + bootstrap CLI + pré-voo; tudo preparado, nada executado.

## 2. IMPLEMENTADO (código e arquivos)
**Alterados (10):** `backend/package.json` (scripts `homolog:*`, `test:homolog:ephemeral`), `config/database-profiles.json` (+3 perfis), `src/config/secrets.ts`, `src/config/env.ts`, `src/lib/prisma.ts`, `src/app.ts` (monta `/api/ready`), `src/server.ts` (valida config em production), `scripts/prisma-run-policy.ts`, `scripts/prisma-run.ts`, `docs/admin-provisioning.md`.
**Novos:** `src/config/homologRuntime.ts`, `src/routes/ready.routes.ts`, `scripts/bootstrap-admin.ts`, `scripts/homolog-preflight.ts`, `scripts/bootstrap/{adminBootstrap,adminInput,cli,expectedMigrations,hiddenPrompt,migrationIntegrity,prismaBootstrapDb}.ts`, `scripts/homolog/preflight.ts`, `ops/homolog/sql/01…07`, `config/homolog-examples/*.env.example` (4), `vitest.homolog-ephemeral.config.mts`, `docs/homologation-environment.md`, 7 arquivos de teste. Manifesto: `manifest-3d52-transfer.txt` (42 caminhos).
**Não alterados:** as sete migrations (checksums conferidos por teste contra o disco), perfis `app-dev/app-test/migrate-dev/migrate-test`, workflows, E2E, contratos de login/pedido, os quatro testes sensíveis.

### 2.1 Política de autorização
* `loadDatabaseProfile`: homolog ⇒ pasta de segredos explícita (`CARDAPIO_SECRETS_DIR`), arquivo 600 (POSIX), chave extra só `EXPECTED_DATABASE_HOST`, sem `SHADOW_DATABASE_URL`, host remoto não proibido e igual ao esperado, porta 1–65535, `sslmode` ∈ {require, verify-ca, verify-full}, `sslaccept` só `strict`, parâmetros de URL por lista permitida (`schema=public`), banco/usuário exatos por finalidade (`HOMOLOG_IDENTITY`), senha não placeholder. Finalidade errada é recusada (runtime×migração×bootstrap).
* `env.ts`: `app-homolog` ⇒ `NODE_ENV=production`; `production` ⇒ somente `app-homolog` e `DB_PROFILE` explícito. Dev/Test inalterados. `server.ts` em production valida `CORS_ORIGIN` (https público exato, nunca localhost).
* `prisma-run-policy`: `migrate-homolog` aceita só `status`/`deploy`; deploy exige confirmação **própria** (`CARDAPIO_MIGRATE_HOMOLOG_CONFIRMATION=APPLY_RUSTIKA_HOMOLOG_MIGRATIONS`) — a do Test local não vale e vice-versa; `reset/resolve/db push/dev/seed` seguem bloqueados; `prisma-run.ts` verifica nomes+SHA-256 das migrations antes de qualquer conexão. Não existe flag que desligue gates.

### 2.2 Bootstrap do primeiro administrador
Comando separado da API: `npm run homolog:bootstrap-admin -- --profile bootstrap-homolog --name … --email … [--execute]`. Sem `--execute` = dry-run somente leitura. Com `--execute` exige `CARDAPIO_BOOTSTRAP_CONFIRMATION=CREATE_FIRST_ADMIN_RUSTIKA_HOMOLOG`. Senha: digitada duas vezes sem eco, só em TTY; qualquer argumento parecido com senha/segredo é recusado; nunca em env/arquivo/log. Verifica banco e role exatos, role sem atributos elevados e **sem** UPDATE/DELETE/TRUNCATE em `admins`, PG ≥ 17, sete migrations aplicadas com checksum, nenhum administrador. Política: **somente o primeiro**; recusa se existir. Inserção em transação `Serializable` (recontagem) ⇒ concorrência não cria dois. Hash = `hashPassword` existente. Saída: ambiente/banco/role/host/modo/resultado e e-mail mascarado; erros inesperados mostram só o código `Pxxxx` (mensagens do Prisma podem conter o hash). Sem endpoint público; sem privilégio de bootstrap no runtime.
Tratamento de falhas: falha antes do commit não deixa estado; reexecutar. Se o admin já existe: recusa (código 2); redefinição de senha é procedimento separado e aprovado (não automatizado).

### 2.3 Provisionamento (procedimento documentado, não executado)
`01` roles (aborta se existirem; `cardapio_dev_app` e `cardapio_bootstrap` `NOLOGIN`; senhas por `\password`) → `02` banco (`\if` recusa sobrescrever; sem `DROP` em nenhum script) → migrations via wrapper → `03` ACL do bootstrap (`SELECT,INSERT` em `admins`, `SELECT` em `_prisma_migrations`) → `04` abre / `05` fecha janela de login do bootstrap → `06` revoga → `07` verificação read-only. Detalhes, falhas e recuperação em `docs/homologation-environment.md` §4.

### 2.4 Prontidão
`GET /api/ready` (novo): `SELECT 1` + sonda `products.availability_state`, timeout 2 s, cache 5 s/1 s, só leitura, 200/503 com corpo genérico `NOT_READY`. `GET /api/health` inalterado (não consulta o banco).

### 2.5 Segredos
Apenas exemplos com placeholder (`SENHA_URLENCODED_SUBSTITUA`); nenhuma senha gerada ou salva; credenciais locais intocadas; pasta de segredos própria obrigatória; rotação e apagamento de `bootstrap-homolog.env` documentados.

## 3. TESTADO LOCALMENTE SEM BANCO
Novos arquivos de teste: perfis de homologação (hosts proibidos, TLS, parâmetros, banco/usuário trocados, EXPECTED_DATABASE_HOST, credenciais ausentes/placeholder, finalidade, modo do arquivo, regressão dos perfis locais), gates de `env`/`prisma`/CORS, política Prisma, integridade das sete migrations (disco, `_prisma_migrations` simulado, desconhecida/ausente/checksum), SQL estático dos 7 scripts, pré-voo, bootstrap (política de fatos, atomicidade simulada, corrida, falha, dry-run, senha por argumento, sem TTY, confirmação, vazamento de senha/hash/URL em logs), `/api/ready` (inclui timeout real).
Resultados: ver bloco "Verificação final" abaixo. Não executados: PostgreSQL persistente, migrations, seed, Playwright, GitHub Actions, frontend (não alterado).

## 4. PREPARADO PARA CI / AMBIENTE EFÊMERO (não executado)
`tests/homolog-ephemeral/provisioning.ephemeral.ts` + `vitest.homolog-ephemeral.config.mts` (`npm run test:homolog:ephemeral`): cria roles e banco vazio, recusa sobrescrever, aplica as **sete migrations originais**, ACL, bootstrap único, recusa do segundo, login com a role de runtime (+ senha errada → 401), negações de escrita/DDL, bootstrap sem login após a janela, **ausência de resíduos**. Só roda com `RUSTIKA_HOMOLOG_EPHEMERAL_URL` + `RUSTIKA_HOMOLOG_EPHEMERAL_CONFIRM=RUN_ON_EPHEMERAL_POSTGRES`, exige `psql` e **aborta antes de escrever** se o servidor tiver qualquer banco/role `cardapio_*`. Fora de `npm test`/`test:ci`. Não há job de CI criado (workflow intocado).

## 5. NÃO EXECUTADO
`CREATE ROLE/DATABASE`, `GRANT`, migrations, bootstrap, seed, Playwright, workflows, deploy, qualquer conexão a PostgreSQL persistente, criação de recursos de nuvem, geração de senhas, commit/push.

## 6. DEPENDENTE DE AUTORIZAÇÃO
(1) Decisão sobre o nome `cardapio_digital_test` (§0). (2) Escolha/contratação da hospedagem e do PostgreSQL ≥ 17 com TLS. (3) Execução do ensaio efêmero (serviço PostgreSQL descartável) — recomendado **antes** de qualquer instância real. (4) Criação de roles/banco/migrations/ACL na instância de homologação. (5) Bootstrap do primeiro administrador (titular, e-mail, canal de entrega). (6) Transferência ao snapshot e publicação privada. (7) Job opcional de CI para a suíte efêmera.

## 7. Diferenças entre ambientes
Resumo na tabela de `homologation-environment.md` §1: perfis, `NODE_ENV`, host (loopback × remoto/TLS), pasta de segredos, dados.

## 8. Riscos e pendências
* **Nome do banco** (§0). 
* Scripts SQL e `psql \gset/\if` sem execução; premissa de que `GRANT USAGE ON SCHEMA public` e as ACL de `admins`/`_prisma_migrations` não conflitam com as guardas já aplicadas só será provada no PostgreSQL efêmero.
* `sslmode=verify-*` com CA privada depende do suporte do provedor/Prisma; validar na primeira conexão autorizada.
* Sessões administrativas e limitadores em memória: **uma única instância** em homologação; atrás de proxy faltam `trust proxy` (P1 da 3D.5.1) — não tratado aqui.
* Uma nova migration futura exige atualizar `EXPECTED_MIGRATIONS` (falha fechada, intencional).
* Pendências de produto da 3D.5.1 (alerta de pedidos, fechamento de comanda, catálogo piloto, LGPD) não fazem parte desta etapa.
* `tsc --noEmit` mantém dois erros antigos em `tests/scripts/verify-fixtures-rotation.ts` (arquivo legado, fora do escopo, preexistentes).

## 9. Manifesto de publicação
`manifest-3d52-transfer.txt` (42 arquivos, nenhum `.git`, nenhum segredo; fora dele: `.env`, qualquer arquivo de segredo, os quatro testes sensíveis). Comparação com o snapshot: as 10 diffs em arquivos existentes contêm apenas as alterações desta etapa.

## 10. Próximas autorizações necessárias
Ver §6. Sequência sugerida: decisão §0 → auditoria deste relatório → transferência/publicação privada → ensaio efêmero (CI) → só então hospedagem e execução real.

## 11. Estado final dos repositórios
Original: HEAD `3b857ad`, índice vazio, sem remoto, **nenhuma operação Git**; alterações apenas em arquivos de trabalho listados acima. Snapshot: `main` = remoto = `5ef3643`, árvore limpa, intocado. Nenhum banco, migration, seed, Playwright, workflow, deploy ou credencial local foi tocado.

## Verificação final
* `npm run test:ci` (backend, sem banco): **48 arquivos aprovados, 1 ignorado; 939 testes aprovados, 8 ignorados, 0 falhas** (inclui os sete arquivos novos; suíte efêmera fora do conjunto).
* Suíte efêmera: carrega e se auto-ignora sem a URL/confirmação (7 testes `skipped`).
* `tsc --noEmit`: somente os 2 erros preexistentes de `verify-fixtures-rotation.ts`; **zero erros novos**. `npm run build` (`tsc -p tsconfig.build.json`): 0 erros.
* Varredura de segredos nos arquivos novos/alterados (URLs com credencial, exceto placeholders): sem achados. `audit-secrets` não foi executado (lê a pasta de segredos local; desnecessário e fora do escopo).
* Frontend, E2E e workflows: não alterados, não reexecutados.
