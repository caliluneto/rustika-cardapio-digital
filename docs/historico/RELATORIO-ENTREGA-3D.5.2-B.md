# RELATÓRIO DE ENTREGA — ETAPA 3D.5.2-B
**Auditoria final e preparação do teste real de homologação efêmera**

**Situação:** estratégia revisada criticamente; defeitos de *cobertura e de pré-condições* corrigidos; ensaio integral e workflow manual **preparados**.
**A estratégia (banco transitório + renomeação) continua NÃO comprovada**: nenhum PostgreSQL foi usado, nenhuma migration foi executada, nenhum workflow foi disparado, nada foi commitado, publicado ou transferido ao snapshot.
Para auditoria do ChatGPT antes da transferência.

Legenda: **IMPLEMENTADO** · **VALIDADO ESTATICAMENTE** · **PREPARADO PARA CI** · **NÃO EXECUTADO** · **BLOQUEADO**.

---

## 1. Revisão do banco transitório
| Verificação pedida | Resultado |
|---|---|
| Nome transitório exato (`cardapio_digital_test`) e definitivo (`cardapio_digital_homolog`) | IMPLEMENTADO / VALIDADO ESTATICAMENTE (scripts 02/04/09, perfis e política; testes). |
| Ausência de conexões ativas | **Já havia** (`pg_stat_activity`); o teste 6 do ensaio abre uma sessão e exige a recusa. |
| Sessões da API | A API só conecta com `cardapio_homolog_app`/banco final; antes do rename ela não existe. Documentado: parar a API antes do 04. |
| Transações pendentes | **Defeito corrigido:** o 04 não verificava `pg_prepared_xacts` nem `pg_replication_slots` do banco. Agora aborta. |
| Sessão do administrador no banco renomeado | **Defeito corrigido:** o 04 não exigia `current_database() = 'postgres'`. Agora exige. |
| Ownership, search_path, configurações por banco/role | **Defeito corrigido:** o 03 não olhava `pg_db_role_setting`, schemas extras, event triggers nem dono de tipos/schema. Agora reprova (read-only). |
| TLS e URLs Prisma | Gate `pg_stat_ssl` pós-conexão; URLs do ensaio `sslmode=require&sslaccept=strict&sslcert=<CA>`; ver seção 9 (ponto a confirmar sobre `verify-*`). |
| Reabertura das conexões | O ensaio fecha o cliente transitório, renomeia, redefine senhas e abre **novos** clientes/wrappers com a identidade final; o perfil de replay passa a falhar (teste 8). |
| Não renomear bancos fora do ensaio | Nenhum rename foi executado; o 04 só roda por psql manual e a suíte aborta se o servidor não for o descartável nomeado. |

## 2. Revisão das roles
* **A role renomeada não é a conectada:** o 04 agora recusa `current_user`/`session_user` ∈ {`cardapio_migrator`, `cardapio_test_app`, `cardapio_dev_app`}; o teste 6 executa o 04 *como* `cardapio_migrator` e exige falha sem alterar nada. (PostgreSQL também proíbe renomear a role da sessão.)
* **Referências textuais a nomes:** as migrations só citam nomes em guardas e em `REVOKE/ALTER DEFAULT PRIVILEGES` de execução (teste estático `migration-rename-safety`); o 03 agora **reprova** se existirem funções, views, triggers, políticas ou event triggers em `public` (onde um nome embutido sobreviveria ao rename como texto desatualizado). Renomear roles **não** reescreve SQL armazenado — não foi assumido: o desenho depende de não haver SQL armazenado, e isso é verificado por script e por snapshot.
* **Memberships:** o 03 reprova qualquer membership envolvendo roles do projeto; o snapshot compara `memberships`.
* **Privilégios:** nenhum privilégio de runtime foi ampliado. O ensaio compara a **matriz efetiva** (`has_table_privilege`/`has_column_privilege`/schema/database) de runtime, migrator, placeholder e bootstrap antes×depois do rename e exige: runtime sem TRUNCATE/REFERENCES/TRIGGER, sem `CREATE` no schema, sem acesso a `_prisma_migrations`, somente `SELECT` em `admins`; placeholder sem privilégios.

## 3. Verificação de ownership
03 (read-only, ANTES do rename) exige dono do banco = `cardapio_migrator`; toda tabela/sequência/índice/view em `public` e `_prisma_migrations` com dono `cardapio_migrator`; schema `public` com dono `cardapio_migrator` ou `pg_database_owner`; tipos (enum) com dono esperado; um único schema de usuário. O snapshot (seções `owners`, `schemas`, `views`, `functions`) repete a verificação depois do rename, com nomes trocados por papéis lógicos. Ownership é por OID: o rename deve preservá-lo — **a confirmar no ensaio (NÃO EXECUTADO)**.

## 4. ACLs
Snapshot ampliado (IMPLEMENTADO): `tableAcls`, `columnAcls`, `schemaAcls`, `databaseAcls`, `defaultAcls`, `roles` (atributos, login, conexões), `memberships`, `settings` (`pg_db_role_setting`), `databaseProps` (encoding, collation, limite, allowconn). Matriz de privilégios efetiva (item 2) complementa as ACLs literais. `09-verify-acl.sql` continua como verificação final read-only.

## 5. Integridade das sete migrations
* Arquivos SQL **intactos** (checksums conferidos; nenhum alterado nesta etapa; `git diff` vazio em `prisma/migrations`).
* Ensaio (PREPARADO): `verifyMigrationDirectory` no disco; após o replay, `_prisma_migrations` com **conjunto exato**, todas concluídas, não revertidas, `applied_steps_count = 1`, `logs` nulos, checksums esperados (`verifyAppliedMigrations`); após o rename, as **linhas completas** (incluindo `started_at`/`finished_at`) são idênticas; adulterar um checksum é detectado e depois restaurado; wrapper final: `status` = up to date e `deploy` = "No pending migrations".
* Nenhum uso de `migrate resolve`, `db push` ou `migrate reset` (o teste estático proíbe o texto na suíte).

## 6. Equivalência do schema
Snapshot A (antes) × B (depois), mais `classifyRenames`: as quatro renomeações **aprovadas** (banco + 3 roles) são reconhecidas como legítimas; qualquer outra diferença de identidade (role sumida/extra/não renomeada, banco errado) é "inesperada" e reprova. Diferença de qualquer seção do snapshot reprova (sem tolerância). **Não** se usa o `schema.prisma` como prova. Seções: schemas, tabelas (com RLS/force), colunas/tipos/defaults, constraints (FKs), índices, enums, sequências, funções, views, triggers, políticas, owners, ACLs de tabela/coluna/schema/banco/default, roles, memberships, settings, propriedades do banco. VALIDADO ESTATICAMENTE (fingerprint/diff/aliases/renomeações com testes unitários); a **leitura real** dos catálogos só será provada no ensaio.

## 7. Oitava migration sintética
Feita em **cópia temporária** do backend (`os.tmpdir()`, `node_modules` por link) — o repositório não ganha migration, a lista `EXPECTED_MIGRATIONS` real não muda e nada vai para o Git. SQL = modelo neutro (`future-migration-environment-guard.sql` + `CREATE TABLE ephemeral_probe`), aprovado por `lintFutureMigration`.
Sequência: (a) wrapper recusa a migration **desconhecida**, nada aplicado (7 linhas); (b) simula-se a atualização revisada da lista **só na cópia** e `homolog:migrate:deploy` aplica; (c) linha nova com checksum = SHA-256 do arquivo, `applied_steps_count=1`; as sete originais idênticas; (d) segunda execução: "No pending migrations", sem reaplicação; (e) a tabela nova nasce **sem** privilégios para o runtime (default privileges herdados); (f) drift entre B e C aparece em `migrations/tables/columns` e **não** em roles/ACL de schema/banco; (g) arquivo adulterado depois de aplicado → wrapper recusa ("checksum divergente"). Tudo some com o `tmpdir` e com o PostgreSQL descartável. Nota: o bootstrap exige o conjunto exato de sete migrations — por isso o bootstrap ocorre **antes** da 8ª (ordem do ensaio).

## 8. Bootstrap administrativo
Teste 10 (PREPARADO): ausência inicial de administradores (`dry-run-ok`); recusas com role, banco e `clusterId` errados (`ENVIRONMENT_MISMATCH`, contagem continua 0); criação com senha sintética forte (gerada em memória); segundo bootstrap → `ADMIN_ALREADY_EXISTS`; contagem = 1; `UPDATE`/`DELETE` negados; hash armazenado ≠ senha e `verifyPassword` verdadeiro/falso; senha ausente de todas as saídas serializadas; runtime tentando bootstrap é recusado (recusa ou erro de permissão em `_prisma_migrations`); janela fecha, privilégios revogados, login do bootstrap impossível. Teste 11: `/api/ready` 200, **login HTTP** com cookie `rustika_admin`, senha errada 401, escritas e DDL negados ao runtime.
A CLI interativa **não foi enfraquecida**: o ensaio exercita o mesmo núcleo (`runBootstrap` + `createPrismaBootstrapDb`) com a leitura de senha injetada, exatamente como os testes unitários já faziam; as verificações de TLS/identidade rodam de verdade (o servidor do ensaio tem TLS).

## 9. TLS e identidade do cluster
* **Quem cria/altera a marca:** quem administra o cluster (script 01). **Onde:** `COMMENT` da role `rustika_homolog_marker` (`NOLOGIN`). **Valor esperado:** impresso uma vez pelo 01 e copiado fora de banda para `EXPECTED_CLUSTER_ID`; o ensaio o extrai da **saída do script** e confere com o catálogo (teste 1), nunca o lê do servidor sob verificação para aceitá-lo.
* **Limite assumido:** a marca é cópia-ável; prova consistência, não autenticidade. Autenticidade vem de TLS com validação de cadeia/nome + credenciais próprias (seção 12.2 do doc). Variável de ambiente ou marca isoladas **não** são tratadas como prova.
* **TLS de verdade:** o servidor do ensaio só aceita `hostssl` (`hostnossl … reject`); a suíte exige `pg_stat_ssl.ssl = true` antes de escrever; o teste 0 usa uma **CA errada** e exige recusa; o CI ainda confere TLS `verify-full` pelo `psql` do host, com SAN = IP do runner.
* **Outro host:** servidor errado é detectado por `cluster_name` descartável (antes da primeira escrita), marca ≠ esperada, presença de `cardapio_digital_dev`/`shadow` (testes 9), fase incoerente.
* **Ponto não resolvido (RISCO):** o parser do Prisma/quaint pode ignorar `sslmode=verify-ca|verify-full` (aceitos pelos perfis do projeto) e usar `prefer`. Não pude confirmar sem executar. Mitigações existentes: gate `pg_stat_ssl` e `sslaccept=strict`. Recomendação: após a primeira execução, restringir os perfis a `sslmode=require` (+ `sslcert`) se o comportamento se confirmar.
* O ensaio com CA sintética testa o **mecanismo**, não o certificado de um provedor futuro. Nenhum certificado/credencial real foi gerado.

## 10. Job manual preparado (PREPARADO PARA CI — NÃO DISPARADO)
`.github/workflows/homolog-ephemeral.yml` + `backend/ops/homolog/ci/{start-ephemeral-postgres,diagnostics,teardown}.sh`: somente `workflow_dispatch`; input `run_homolog_ephemeral` default `false`; sem push/PR/schedule; PostgreSQL 18 **próprio** (container `pg-homolog-ephemeral`, porta 55432 publicada **só** no IP do runner), TLS com CA sintética, `pg_hba` apenas `hostssl`; sem `secrets.*`; senhas/CA geradas e mascaradas; chaves da CA apagadas após assinar; identidade validada antes da primeira escrita; executa **somente** `npm run test:homolog:ephemeral`; diagnóstico só em falha (60 linhas mascaradas, sem dump, **sem artifacts**); `teardown` `if: always()` e falha se sobrar algo; `timeout-minutes: 25`; recusa repositório público; actions fixadas por SHA (as mesmas do `ci.yml`). `tests/ci-homolog-ephemeral-config.test.ts` (roda no job `backend`) trava todas essas propriedades.

## 11. Testes locais (nenhum toca PostgreSQL)
* `npm run typecheck`: apenas os 2 erros **antigos** de `tests/scripts/verify-fixtures-rotation.ts`.
* `npm run build`: aprovado.
* `npm run test:ci`: **52 arquivos aprovados, 1 ignorado (efêmero); 976 testes aprovados, 8 ignorados** (antes: 963).
* Novos: `rename-classification` (3), `ci-homolog-ephemeral-config` (10), ajustes em `homolog-provisioning` (SQL 03/04 hardenizados continuam read-only/sem DROP).
* Validação shell: `bash -n` nos 3 scripts — OK (também no teste, quando há bash). Validação YAML: **estrutural** (testes sobre o texto, sem tabs, chaves obrigatórias); não havia parser YAML disponível localmente e não instalei dependência — o GitHub fará a validação sintática final ao carregar o workflow (**limitação**).
* Varredura de segredos nos 62 caminhos do manifesto: só fixtures falsas (`URL-PASSWORD-SECRET`); nenhum valor real. Os 4 testes sensíveis não foram tocados nem listados.
* **NÃO EXECUTADOS:** suíte efêmera, SQL em psql, wrappers contra banco, Playwright, qualquer migration.

## 12. Manifesto de transferência
`manifest-3d52b-transfer.txt` — **62 caminhos** (substitui o `3d52a`; mantém a ordem e acrescenta `ops/homolog/ci/*`, workflow, 2 testes novos e os relatórios 3D.5.2-A/B). Comparação com o snapshot (HEAD `5ef3643`, árvore limpa): 52 arquivos novos e **10 alterados** — `package.json`, `config/database-profiles.json`, `src/app.ts`, `src/server.ts`, `src/config/env.ts`, `src/config/secrets.ts`, `src/lib/prisma.ts`, `scripts/prisma-run-policy.ts`, `scripts/prisma-run.ts`, `docs/admin-provisioning.md`. Nenhum dos 4 testes sensíveis consta; o snapshot mantém suas versões sanitizadas.

## 13. Limitações de PostgreSQL gerenciado — **BLOQUEIO POTENCIAL**
A estratégia exige `ALTER DATABASE … RENAME` e `ALTER ROLE … RENAME` de roles do projeto, além de `CREATE ROLE` com `COMMENT`. Em PG gerenciado o "admin" costuma não ser superusuário; no PG ≥ 16 `CREATEROLE` só alcança roles sobre as quais há `ADMIN OPTION`, e alguns provedores bloqueiam o rename de banco/role. Se for o caso do provedor escolhido, **a estratégia está bloqueada nele** (não se amplia privilégio de runtime). Saídas: cluster auto-gerenciado, rename feito pelo suporte do provedor, ou nova decisão. A viabilidade só se verifica no provedor real (fora do escopo; o ensaio efêmero usa superusuário do container e **não** prova portabilidade).

## 14. Riscos restantes
1. Estratégia não comprovada em PostgreSQL real (scripts SQL, `\gset/\if`, rename sem perda de ACL/owner/default ACL, leitura real do snapshot): o primeiro run **pode falhar**, e isso é o propósito.
2. Dúvida do `sslmode=verify-*` no Prisma (seção 9).
3. Marca de cluster copiável (seção 9); o gate reduz, não elimina, o risco de apontar para o cluster errado.
4. Portabilidade para PostgreSQL gerenciado (seção 13).
5. Possíveis falhas de infraestrutura do runner no primeiro disparo: obtenção do IP via `ip route`, `sudo chown` da chave TLS, instalação do `psql` (`apt`), `docker` + publish em IP específico; o script falha cedo e com mensagem, e o teardown sempre limpa.
6. O sync `EXPECTED_MIGRATIONS` ↔ lista do preflight de integração continua manual (testado por igualdade).
7. Sessões em memória / instância única (herdado).
8. Consultas de catálogo do snapshot (p.ex. `pg_get_functiondef`, `datcollate`) nunca rodaram; erro de SQL aparecerá no primeiro run.

## 15. Procedimento de publicação (após auditoria e autorização separadas)
1. Auditoria deste relatório pelo ChatGPT.
2. Copiar para o snapshot **somente** os caminhos de `manifest-3d52b-transfer.txt` (sem `git add .`), conferir `git diff`/`status` e rodar lá `npm run test:ci`, typecheck e build.
3. Commit pontual e push para `https://github.com/caliluneto/rustika-cardapio-digital` (autorização própria; sem force/tags; originais e snapshot não compartilham histórico).
4. O workflow só aparece/roda após o push; **não** será disparado automaticamente.

## 16. Configuração da primeira execução
Nenhum secret ou variável de repositório. Actions → `homolog-ephemeral` → *Run workflow* → marcar `run_homolog_ephemeral`. O workflow cria PostgreSQL, CA, senhas e `cluster_name` (`rustika-homolog-ephemeral-<run_id>`), roda a suíte e descarta tudo. Resultado esperado de sucesso: job verde, passo de teardown com "Ambiente efêmero descartado". Em falha: ler o diagnóstico mascarado e o log do Vitest (mensagens redigidas); nenhum artifact é publicado.

## 17. Critérios de sucesso e falha
**Sucesso** = todos os testes 0–12 verdes **e** cleanup sem sobras.
**Falha (qualquer um reprova, sem skip):** checksum histórico divergente no disco ou no banco; migration pendente, falhada ou inesperada; banco transitório com dados; rename deixando permissão diferente (matriz) ou schema diferente (snapshots) ou identidade inesperada; privilégio excessivo do runtime; identidade do servidor não validada (cluster_name, marca, dev/shadow, fase); TLS inativo ou CA errada aceita; bootstrap executável duas vezes, ou aceito com role/banco/cluster errado; 8ª migration que não aplica, reaplica ou aceita divergência; drift de ACL/roles após a 8ª; qualquer sobra de banco/role/container/certificado; configuração ausente com `REQUIRED=1`.

## 18. Estado dos repositórios
* **Original** (`Cardapio_Digital`, branch `master`, sem remote): alterações das etapas 3D.5.2, 3D.5.2-A e 3D.5.2-B **não commitadas**; migrations 6 e 7 seguem não rastreadas por etapas anteriores (inalteradas; checksums conferem). `refs/cline/*` e `refs/codex/*` intactos.
* **Snapshot** (`C:\Users\u1n3c\RustikaPublish\cardapio-digital-snapshot`): HEAD `5ef3643`, árvore limpa, **nada transferido**.
* **GitHub:** nada publicado; nenhum workflow disparado.
* **Bancos:** nenhum conectado, criado, renomeado ou alterado; PostgreSQL local, credenciais e `pg_hba.conf` intactos. Sem Playwright, sem `migrate resolve/db push/reset`, outros projetos intactos.
