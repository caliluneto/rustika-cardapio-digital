# RELATÓRIO DE ENTREGA — ETAPA 3D.5.2-A
**Resolver a incompatibilidade das migrations históricas com a homologação (banco `cardapio_digital_homolog`)**

**Situação:** arquitetura decidida, implementada em código e SQL e coberta por testes **sem banco**; prova em PostgreSQL real **preparada e NÃO executada**.
Nada foi aplicado a banco algum, nenhum banco/role/credencial foi criado ou alterado, nada foi commitado, publicado ou transferido ao snapshot.
Para auditoria do ChatGPT antes de avançar.

Legenda: **IMPLEMENTADO** · **TESTADO SEM BANCO** · **PREPARADO PARA EFÊMERO** · **NÃO EXECUTADO** · **DEPENDENTE DE AUTORIZAÇÃO**.

---

## 1. Causa técnica
Fatos lidos nas sete migrations (`backend/prisma/migrations`), sem alterá-las:

| # | Migration | Dependência de nome/identidade |
|---|---|---|
| 1 | baseline | nenhuma |
| 2 | `rf004_comandas_catalogo_pedidos` | `REVOKE … FROM cardapio_test_app, cardapio_dev_app, PUBLIC` — **nomes literais, sem guarda**: as duas roles precisam existir |
| 3 | `rf004_fix_permissions` | `current_db` ∈ {`cardapio_digital_dev`, `cardapio_digital_test`} → role derivada; senão `RAISE 'banco desconhecido'` |
| 4 | (sem guardas) | nenhuma |
| 5 | `runtime_least_privilege` | guarda de banco Dev/Test; executor e `session_user` = `cardapio_migrator`; dono do banco = executor; PG ≥ 17; as **duas** roles existem, sem membros/atributos elevados; `ALTER DEFAULT PRIVILEGES FOR ROLE cardapio_migrator` |
| 6 | `order_status_update_privilege` | idem 5 |
| 7 | `product_availability_update_privilege` | idem 5 |

Consequência: em um banco chamado `cardapio_digital_homolog` as migrations 3, 5, 6 e 7 abortam por desenho (`Unauthorized database`/`banco desconhecido`), e as 2, 5, 6, 7 exigem as roles legadas.
Arquivos publicados e com SHA-256 verificado (`EXPECTED_MIGRATIONS`, duplicado em `scripts/bootstrap/expectedMigrations.ts` e `tests/integration-db/support/preflight.ts`, igualdade testada) **não podem** ser editados.
Objetos persistentes que embutem nomes: **nenhum** (a análise estática confirma que só há guardas e `REVOKE/ALTER DEFAULT PRIVILEGES` de tempo de execução) — o que torna a renomeação segura (seção 4).
Não foi necessário alterar código de produção para o *negócio*; as mudanças são de infraestrutura de homologação.

## 2. Comparação das estratégias

| Critério | **A** — baseline específico de homologação | **B** — separar política de ambiente do SQL histórico | **C** — replay original + renomeação (OID-preservante) |
|---|---|---|---|
| Segurança | média: schema "equivalente" depende de auditoria humana | média/alta, mas altera o que foi publicado | **alta**: reproduz o histórico aprovado, sem exceções de guarda |
| Compatibilidade Prisma | exige marcar migrations como aplicadas (`resolve`) → **vedado sem prova auditável** | exige novo mecanismo ou migrations reescritas (checksums mudam) | **total**: o próprio Prisma aplica as sete originais e grava os checksums reais |
| Manutenção de migrations futuras | caminho paralelo, risco de duas verdades | mecanismo novo a manter | **um só caminho**; SQL futuro neutro de ambiente + lint |
| Risco de drift | alto e silencioso | médio | baixo; detectável por snapshot/diff |
| Controle de checksums | quebrado ou manual | quebrado | **preservado** (`_prisma_migrations` intacta) |
| Recuperação de falhas | recriar + remarcar | recriar | recriar cluster/banco descartável; scripts transacionais, sem `DROP` |
| Complexidade | média | alta | média (9 scripts + 1 perfil transitório + gate de identidade) |
| Limites | prova de equivalência manual | reescreve histórico | **só provável em PostgreSQL real**; exige cluster dedicado e que o provedor permita `RENAME` de banco/roles |

Outras alternativas avaliadas: banco `cardapio_digital_test` como definitivo (rejeitado pela decisão aprovada); `migrate resolve` sobre um baseline (rejeitado: viola a regra de prova auditável); dump/restore do schema do Test (rejeitado: sem trilha de migrations, ACLs dependentes de roles).

## 3. Estratégia recomendada — **C**
Em um **cluster PostgreSQL dedicado e vazio** de homologação: (1) criar transitoriamente as roles legadas e o banco `cardapio_digital_test`; (2) o Prisma aplica as **sete migrations originais**; (3) verificar; (4) `ALTER DATABASE cardapio_digital_test RENAME TO cardapio_digital_homolog` e renomear as roles; (5) redefinir senhas; (6) grants do bootstrap, janela, verificação final.
Por que é a mais segura/sustentável: nenhum SQL histórico é tocado, nada é "marcado" como aplicado, e o isolamento é verificado por **identidade do servidor**, não por hostname.

## 4. Demonstração de compatibilidade com o Prisma
* **IMPLEMENTADO / TESTADO SEM BANCO**: o wrapper `prisma-run` aceita para homologação somente `migrate status|deploy`; `reset`, `resolve`, `db push`, `dev`, `seed`, `diff` e flags extras são recusados (`tests/scripts/prisma-run-policy-homolog.test.ts`).
* Os checksums do diretório são conferidos antes de conectar (`verifyMigrationDirectory`); migration desconhecida/ausente/alterada é recusada (`tests/scripts/migration-integrity.test.ts`, `server-identity-and-drift.test.ts`).
* `_prisma_migrations` é gerada pelo Prisma durante o replay e **não é editada**; o rename não toca a tabela. `migrate deploy` no banco final deve responder "No pending migrations" (passo 5 da suíte efêmera).
* Prova de que a renomeação preserva o schema, **estática** (`tests/scripts/migration-rename-safety.test.ts`): nenhuma migration usa `CREATE FUNCTION/VIEW/TRIGGER/POLICY/EXTENSION`, `COMMENT ON`, `OWNER TO`, `ALTER ROLE/DATABASE`; toda linha que cita nome do projeto é guarda ou `REVOKE/ALTER DEFAULT PRIVILEGES` de execução; as guardas 3/5/6/7 **não** reconhecem a homologação (logo, o replay no banco com nome Test é obrigatório).
  PostgreSQL guarda ACLs/default ACLs/donos por OID — esta é uma propriedade do produto, **a confirmar no PostgreSQL efêmero** (seção 11).
* **NÃO EXECUTADO**: nenhuma conexão real, nenhum `prisma migrate` real.

## 5. Processo de criação do banco novo (`docs/homologation-environment.md`, seção 6)
`homolog:preflight` (offline) → `01-cluster-roles.sql` (recusa cluster com bancos/roles do projeto; cria roles legadas, bootstrap e a **marca** `rustika_homolog_marker`; imprime o UUID = `EXPECTED_CLUSTER_ID`) → `02-create-replay-database.sql` → `homolog:replay:status|deploy` (confirmação `REPLAY_HISTORICAL_MIGRATIONS_RUSTIKA_HOMOLOG`) → `03-verify-replay.sql` (leitura) → snapshot A → `04-finalize-rename.sql` (transacional; recusa conexões ativas, banco/roles definitivos já existentes, dev/shadow) → senhas → `homolog:migrate:status` + snapshot B + `schema:compare` → `05` grants do bootstrap → `06` abre → bootstrap → `07` fecha → `08` revoga → `09` verifica → `/api/ready`.
Nome definitivo **exclusivo** `cardapio_digital_homolog`; `dev`/`test`/`shadow` são recusados como banco definitivo em perfil, política Prisma e SQL. Roles finais: `cardapio_homolog_app`, `cardapio_homolog_migrator`, `cardapio_homolog_bootstrap`, `cardapio_homolog_placeholder` (NOLOGIN).

## 6. Processo para migrations futuras (8ª em diante)
* `EXPECTED_MIGRATIONS` é **fail-closed**: uma 8ª migration no disco é "desconhecida" até a lista (nome + SHA-256) ser atualizada conscientemente nos dois arquivos; testes exigem igualdade entre eles e com o disco.
* O SQL parte do modelo `backend/docs/templates/future-migration-environment-guard.sql` (guarda por `current_database()` cobrindo Dev/Test/Homolog; executor ∈ {`cardapio_migrator`, `cardapio_homolog_migrator`}; roles via `format('%I')`). `lintFutureMigration` reprova guarda só-Dev/Test, roles literais, `GRANT/REVOKE` sem guarda, `TRUNCATE`, DDL de banco/role (**TESTADO SEM BANCO**).
* **Dev**: fluxo já autorizado do perfil `migrate-dev` (inalterado). **Test**: `db:migrate:status:test|deploy:test` (inalterado). **Homologação**: `homolog:migrate:status`, revisão, `homolog:migrate:deploy` com `CARDAPIO_MIGRATE_HOMOLOG_CONFIRMATION=APPLY_RUSTIKA_HOMOLOG_MIGRATIONS` 🔒; o wrapper confere diretório e identidade do servidor antes de conectar.
* Ordem: Dev → Test/CI efêmero → `schema:fingerprint` → Homologação. Para **recriar** a homologação, o replay aplica as sete originais; as posteriores são aplicadas depois, já no banco final, por `homolog:migrate:deploy`.
* Passo 8 da suíte efêmera aplica uma 8ª migration neutra com a role definitiva (**PREPARADO**).

## 7. Controle de drift
* `npm run schema:fingerprint -- --profile migrate-dev|migrate-test|migrate-homolog [--out f.json]`: leitura de catálogo (migrations+checksums, tabelas, colunas/tipos/defaults, constraints incl. FKs, índices, enums, sequences, owners, ACLs de tabela/coluna/schema/banco e default), roles por papel lógico, `sha256` determinístico.
* `npm run schema:compare -- a.json b.json` (offline): exit 0/1/2; role desconhecida vira `?nome`.
* **Nunca corrige**: divergência → nova migration revisada nos três ambientes (ou recriação do ambiente descartável). Nenhum `db push`/`reset`/`resolve`, nenhuma alteração destrutiva automática.
* **TESTADO SEM BANCO**: estabilidade/ordem do fingerprint, diff por seção, aliasing de roles, detecção de tabela/coluna/ACL/migration divergentes. A **leitura real** de catálogo é validada somente na suíte efêmera.

## 8. Segurança das roles e do servidor
* Roles de projeto: `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`; placeholder e marca `NOLOGIN`; bootstrap `NOLOGIN` fora da janela, só `SELECT, INSERT` em `admins` + `SELECT` em `_prisma_migrations` + `USAGE` no schema, revogados ao final; runtime sem INSERT/UPDATE/DELETE em `admins` e sem acesso a `_prisma_migrations`. Scripts sem senha, sem `DROP/TRUNCATE/DELETE FROM/ALTER SYSTEM`, sem atributos elevados (teste estático).
* **Hostname não basta.** Gate de identidade do **servidor** (`src/config/serverIdentity.ts`) em `prisma-run` (perfis `migrate-homolog*`), no bootstrap e no `server.ts` (produção, antes de `listen`): TLS realmente em uso (`pg_stat_ssl`), PG ≥ 17, marca do cluster = `EXPECTED_CLUSTER_ID`, ausência de `cardapio_digital_dev/shadow`, coerência da fase (replay × final), role conectada esperada. Um host que resolva para o PostgreSQL de desenvolvimento é recusado (**TESTADO SEM BANCO** com fatos simulados).
* Perfis de homologação: sem loopback/localhost/`*.localhost`/0.0.0.0/::1/169.254.*/rótulo único; `EXPECTED_DATABASE_HOST` = host da URL; `EXPECTED_CLUSTER_ID` UUID; `sslmode` ∈ require/verify-ca/verify-full, `sslaccept` só `strict`; lista permitida de parâmetros; pasta de segredos própria obrigatória; arquivo 600; sem chave SHADOW; credenciais próprias e distintas (senhas ≥ 24; o replay só pode repetir a do migrator definitivo — é a mesma role).
* Limite honesto: a marca de cluster é um *segredo de identidade* guardado nos arquivos de homologação; protege contra apontar o perfil para o servidor errado, não contra quem já possui as credenciais do cluster certo.

## 9. Ajustes nos arquivos existentes
Alterados (backend): `config/database-profiles.json` (perfis `app/migrate/bootstrap-homolog` → `cardapio_digital_homolog`; novo `migrate-homolog-replay`), `src/config/secrets.ts` (identidade por perfil, `environment`, cluster, banco proibido), `scripts/prisma-run-policy.ts`, `scripts/prisma-run.ts` (assíncrono; gate de integridade + identidade), `src/server.ts` (gate em produção), `scripts/bootstrap/{adminBootstrap,prismaBootstrapDb,cli}.ts` (fatos do servidor, `clusterId`), `scripts/homolog/preflight.ts` (4 perfis, 9 SQL), `package.json` (`homolog:replay:*`, `schema:*`), exemplos `config/homolog-examples/*.env.example`, `docs/homologation-environment.md` (reescrito).
Criados: `src/config/serverIdentity.ts`, `scripts/homolog/schemaSnapshot.ts`, `scripts/schema-fingerprint.ts`, `scripts/schema-compare.ts`, `scripts/bootstrap/futureMigrationPolicy.ts`, `docs/templates/future-migration-environment-guard.sql`, `config/homolog-examples/migrate-homolog-replay.env.example`, `ops/homolog/sql/01…09`, testes novos.
Substituídos: os sete SQL antigos da 3D.5.2 por nove (replay+rename). **Preservado**: bootstrap do admin, mecanismo de segredos, `/api/ready`, gates de `env.ts`, perfis Dev/Test (regressão testada). **Nenhuma migration alterada** (checksums conferidos); nenhum código de negócio alterado.

## 10. Testes executados (sem banco)
* `npx tsc --noEmit`: apenas os 2 erros **pré-existentes** e alheios de `tests/scripts/verify-fixtures-rotation.ts` (módulo `pg` sem tipos / import relativo).
* `npm run test:ci` (backend): **50 arquivos passaram, 1 pulado (efêmero); 963 testes passaram, 8 pulados**.
* `npm run build`: sem erros.
* Cobertura pedida: nome exato `cardapio_digital_homolog`; recusa de bancos Dev/Test/Shadow como homolog; roles incompatíveis; integridade das sete migrations; análise de rename-safety; drift; migration desconhecida; tratamento de migration futura (lint + modelo); host errado/cluster errado/sem TLS; falhas de autorização (confirmações cruzadas, perfis trocados); 9 scripts SQL (estático); bootstrap com identidade do servidor.
* Varredura de segredos nos arquivos novos/alterados: apenas fixtures falsas de teste (`URL-PASSWORD-SECRET`, template `${password(user)}`); nenhum segredo real.
* Testes sensíveis (`rules.test.ts`, `cart/checkout/order-review`) **não tocados** nem copiados.

## 11. Testes efêmeros preparados (NÃO EXECUTADOS — DEPENDÊNCIA EXPLÍCITA DE POSTGRESQL REAL)
`npm run test:homolog:ephemeral` → `tests/homolog-ephemeral/provisioning.ephemeral.ts`. Exige `RUSTIKA_HOMOLOG_EPHEMERAL_URL` (admin do servidor descartável) e `RUSTIKA_HOMOLOG_EPHEMERAL_CONFIRM=RUN_ON_EPHEMERAL_POSTGRES`; **aborta antes de escrever** se houver qualquer banco/role `cardapio_*`/`rustika_*`; nunca contra bancos persistentes.
Passos: (1) roles+marca+banco de replay, recusas de repetição; (2) sete migrations originais pelo Prisma, checksums, snapshot A, `03`; (3) rename com recusa sob conexão ativa, senhas, identidade FINAL aprovada e cluster/fase errados recusados; (4) **equivalência A×B** — tabelas, colunas/tipos, constraints/FKs, índices, enums, sequences, owners, ACLs de tabela/coluna/schema/banco/default, `_prisma_migrations` idêntica, nenhuma role `?`; `09`; (5) `migrate deploy` = "No pending migrations"; (6) grants/janela/bootstrap/revogação/login desabilitado; (7) runtime opera e é negado em admins/DDL; (8) 8ª migration neutra com a role definitiva + drift detectado.
**O que só esta suíte pode provar:** `\gset/\if` do psql; `ALTER DATABASE … RENAME` e rename de roles sem perder ACL/default ACL/owner; conformidade de `GRANT USAGE ON SCHEMA public` com as guardas; leitura real de `readSchemaSnapshot`/`readServerFacts`; comportamento do Prisma sobre o banco renomeado. Sem ela, a estratégia está justificada por análise e testes estáticos, **não por demonstração**.

## 12. Riscos e limitações
1. Prova em PostgreSQL real pendente (seção 11). Se o rename não preservar algo, a suíte revelará e a estratégia será reavaliada antes de qualquer provisionamento.
2. Exige **cluster dedicado**; um provedor gerenciado pode restringir `RENAME` de banco/roles ou `CREATE ROLE`. Nesse caso: cluster auto-gerenciado ou nova decisão de arquitetura.
3. Existe uma janela breve em que o cluster de homologação contém um banco chamado `cardapio_digital_test` (transitório); mitigada pelo gate de fase e pelo script `09`.
4. O gate de TLS usa `pg_stat_ssl` (conexão realmente cifrada), mas a validação de cadeia depende do `sslmode` escolhido (`verify-full` recomendado) — validar na primeira conexão autorizada.
5. Sessões administrativas e limitadores em memória: uma única instância (herdado da 3D.5.2).
6. Os SQL dependem de `gen_random_uuid()` (PG ≥ 13) e dos privilégios do administrador do cluster.
7. Migrations futuras que ignorarem o modelo não são barradas em runtime (apenas pelo lint em revisão/CI); o wrapper só garante a integridade da lista conhecida.

## 13. Próxima etapa de validação (dependente de autorização)
1. Auditoria deste relatório pelo ChatGPT.
2. Autorização explícita para executar a suíte efêmera em um PostgreSQL 17/18 **descartável** (ex.: serviço do GitHub Actions ou contêiner isolado) — nunca no PostgreSQL local de Dev/Test.
3. Se a equivalência passar: transferência ao snapshot (`manifest-3d52a-transfer.txt`) e escolha/autorização do provedor do cluster dedicado; só então provisionamento 🔒.
4. Se falhar: ajustar scripts/estratégia com base no diff reportado — sem tocar nas migrations.

## 14. Estado dos repositórios
* **Original** (`Cardapio_Digital`, branch `master`, sem remote): alterações da 3D.5.2 e 3D.5.2-A **não commitadas** (working tree), inclusive as migrations 6 e 7 ainda não rastreadas por etapas anteriores (inalteradas por esta etapa, checksums conferem). Nenhum commit, push, merge ou alteração em `refs/cline/*`/`refs/codex/*`.
* **Snapshot**: **nada transferido**. Manifesto pronto: `manifest-3d52a-transfer.txt` (55 caminhos; substitui o da 3D.5.2; não inclui os quatro testes sensíveis).
* **Bancos**: nenhum banco/role criado, alterado ou consultado; PostgreSQL local, credenciais e `pg_hba.conf` intactos.
* Nenhum Playwright; nenhum `migrate resolve`, `db push`, `migrate reset`; outros projetos intactos.
