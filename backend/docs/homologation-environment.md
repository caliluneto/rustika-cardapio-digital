# Ambiente de homologação

**Estado local: baseline de nove migrations, wrappers, scripts SQL, testes estáticos e documentação PREPARADOS. Esta preparação não
confirma o estado do Neon e não executou migration, SQL ou provisionamento remoto.** Todo passo marcado com 🔒 exige autorização explícita e específica.

## 1. Os três ambientes

| | Desenvolvimento | Testes | Homologação |
|---|---|---|---|
| Banco | `cardapio_digital_dev` (+ `cardapio_digital_shadow`) | `cardapio_digital_test` (local, autorizado) / efêmero no CI | **`cardapio_digital_homolog`** (nome exclusivo) |
| Perfis | `app-dev`, `migrate-dev` | `app-test`, `migrate-test` | `app-homolog`, `migrate-homolog`, `bootstrap-homolog` (+ transitório `migrate-homolog-replay`) |
| `NODE_ENV` | development | test (exige `app-test`) | **production** (exige `app-homolog`) |
| Host | loopback, porta 5432 (imposto) | loopback (imposto) | **nunca loopback**, FQDN/IP, TLS obrigatório |
| Segredos | pasta local padrão | pasta local padrão | **pasta própria** (`CARDAPIO_SECRETS_DIR` obrigatório) |
| Roles | `cardapio_migrator`, `cardapio_dev_app` | `cardapio_migrator`, `cardapio_test_app` | `cardapio_homolog_migrator`, `cardapio_homolog_app`, `cardapio_homolog_bootstrap` |

Nada é compartilhado: banco, roles, senhas, arquivos de segredo e **cluster** são distintos. Dev e Test não mudaram (testes de regressão cobrem os perfis locais).
Os nomes `cardapio_digital_dev`, `cardapio_digital_test` e `cardapio_digital_shadow` **não podem identificar o banco definitivo de homologação**: o código recusa (perfil, política Prisma, scripts SQL).

## 2. Por que as migrations históricas não rodam direto em `cardapio_digital_homolog`

As migrations 3 e 5–9 são imutáveis (SHA-256 registrado) e contêm guardas fixas: `current_database()` ∈ {`cardapio_digital_dev`, `cardapio_digital_test`};
a role de runtime derivada (`cardapio_test_app`/`cardapio_dev_app`) e a "outra" precisam **existir**; o executor e o dono do banco têm de ser `cardapio_migrator`; PostgreSQL ≥ 17.
A migration 2 revoga privilégios de `cardapio_test_app`, `cardapio_dev_app` (nomes literais). Executá-las em um banco com outro nome falha por desenho.
Não se altera nenhum arquivo SQL histórico, não se usa `migrate resolve`, `db push`, `migrate reset`, nem se marca migration como aplicada.

## 3. Estratégia adotada: replay original + renomeação (OID-preservante)

Num **cluster PostgreSQL dedicado e vazio** de homologação:

1. cria-se, de forma **transitória**, as roles legadas e um banco `cardapio_digital_test` (nome que as guardas aceitam), **apenas nesse cluster**;
2. o Prisma aplica as **nove migrations do baseline** (`migrate-homolog-replay`), registrando em `_prisma_migrations` os checksums reais; as migrations 8 e 9 precisam ocorrer aqui porque suas guardas recusam o banco final;
3. o administrador executa `ALTER DATABASE cardapio_digital_test RENAME TO cardapio_digital_homolog` e renomeia as roles (`cardapio_test_app`→`cardapio_homolog_app`, `cardapio_migrator`→`cardapio_homolog_migrator`, `cardapio_dev_app`→`cardapio_homolog_placeholder`).

Por que preserva o schema: owners, ACLs de tabela/coluna/schema/banco e privilégios padrão são armazenados por **OID**, não por nome; nenhuma migration grava nome de role/banco em objeto persistente
(função, view, trigger, política, comentário — provado por `tests/scripts/migration-rename-safety.test.ts`). Só senhas MD5 são limpas pelo rename → redefinem-se com `\password`.

Isolamento sem depender do hostname: antes de qualquer migration, `prisma-run` (perfis `migrate-homolog*`) e o `server.ts` (produção) verificam o **servidor**:
TLS realmente ativo (`pg_stat_ssl`), PostgreSQL ≥ 17, **marca do cluster** (comentário da role `rustika_homolog_marker` = `EXPECTED_CLUSTER_ID` do arquivo de segredos), ausência de `cardapio_digital_dev`/`shadow`,
coerência da fase (replay: existe `cardapio_digital_test`, não existe `cardapio_digital_homolog`; final: o contrário e sem roles legadas). Um host que resolva para o PostgreSQL de desenvolvimento é recusado.

### 3.1 Comparação resumida
| Critério | A) baseline específico | B) separar política de ambiente do SQL histórico | **C) replay + renomeação (adotada)** |
|---|---|---|---|
| Migrations históricas | substituídas (checksums divergentes) | reescritas ou ignoradas | **intactas** |
| `_prisma_migrations` | exigiria `resolve`/marcação manual sem prova | idem | **gerada pelo Prisma com checksums reais** |
| Prova de equivalência | auditoria manual do schema | auditoria do mecanismo novo | **automática** (snapshots A×B, suíte efêmera) |
| Migrations futuras | caminho próprio, risco de drift | novo mecanismo a manter | **mesmo caminho, SQL neutro de ambiente** |
| Risco | alto (drift silencioso) | médio/alto (altera o que foi publicado) | baixo; depende de cluster dedicado e janela de renomeação |
| Limite | — | — | **só provado em PostgreSQL real (suíte efêmera preparada)** |

## 4. Perfis, roles e finalidades

| Perfil | Finalidade | Role | Banco | Privilégios |
|---|---|---|---|---|
| `app-homolog` | runtime da API | `cardapio_homolog_app` | `cardapio_digital_homolog` | os definidos pelas migrations 4–9; **sem** INSERT em `admins` |
| `migrate-homolog` | `prisma migrate status/deploy` | `cardapio_homolog_migrator` (dono) | `cardapio_digital_homolog` | DDL; sem atributos elevados |
| `bootstrap-homolog` | primeiro administrador | `cardapio_homolog_bootstrap` | `cardapio_digital_homolog` | `SELECT, INSERT` em `admins`, `SELECT` em `_prisma_migrations`; sem UPDATE/DELETE/TRUNCATE; **sem login** fora da janela |
| `migrate-homolog-replay` (transitório) | replay das nove migrations do baseline | `cardapio_migrator` | `cardapio_digital_test` (do cluster de homologação) | DDL; deixa de existir após o rename |
| (placeholder) | exigência das guardas | `cardapio_homolog_placeholder` | — | `NOLOGIN`, sem privilégios, sem membros |
| (marca) | identidade do cluster | `rustika_homolog_marker` | — | `NOLOGIN`; só carrega o comentário `rustika-homolog-cluster:<uuid>` |

Validações antes de qualquer conexão: ambiente, perfil, finalidade, host (sem loopback/localhost/`*.localhost`/0.0.0.0/::1/169.254.*/rótulo único), `EXPECTED_DATABASE_HOST` = host da URL,
`EXPECTED_CLUSTER_ID` (UUID), banco e usuário exatos por perfil, TLS (`sslmode` ∈ require/verify-ca/verify-full, `sslaccept` somente `strict`), lista permitida de parâmetros da URL,
pasta de segredos própria, permissão 600 (POSIX), confirmação explícita para escrita (`CARDAPIO_MIGRATE_HOMOLOG_REPLAY_CONFIRMATION=REPLAY_HISTORICAL_MIGRATIONS_RUSTIKA_HOMOLOG`
e `CARDAPIO_MIGRATE_HOMOLOG_CONFIRMATION=APPLY_RUSTIKA_HOMOLOG_MIGRATIONS`; uma não vale para a outra nem para Test).

## 5. Segredos 🔒
* Arquivos reais em pasta **fora do repositório e do OneDrive**: `CARDAPIO_SECRETS_DIR=<pasta homolog>` (`app-homolog.env`, `migrate-homolog.env`, `bootstrap-homolog.env`, `migrate-homolog-replay.env`, chmod 600). Exemplos: `config/homolog-examples/*.env.example`.
* Senha única por role, ≥ 24 caracteres (o replay pode repetir a do migrator definitivo — é a mesma role), URL-encoded; nenhuma senha em scripts, argumentos, histórico ou logs.
* Rotação: nova senha → `\password` interativo → atualizar arquivo → reiniciar a API → `/api/ready` → revogar a antiga. Após o bootstrap e o rename, **apague** `bootstrap-homolog.env` e `migrate-homolog-replay.env`.

## 6. Criação do banco novo (reproduzível) 🔒
Pré-condições: cluster PostgreSQL ≥ 17 **dedicado e vazio**, TLS, administrador do cluster, `psql`, segredos preparados.

1. `CARDAPIO_SECRETS_DIR=… npm run homolog:preflight` (offline): 4 perfis válidos, mesmo host e `EXPECTED_CLUSTER_ID`, senhas distintas, migrations íntegras, 9 scripts presentes.
2. `01-cluster-roles.sql` (admin): recusa se houver qualquer banco `cardapio_digital_*` ou role do projeto; cria roles legadas transitórias, `cardapio_homolog_bootstrap` e a marca; **imprime o UUID** → `EXPECTED_CLUSTER_ID`. Defina senhas com `\password`.
3. `02-create-replay-database.sql` (admin): cria `cardapio_digital_test` (dono `cardapio_migrator`); recusa se algum banco do projeto existir.
4. `npm run homolog:replay:status`, depois `CARDAPIO_MIGRATE_HOMOLOG_REPLAY_CONFIRMATION=REPLAY_HISTORICAL_MIGRATIONS_RUSTIKA_HOMOLOG npm run homolog:replay:deploy`.
5. `03-verify-replay.sql` (somente leitura, como `cardapio_migrator`): exige exatamente as nove migrations, checksums aprovados e grants de CRUD, inclusive INSERT em `products.id` e `products.updated_at`.
6. Opcional recomendado: `npm run schema:fingerprint -- --profile … --out replay.json` (snapshot A).
7. Pelo interlock operacional, manter a sessão verificadora aberta, congelar o banco transitório com `ALLOW_CONNECTIONS false` em uma transação administrativa separada, reexecutar o gate equivalente ao `03` nessa sessão preexistente, encerrá-la e confirmar zero conexões. Só então executar `04-finalize-rename.sql` (admin, banco `postgres`): ele recusa `datallowconn=true`, destino/dev/shadow, roles finais e qualquer conexão; ao concluir, reativa conexões no nome final. Redefina as senhas (`\password cardapio_homolog_migrator`, `cardapio_homolog_app`).
8. `npm run homolog:migrate:status` (perfil final; exige a identidade FINAL e recusa histórico que não tenha chegado à 9ª migration antes do rename) e snapshot B; `npm run schema:compare -- replay.json final.json` deve retornar 0 (equivalência).
9. `05-post-migration-grants.sql` (migrator), `06-bootstrap-window-open.sql` (admin), bootstrap (seção 7), `07-bootstrap-window-close.sql`, `08-bootstrap-revoke.sql` (migrator), `09-verify-acl.sql` (somente leitura).
10. `GET /api/ready` = 200; login do administrador por HTTPS.

**Checklist obrigatório antes do rename:** identidade Neon/projeto/cluster transitória aprovada; diretório sem migration desconhecida; nove checksums do disco aprovados; `_prisma_migrations` com exatamente nove linhas concluídas e não revertidas; `03-verify-replay.sql` aprovado; grants de `products` limitados por coluna, com `id`/`updated_at` em INSERT e sem INSERT/UPDATE de tabela; nenhum dado real; banco congelado (`datallowconn=false`) e zero conexão ativa. Qualquer divergência interrompe o procedimento.

**Checklist após o rename:** identidade final aprovada; nenhuma role/banco legado; histórico ainda idêntico; snapshots A×B equivalentes; `09-verify-acl.sql` aprovado; runtime sem atributos administrativos, sem acesso a `_prisma_migrations` e sem INSERT em `admins`. Não iniciar bootstrap ou aplicação se qualquer item falhar.

**Falhas e recuperação.** Scripts 01–03/05–09 são transacionais ou abortam antes de alterar; nenhum contém `DROP`. Falha no replay: o Prisma registra a migration como falha — **não use `migrate resolve`**;
o cluster é dedicado e descartável: o administrador cria outro cluster/banco vazio (remoção manual, autorizada, fora destes scripts). O freeze e o rename não são atômicos entre conexões/bancos: falha depois do freeze mantém o transitório sem novas conexões para investigação; não reative nem compense automaticamente. Falha dentro da transação do rename reverte os renames, mas não o freeze já confirmado.
Rename concluído mas verificação falhou: o ambiente ainda não tem dados; descartar e recriar. Falha no bootstrap: nada é confirmado (Serializable); feche a janela (`07`) e reexecute.

## 7. Bootstrap do primeiro administrador 🔒
```
CARDAPIO_SECRETS_DIR=… npm run homolog:bootstrap-admin -- --profile bootstrap-homolog --name "Nome" --email pessoa@dominio          # dry-run
CARDAPIO_BOOTSTRAP_CONFIRMATION=CREATE_FIRST_ADMIN_RUSTIKA_HOMOLOG CARDAPIO_SECRETS_DIR=… npm run homolog:bootstrap-admin -- --profile bootstrap-homolog --name "Nome" --email pessoa@dominio --execute
```
Senha digitada duas vezes, sem eco, só em TTY; argumentos com aparência de segredo são recusados. Antes de escrever: **identidade do servidor** (TLS, marca do cluster, sem Dev/Shadow), banco e role exatos,
role sem atributos elevados e sem UPDATE/DELETE/TRUNCATE em `admins`, PostgreSQL ≥ 17, nove migrations com checksum esperado, nenhum administrador. Somente o primeiro; inserção `Serializable`.

## 8. Migrations futuras (a 10ª em diante) — Dev, Test e Homologação

* **Regra**: nunca alterar as nove migrations do baseline. A lista `EXPECTED_MIGRATIONS` (`scripts/bootstrap/expectedMigrations.ts` e `tests/integration-db/support/preflight.ts`) é **fail-closed**: uma migration nova no disco é "desconhecida" e é recusada pelos wrappers até a lista (nome + SHA-256) ser atualizada em revisão, nos dois arquivos (um teste exige igualdade entre eles e com o disco).
* **SQL neutro de ambiente**: partir de `docs/templates/future-migration-environment-guard.sql` (guarda por `current_database()` cobrindo Dev/Test/Homolog; executor ∈ {`cardapio_migrator`, `cardapio_homolog_migrator`}; roles resolvidas por `format('%I', …)`). `lintFutureMigration` (`scripts/bootstrap/futureMigrationPolicy.ts`) reprova guardas só-Dev/Test, roles literais, `GRANT/REVOKE` sem guarda, `TRUNCATE` e DDL de banco/role.
* **Dev**: pelo fluxo de migração já autorizado para o perfil `migrate-dev` (banco `cardapio_digital_dev`, shadow `cardapio_digital_shadow`), sem mudança. **Test**: `npm run db:migrate:status:test` / `db:migrate:deploy:test` (perfil `migrate-test`), sem mudança. **Homologação**: `npm run homolog:migrate:status`, revisar, depois `CARDAPIO_MIGRATE_HOMOLOG_CONFIRMATION=APPLY_RUSTIKA_HOMOLOG_MIGRATIONS npm run homolog:migrate:deploy` 🔒 — o wrapper confere a integridade do diretório e a identidade do servidor antes de conectar.
* Ordem: Dev → Test (ou CI efêmero) → comparar `schema:fingerprint` → Homologação. A suíte efêmera demonstra a aplicação de uma 10ª migration sintética com a role definitiva.
* Migrations futuras, neutras de ambiente, **não** passam pelo replay: para recriar a homologação do zero, o replay aplica o baseline fixo de nove; a 10ª e seguintes são aplicadas depois pelo `homolog:migrate:deploy`, já no banco final. O wrapper final aceita migrations futuras pendentes, mas bloqueia se o prefixo de replay até a 9ª não estiver íntegro.

## 9. Controle de drift
* `npm run schema:fingerprint -- --profile migrate-dev|migrate-test|migrate-homolog --out arquivo.json`: leitura somente de catálogo (migrations com checksum, tabelas, colunas/tipos/defaults, constraints incl. FKs, índices, enums, sequences, owners, ACLs de tabela/coluna/schema/banco, privilégios padrão), roles trocadas por papéis lógicos (`runtime`, `migrator`, `placeholder`, `bootstrap`), `sha256` determinístico.
* `npm run schema:compare -- a.json b.json` (offline): exit 0 idêntico, 1 drift listado por seção, 2 uso inválido. Role desconhecida aparece como `?nome`.
* **Nunca corrige automaticamente.** A correção de drift é uma nova migration revisada e aplicada nos três ambientes, ou, se o desvio foi manual, recriação do ambiente descartável. Não há `db push`/`reset`/`resolve`.

## 10. Autenticação, instância única e prontidão
Preservados: login, hash scrypt, cookie `rustika_admin`, CSRF/Origin, rate limit. Sessões e limitadores em memória: **uma única instância** em homologação.
`GET /api/health` não consulta o banco; `GET /api/ready` faz `SELECT 1` + sonda de schema (timeout 2 s, cache 5 s, 200/503 genérico). Em `NODE_ENV=production` o `server.ts` valida `CORS_ORIGIN` e a **identidade do servidor** antes de `listen`.

## 11. Ponto de recuperação obrigatório para E2 🔒
As migrations reais continuam **bloqueadas** até existir um ponto de recuperação criado e restaurado com sucesso. Opções aceitáveis, em ordem de preferência: (1) branch/snapshot Neon imediatamente anterior à migration, retido e identificado fora do repositório; ou (2) `pg_dump -Fc` privado, cifrado em repouso, com SHA-256 e manifesto de versões. Não criar branch, snapshot ou dump real sem autorização específica.

O gate de E2 exige: identidade de projeto/branch/endpoint confirmada; horário e estado 7/9 registrados; ausência de dados comerciais/pessoais no material de teste; hash conferido após transferência; credenciais fora do artefato; e restauração em branch/banco **descartável**, nunca sobre a origem. A restauração deve comprovar abertura do dump, contagem/estrutura, checksums 7/9, owners/ACLs e uma comparação por `schema:fingerprint`; só então o ponto é “validado”. Criar snapshot sem ensaio de restore é apenas “criado”, não “comprovado”.

Critérios de parada: falha de hash, restore, identidade, histórico, ACL, espaço/retenção ou RPO/RTO não aceitos; presença de dados inesperados; ou impossibilidade de apagar com segurança o destino descartável. Riscos restantes: snapshot logicamente consistente mas no projeto errado, retenção insuficiente, dump sem objetos globais/roles e credencial indisponível no incidente. Rollback de código continua sendo redeploy anterior; migrations não possuem `down`. Ver também `docs/restore-backup.md`.

## 12. Testes
* Sem banco (CI padrão): perfis e identidade, política Prisma (replay/final), integridade e checksums das nove migrations, **segurança da renomeação** (análise estática das migrations), SQL estático (9 scripts), identidade do servidor, fingerprint/diff/aliases de roles, lint de migrations futuras, pré-voo, bootstrap, `/api/ready`.
* Preparado, **não executado**: `npm run test:homolog:ephemeral` (`tests/homolog-ephemeral/provisioning.ephemeral.ts`) — fluxo 01→09 + equivalência de schema A×B + 10ª migration sintética + drift; exige `RUSTIKA_HOMOLOG_EPHEMERAL_URL` e `RUSTIKA_HOMOLOG_EPHEMERAL_CONFIRM=RUN_ON_EPHEMERAL_POSTGRES`; aborta se houver qualquer banco/role `cardapio_*`/`rustika_*`.

## 12.1 Ensaio efêmero integral — workflow manual `homolog-ephemeral`
Arquivo: `.github/workflows/homolog-ephemeral.yml` (somente `workflow_dispatch`, input `run_homolog_ephemeral` = false por padrão, repositório privado, 25 min, sem secrets, sem artifacts, PostgreSQL **próprio**, não o do job `e2e`).
`ops/homolog/ci/start-ephemeral-postgres.sh` gera CA sintética (e uma CA "errada" para o teste negativo), certificado do servidor com SAN = IP do runner, `pg_hba` só `hostssl` e publica a porta **apenas** no IP do runner (não-loopback, como exigem os perfis de homologação).
`diagnostics.sh` (só em falha: 60 linhas de log mascaradas, sem dump) e `teardown.sh` (sempre: container, volume, certificados e senhas; falha se sobrar algo).
A suíte (`tests/homolog-ephemeral/provisioning.ephemeral.ts`) valida a identidade do servidor **antes da primeira escrita** (`cluster_name` esperado, TLS real em `pg_stat_ssl`, PG ≥ 17, somente o banco `postgres`, nenhuma role do projeto), usa os **wrappers reais** (`prisma-run` para replay e final) e cobre: recusas sem confirmação / com marca errada, nove migrations do baseline, histórico exato em `_prisma_migrations`, grants de CRUD de produto, ownership, matriz de privilégios por role antes×depois do rename (tabela e coluna), CRUD Prisma de produto com dados exclusivamente fictícios e limpeza no final, snapshots A×B com renomeações classificadas (`classifyRenames`), recusa do rename com sessão ativa e pela role legada, adulteração de checksum e dados inesperados reprovando, marca alterada e banco `cardapio_digital_dev` presente reprovando, bootstrap (recusa de role/banco/cluster errados, um único administrador, hash verificável, senha ausente das saídas, runtime recusado), login HTTP, 10ª migration sintética em **cópia temporária** do backend (desconhecida recusada → lista revisada simulada na cópia → aplicada uma vez → reexecução sem reaplicação → adulteração recusada → drift detectado) e cleanup verificado. Com `RUSTIKA_HOMOLOG_EPHEMERAL_REQUIRED=1` (CI), configuração ausente **falha**; nenhum teste é convertido em skip.
Primeira execução (após auditoria e autorização): Actions → `homolog-ephemeral` → marcar `run_homolog_ephemeral`. Nada além disso é necessário; não há secrets a configurar.

## 12.2 Identidade do cluster e TLS — o que a marca prova e o que não prova
* A marca (`rustika_homolog_marker`, `NOLOGIN`, comentário `rustika-homolog-cluster:<uuid>`) é criada pelo script 01 por quem administra o cluster (superusuário ou `CREATEROLE` com admin sobre a role) e só ele a altera. O UUID é **impresso uma vez** pelo 01 e copiado pelo operador, fora de banda, para `EXPECTED_CLUSTER_ID`; o código nunca o obtém do servidor que está sendo verificado.
* Ela é uma verificação de **consistência** (endpoint certo + cluster certo + cluster não-Dev), não de autenticação: quem controla um servidor pode copiar o comentário. A autenticação de host vem do **TLS com validação da cadeia e do nome** (`sslaccept=strict`; CA privada via `sslcert`) e das credenciais próprias. Marca ou variável de ambiente isoladas não bastam.
* O gate usa `pg_stat_ssl` (a sessão está realmente cifrada). **Ponto a confirmar na primeira execução:** o Prisma/quaint reconhece `sslmode=require`; valores `verify-ca/verify-full` aceitos pelo parser do projeto podem não ser interpretados pelo motor (rebaixando para `prefer`). Por isso o ensaio usa `require` + `sslaccept=strict` + `sslcert`, e o teste 0 prova que uma CA errada é recusada.
* O ensaio com CA sintética testa o **mecanismo**; não substitui a validação do certificado e da cadeia do provedor real.

## 12.3 Limitações de PostgreSQL gerenciado (bloqueios de portabilidade)
O procedimento exige, no cluster: `CREATE ROLE` e `ALTER ROLE … RENAME` das roles do projeto; `ALTER DATABASE … RENAME` (dono do banco com `CREATEDB` ou superusuário); criar roles com `COMMENT ON ROLE`; roles sem `SUPERUSER`. Provedores gerenciados costumam oferecer um "admin" restrito (não superusuário): `CREATEROLE` no PG ≥ 16 só permite alterar/renomear roles sobre as quais o criador tem `ADMIN OPTION`, e alguns bloqueiam `RENAME` de banco ou de role. Se o admin do provedor não puder renomear, **esta estratégia é bloqueada** nesse provedor (não se amplia privilégio de runtime para compensar); alternativas: cluster auto-gerenciado, ou pedir ao provedor o rename, ou nova decisão de arquitetura. A viabilidade só se confirma na primeira execução no provedor escolhido (fora do escopo desta etapa).

## 13. Limites conhecidos
* Scripts SQL, comportamento de `\gset/\if` do `psql`, interação de `GRANT/REVOKE` com os guardas, rename de roles/banco e a equivalência do schema **só serão provados em PostgreSQL real** (suíte efêmera). Até lá o desenho está comprovado apenas por análise estática e testes sem banco.
* A garantia de isolamento vale para **cluster dedicado**; se o provedor impedir `ALTER DATABASE … RENAME` ou rename de roles, a estratégia precisa de reavaliação.
* O cluster de homologação contém, por breve período, um banco chamado `cardapio_digital_test` (transitório; verificado e removido da identidade final).
* Sessões em memória e limitadores por processo (seção 10). Cadeia TLS: `sslmode=verify-full` recomendado; validar na primeira conexão autorizada.
