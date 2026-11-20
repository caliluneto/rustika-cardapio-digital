# RELATORIO DA ENTREGA 3D.3.7-F

Finalização da auditoria e preparação da execução em PostgreSQL Test

Data: 03/11/2026
Executor: Claude Code
Escopo: leitura e documentação. Nenhuma escrita em PostgreSQL, nenhuma migration, nenhum Seed, nenhuma alteração de ACL, nenhum commit.

Estrutura: a Parte I (seções 1 a 15) é a entrega 3D.3.7-F. A Parte II (seções 16 a 27) é a 3D.3.7-G e foi acrescentada em 03/11/2026, 21h30. Onde a Parte II corrige a Parte I, a correção está marcada na própria Parte I (R3, 8.1 e 11) e explicada na seção 21. A Parte III (seções 28 a 39) é a 3D.3.7-H, executada nativamente no Windows; ela fecha as pendências das seções 16 e 17 e corrige a afirmação "`core.autocrlf` indefinido" (R4 e seção 2 da Parte I), ver seção 35.

Legenda de classificação usada em todo o relatório:

- [EXEC] confirmado por execução nesta sessão
- [INSP] confirmado por inspeção de código ou de arquivos
- [HERD] herdado de relatório anterior, não reconfirmado
- [NV] ainda não verificado

---

## 1. Resumo executivo

1. A 3D.3.7 não tinha relatório no disco. Este arquivo é o relatório dela.
2. O ambiente desta sessão tem uma limitação que muda o alcance da entrega: o shell roda numa VM Linux (Node v22.23.4) com a pasta do projeto montada. Nela não existem `psql`, `pg_dump` nem `pg_restore`, o PostgreSQL local do Windows não é alcançável, e o `node_modules` do projeto foi instalado para Windows (o Vitest não carrega por falta do binário `rolldown` para Linux). Consequências:
   - A Etapa 3 (consultas de leitura ao banco Test) **não foi executada**. Deixei o roteiro pronto na seção 4 para rodar no PowerShell.
   - O Vitest **não foi executado**. O 440/440 continua [HERD].
   - O typecheck foi executado e passou [EXEC].
3. As quatro migrations foram lidas por inteiro e comparadas com o `schema.prisma`, com os services e com o `prisma-run-policy.ts`. O conjunto é coerente com o código (seções 5 e 7). Os riscos reais estão listados na seção 6.
4. O maior risco do projeto hoje não é o banco, é o Git: existe um único commit (baseline) e 116 entradas pendentes (13 modificadas, 103 não rastreadas). Quase todo o backend de acesso e pedidos, e duas das quatro migrations, não estão versionados.
5. Parecer: documentação e plano concluídos. A aplicação das migrations **não está liberada**. Os bloqueios são: disponibilidade de `pg_dump`/`pg_restore` por confirmar no Windows (ver seção 21), auditoria de leitura do banco Test ainda por rodar, versão do PostgreSQL por confirmar e autorização explícita pendente.

---

## 2. Estado real do repositório

Raiz: `C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital`

| Item | Resultado | Classe |
|---|---|---|
| CLAUDE.md / AGENTS.md (raiz e backend) | Não existem | [INSP] |
| Branch | `main` | [EXEC] |
| Último commit | `1e80bdb chore: baseline inicial do projeto RUSTIKA` (único) | [EXEC] |
| `git status --short` | 116 linhas: 13 ` M` e 103 `??` | [EXEC] |
| `RELATORIO-ENTREGA-3D.3.7.md` antes desta sessão | Não existia | [EXEC] |
| Relatórios 3D.2.11 a 3D.3.6 na raiz | Presentes (todos não rastreados) | [INSP] |
| `.env` do backend | Existe (163 bytes), ignorado pelo Git. **Não foi lido.** | [INSP] |
| `backend/dist` | Existe, ignorado. `dist/server.js` com data de 03/11 21:10 | [EXEC] |

Modificados em relação ao baseline (13): `backend/src/app.ts`, `backend/src/domain/rules.ts`, `backend/src/middleware/errorHandler.ts`, `backend/tests/domain/rules.test.ts`, `backend/tests/health.test.ts` e oito arquivos do frontend (`package.json`, `App.tsx`, `Catalog.tsx`, `ConnectionIndicator.tsx`, `ProductCard.tsx`, `ProductModal.tsx`, `services/api.ts`, `types/catalog.ts`).

Não rastreados e relevantes (103 no total):

- Migrations: `20261031000000_rf004_fix_permissions/` e `20261102000000_update_products_source_identity_constraint/`. A inicial e a `20261027000000_rf004_comandas_catalogo_pedidos` estão no commit baseline e sem modificação.
- Backend: `src/routes/access.routes.ts`, `catalog.routes.ts`, `order.routes.ts`, `src/security/`, `src/services/`, `src/mappers/`, `src/domain/orderInput.ts`, `categoryPublication.ts`, todos os testes novos, `docs/*.md`, e todos os scripts operacionais.
- Frontend: `AppWrapper.tsx`, `CatalogStatus.tsx`, `ComandaRedeem.tsx`, `hooks/`, `pages/`, `catalogAdapter/Source/Store.ts` e os testes `.mjs`.
- Resíduos soltos na raiz: `$testRunner` (7 bytes), `ausentes.json` e `sem_correspondencia.json` (vazios), `candidatos.json` (12 bytes), `backend/changes.diff` (vazio), `backend/vitest-report.json` (ver seção 3). Nada foi removido.

Arquivos mais novos que o relatório 3D.3.6 (03/11 20:39): `tests/scripts/executor-seed-real.test.ts` (21:05), `tests/scripts/seed-dev.test.ts` (21:06), `scripts/executor-seed-real.ts`, `scripts/analyze-excel.ts`, `scripts/analyze-excel2.ts`, `scripts/validate-api.ts`. Nenhum arquivo de `src/` é mais novo que o 3D.3.6. [EXEC]

Baseline desta sessão: lista de `git status` e SHA-256 de 190 arquivos (rastreados mais não rastreados não ignorados) gravados fora do repositório antes de qualquer outra ação. Ao final, `git status --short` continuou com as mesmas 116 linhas. [EXEC]

---

## 3. Resultados confirmados de testes

| Verificação | Resultado | Classe |
|---|---|---|
| Typecheck (`tsc --noEmit -p tsconfig.json`, cobre `src`, `tests`, `scripts`) | Exit code 0, zero linhas de saída, duas execuções (~32 s cada), Node 22 / Linux | [EXEC] |
| Build | `dist/server.js` gerado em 03/11 21:10, depois da última edição de teste (21:06). Não rodei o build de novo para não regravar `dist`. O artefato sugere build aprovado, não prova | [HERD] com indício [INSP] |
| Suíte Vitest 440/440, 20 arquivos | 20 arquivos de teste existem. A contagem 440 não é verificável sem executar (há 273 chamadas literais de `it(`; o resto vem de testes parametrizados) | [HERD] |
| Tentativa de rodar `tests/domain/rules.test.ts` | Falhou antes de iniciar: binário nativo do `rolldown` ausente para Linux. Falha do ambiente, não do código | [EXEC] |
| 169/169 testes direcionados | Não reexecutado | [HERD] |
| Isolamento Test/Dev 9/9 | Não reexecutado. Há `tests/scripts/validate-databases.test.ts` (16 testes) e `scripts/validate-databases.ts` | [HERD] |
| `prisma validate` | Não executado (engine do Prisma é binário Windows) | [HERD] |
| `backend/vitest-report.json` (02/11 21:04) | Registra 4 suítes falhas por `NODE_ENV=test exige exclusivamente DB_PROFILE=app-test`. É resíduo antigo, não prova do estado atual | [INSP] |

Para reconfirmar no Windows (somente testes com mocks, sem banco):

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
$env:NODE_ENV = 'test'
$env:DB_PROFILE = 'app-test'
npm test
npm run typecheck
npm run build
npm run db:validate
Remove-Item Env:NODE_ENV, Env:DB_PROFILE
```

---

## 4. Identidade e isolamento do banco Test

### 4.1 O que o código garante [INSP]

- `backend/config/database-profiles.json`:
  - `app-test`: banco `cardapio_digital_test`, usuário `cardapio_test_app`, finalidade runtime
  - `migrate-test`: banco `cardapio_digital_test`, usuário `cardapio_migrator`, finalidade migration, shadow `cardapio_digital_shadow`
  - `app-dev` e `migrate-dev` apontam para `cardapio_digital_dev` com `cardapio_dev_app` e `cardapio_migrator`
- `src/config/env.ts`: com `NODE_ENV=test`, qualquer `DB_PROFILE` diferente de `app-test` derruba a inicialização.
- `scripts/prisma-run-policy.ts`:
  - `migrate` só aceita o perfil `migrate-test` e só o banco `cardapio_digital_test`
  - subcomandos permitidos: `status` e `deploy`
  - bloqueados: `dev`, `reset`, `resolve`, `db`, `push`, `seed`
  - `deploy` exige a variável `CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION=APPLY_CARDAPIO_DIGITAL_TEST` no ambiente da execução
- Segredos são resolvidos fora do repositório (`CARDAPIO_SECRETS_DIR` ou `%LOCALAPPDATA%`). Não li esses arquivos.

### 4.2 O que não foi verificado [NV]

Tudo o que a Etapa 3 pedia sobre o banco real: existência e versão do `cardapio_digital_test`, roles, estado de `_prisma_migrations`, tabelas, contagens, migrations falhas, isolamento de Dev e Shadow. Estado herdado [HERD]: só a migration inicial aplicada e tabelas vazias.

### 4.3 Roteiro de auditoria de leitura (rodar no PowerShell, na máquina do Windows)

Arquivo existente e somente leitura: `backend/docs/sql/inspect-test.sql` (identidade, roles, privilégios de banco e schema, donos de tabela, grants, default ACLs, sessões ativas). Rodar conectado como `cardapio_migrator`, sem senha na linha de comando:

```powershell
$env:PGPASSWORD = '<lida de fonte local>'
psql -h 127.0.0.1 -p 5432 -U cardapio_migrator -d cardapio_digital_test `
  -f backend/docs/sql/inspect-test.sql
Remove-Item Env:PGPASSWORD
```

Consultas complementares propostas (todas `SELECT`, nenhuma altera algo):

```sql
SELECT current_database(), current_user, session_user,
       current_setting('server_version') AS versao,
       current_setting('server_version_num') AS versao_num;

SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count
FROM _prisma_migrations ORDER BY started_at;

SELECT 'admins' AS tabela, count(*) FROM admins
UNION ALL SELECT 'categories', count(*) FROM categories
UNION ALL SELECT 'products', count(*) FROM products
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'order_items', count(*) FROM order_items
UNION ALL SELECT 'order_status_history', count(*) FROM order_status_history;

SELECT t.typname, e.enumlabel
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
ORDER BY t.typname, e.enumsortorder;

SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls
FROM pg_roles
WHERE rolname IN ('cardapio_dev_app','cardapio_test_app','cardapio_migrator');

SELECT r.rolname AS membro, g.rolname AS grupo
FROM pg_auth_members m
JOIN pg_roles r ON r.oid = m.member
JOIN pg_roles g ON g.oid = m.roleid
WHERE r.rolname IN ('cardapio_dev_app','cardapio_test_app','cardapio_migrator');
```

Leitura de status do Prisma, também sem escrita (perfil `migrate-test`, não exige a variável de confirmação):

```powershell
cd backend
npm run db:migrate:status:test
```

Resultado esperado: 1 migration aplicada e 3 pendentes, nenhuma falha, nenhuma divergência.

---

## 5. Migrations pendentes

Ordem por nome (confere com a ordem cronológica): `20261027000000`, `20261031000000`, `20261102000000`. `migration_lock.toml` com provider `postgresql`. [INSP]

SHA-256 dos arquivos, como estão no disco (o Prisma grava em `_prisma_migrations.checksum` o SHA-256 do conteúdo do arquivo):

| Migration | SHA-256 | Fim de linha | Versionada |
|---|---|---|---|
| `20261023000000_initial_schema` (aplicada em Test, [HERD]) | `1a9cd08b9d49fa9f70eabcceaa4a696f5aee07555f6a88562ec789340f0d3983` | LF | sim |
| `20261027000000_rf004_comandas_catalogo_pedidos` | `05f583e854a87b77612c2f7d10a0a178ef45ea099d3237808b5bf0bd7c698122` | LF | sim |
| `20261031000000_rf004_fix_permissions` | `960766a8fb1576e6094622f112e1a3a9cd7455f56907a3405a8fbb183959e10b` | **CRLF** | não |
| `20261102000000_update_products_source_identity_constraint` | `885b8de5dcc0cf5e7618d574ba5c013ae8b60c9b983260706c5819422564454f` | **CRLF** | não |

### 5.1 `20261027000000_rf004_comandas_catalogo_pedidos` (8641 bytes) [INSP]

- Controle transacional: `BEGIN` ... `COMMIT` explícitos, com `LOCK TABLE orders IN ACCESS EXCLUSIVE MODE`.
- Trava de segurança: levanta exceção se `orders` tiver qualquer linha. Isso é necessário porque adiciona `request_digest`, `comanda_id` e `session_id` como `NOT NULL` sem valor padrão.
- Cria: enums `product_availability` e `comanda_status`; tabelas `comandas`, `comanda_invitations`, `comanda_sessions`; colunas novas em `categories`, `products`, `orders`, `order_items`; CHECKs; 10 índices únicos ou comuns; 6 chaves estrangeiras (todas `RESTRICT`).
- Remove `NOT NULL` de `orders.tracking_token_hash`, `customer_name`, `table_or_reference`.
- Acrescenta o valor `CANCELLED` ao enum `order_status` (último comando antes do `COMMIT`).
- Privilégios: `REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN` em `orders`, `order_items`, `order_status_history` para `cardapio_test_app`, `cardapio_dev_app` e `PUBLIC`; `REVOKE ALL` nas três tabelas novas e em `_prisma_migrations`.
- Operações destrutivas: nenhuma (`DROP` ausente). Os `DROP NOT NULL` só relaxam regra.
- Compatibilidade com `schema.prisma`: tabelas, colunas, enums, índices únicos compostos (`id+comanda_id`, `invitation_id+comanda_id`), índices comuns e comportamento `RESTRICT` das chaves batem com o modelo. Os CHECKs não aparecem no schema (o arquivo registra isso em comentário), e o Prisma não os compara.

### 5.2 `20261031000000_rf004_fix_permissions` (1624 bytes) [INSP]

- `BEGIN` ... `COMMIT`, um bloco `DO` que escolhe a role pelo banco atual. Em banco que não seja `cardapio_digital_dev` ou `cardapio_digital_test` ela falha de propósito.
- Concede a `cardapio_test_app`: `USAGE` no schema `public`; `SELECT` em `admins`, `categories`, `products`; `SELECT, INSERT` em `orders`, `order_items`, `order_status_history`, `comanda_sessions`; `SELECT, INSERT, UPDATE` em `comandas` e `comanda_invitations`; `USAGE, SELECT` na sequência `orders_order_number_seq`.
- Nenhuma operação destrutiva.
- Cruzamento com o que o código realmente faz (`comandaAccess.service.ts`, `order.service.ts`, `adminAuth.service.ts`, `catalog.service.ts`): leitura de admin; upsert de comanda; create e `updateMany` de convite; create e leitura de sessão; create de pedido com itens e histórico; leitura de categorias e produtos. Todas cobertas, sem concessão sobrando. [INSP]
- Contradição documental: o comentário da migration anterior diz "não habilitar emissão de convites, sessões ou comandas nesta onda", e esta migration habilita. É intencional (corrige a anterior), mas `docs/rf004-onda-2.3c2-migration-offline.md` e `docs/orders-api.md` ainda descrevem o estado antes da correção.
- Efeito colateral: por causa da checagem de `current_database()`, esta migration **falha no banco shadow**. `migrate deploy` não usa shadow, então não afeta a aplicação em Test. Afetaria um futuro `migrate dev` ou `migrate diff` com shadow (hoje bloqueados pela política).

### 5.3 `20261102000000_update_products_source_identity_constraint` (710 bytes) [INSP]

- Sem `BEGIN`/`COMMIT`. Dois comandos: `DROP CONSTRAINT IF EXISTS` e `ADD CONSTRAINT products_source_identity_consistent` com `source_code ~ '^[A-Za-z0-9]+$'`. O Prisma envia o script como consulta múltipla, o que o PostgreSQL executa como uma transação implícita [NV: confirmar no teste].
- `ADD CONSTRAINT ... CHECK` valida as linhas existentes. Em Test (tabela vazia) é imediato.
- Depende do nome da constraint criada na migration anterior (`IF EXISTS` evita erro, mas se o nome divergisse a regra numérica antiga ficaria ativa).
- Divergência pequena: o banco aceitará letras minúsculas em `source_code`, mas a API só aceita `[0-9A-Z]` (`orderInput.ts`, `rules.ts`, `catalog.routes.ts`, `catalog.mapper.ts`). Inofensivo enquanto os códigos reais forem maiúsculos.

---

## 6. Riscos e incompatibilidades

| # | Risco | Gravidade | Classe |
|---|---|---|---|
| R1 | Trabalho não versionado: um único commit, 103 arquivos não rastreados, incluindo duas migrations e quase todo o backend de acesso e pedidos. Pasta no OneDrive reduz, mas não substitui versionamento | Crítica | [EXEC] |
| R2 | `REVOKE ... MAINTAIN` na migration `20261027` só existe a partir do PostgreSQL 17; em versão anterior a migration falha com erro de sintaxe. Um script antigo do projeto (`Invoke-Rf004InitialLab.ps1`) compara `server_version_num` com `180006`, o que indica PostgreSQL 18, mas não é prova do servidor real | Alta | [INSP] / [NV] |
| R3 | (Corrigido na revisão 3D.3.7-G) Disponibilidade de `pg_dump` e `pg_restore` não confirmada. A ausência na VM Linux desta sessão não diz nada sobre o Windows. O doc de 23/10 registra `PG_DUMP=False` para o ambiente daquela época, e o histórico mais recente informa `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe`. Sem backup restaurável não há deploy | Alta | [HERD] / [NV] |
| R4 | Fim de linha misto: as duas migrations novas estão em CRLF, as duas antigas em LF, sem `.gitattributes` e com `core.autocrlf` indefinido. O checksum muda se o arquivo for convertido ao ser commitado ou clonado, e depois de aplicada a migration não pode mudar | Média | [EXEC] |
| R5 | Divergência possível entre Dev e as migrations: o catálogo de Dev já tem produto com código alfanumérico (PA062240), o que exige a constraint nova, mas `prisma-run.ts` só permite `migrate` no perfil de Test. Como o Dev chegou a esse schema e o que há em `_prisma_migrations` de Dev não está documentado | Média | [NV] |
| R6 | A migration `20261027` falha se `orders` não estiver vazia. Esperado em Test, mas precisa de contagem real antes | Média | [NV] |
| R7 | Role `cardapio_dev_app` com `INSERT/UPDATE/DELETE` em `categories` e `products` (herdado de entrega anterior), acima do menor privilégio. A `REVOKE` da migration `20261027` não cobre essas duas tabelas | Média | [HERD] |
| R8 | A aplicação não tem permissão para criar admin, categoria ou produto (só `SELECT`). Os testes de integração de pedido precisam de dados semeados por uma role privilegiada, o que exige autorização própria | Média | [INSP] |
| R9 | Nenhum endpoint fecha comanda ou revoga sessão de cliente, e a role da aplicação não tem `UPDATE` em `comanda_sessions`. Cenários "sessão revogada" e "comanda fechada" só se testam alterando o banco por role privilegiada | Média | [INSP] |
| R10 | Nome enganoso: a constraint `orders_session_scope_consistent` verifica apenas o formato hexadecimal de `request_digest` e `idempotency_key` | Baixa | [INSP] |
| R11 | Scripts perigosos se mal apontados: `verify-db.ts` usa `new PrismaClient()` com o `DATABASE_URL` do ambiente e lê `_prisma_migrations`; `executor-seed-real.ts` e `publish-category-publication.ts` têm `--execute` fixo para Dev. Nenhum foi executado | Baixa | [INSP] |

---

## 7. Segurança e permissões

Todos os itens abaixo são [INSP], salvo indicação. Nenhum foi exercitado contra banco real.

| Tema | Achado |
|---|---|
| Cookie admin | `rustika_admin`: HttpOnly, SameSite=Strict, Path=`/api/admin`, 1 hora, token de 32 bytes em hexadecimal. Só o SHA-256 fica em memória |
| Cookie cliente | `rustika_session`: HttpOnly, SameSite=Lax, Path=`/api`, 8 horas. Só o SHA-256 fica no banco |
| Atributo Secure | Ativo se `NODE_ENV=production` ou se `CORS_ORIGIN` começa com `https://`. Em desenvolvimento HTTP não é Secure (esperado) |
| Leitura de cookie | Rejeita cookie duplicado e formato diferente de 64 hexadecimais |
| CSRF nas rotas de acesso | `POST` exige `Origin` idêntico a `CORS_ORIGIN`, `X-Rustika-Request: 1` e `application/json` |
| CSRF em `POST /api/orders` | Exige `Origin` idêntico e JSON, mas **não exige `X-Rustika-Request`**. O header customizado que existe ali é o `Idempotency-Key`, que também força preflight CORS, então a proteção prática é equivalente. Porém `docs/orders-api.md` diz "header customizado obrigatório" e `docs/access-api.md` descreve `X-Rustika-Request` para os POSTs. Contrato precisa ser decidido e alinhado |
| CORS | `app.ts` aplica `cors({ origin: <única>, credentials: true })` globalmente. `docs/orders-api.md` afirma que as credenciais ficam restritas à rota de pedidos. Divergência de documentação, risco baixo (origem única, sem curinga) |
| `Idempotency-Key` | UUID v4 obrigatório. Banco guarda `sha256([comandaId, sessionId, chave])` (64 hex, compatível com o CHECK) e `request_digest` do corpo normalizado. Replay igual devolve 200, corpo diferente devolve 409. Transação `Serializable` com até 3 tentativas |
| Preço | Total sempre recalculado pelo servidor a partir de `products.price`; preço do cliente só confirma a revisão (`PRICE_CHANGED`) |
| Produto elegível | Só produto com `publicKey`, categoria pública ativa e `availabilityState = AVAILABLE`. Produto interno (sem `publicKey`) nunca é encontrado |
| Rate limiting | Login 10/IP/15 min mais no máximo 4 verificações scrypt simultâneas no processo; emissão de convite 60/IP/5 min; resgate 30/IP/5 min. **`POST /api/orders` não tem limite.** Limites são por processo e usam `request.ip` sem `trust proxy`: atrás de proxy todos os clientes compartilham um balde. O teto global de 4 scrypt também permite que 4 tentativas simultâneas bloqueiem um login legítimo |
| Sessão administrativa | Em memória, 1 hora, capacidade 1000, invalidada se o admin mudar (`updatedAt`) ou for desativado. Reiniciar o servidor derruba todos os logins. Só serve com uma instância |
| Senha | scrypt (N=32768, r=8, p=3), `timingSafeEqual`, verificação de custo equivalente quando a conta não existe |
| Convite e sessão | Resgate atômico em transação `Serializable` com `updateMany` condicional; uma sessão por convite garantida por índice único |
| Privilégios (pós-migrations) | Aplicação de Test: leitura de `admins`, `categories`, `products`; inserção de pedidos, itens, histórico, sessões; leitura/inserção/atualização em comandas e convites; sem acesso a `_prisma_migrations` |
| Separação admin e cliente | Cookies com caminhos diferentes; emissão de convite exige sessão admin revalidada dentro da transação; resgate e pedido não dependem de admin |
| Privilégios reais no banco | [NV]: só a execução de `inspect-test.sql` e das consultas da seção 10.2 confirma |

Não alterei autenticação, ACL, `.env` nem código de segurança.

---

## 8. Plano de backup e recuperação (documentado, não executado)

Objetivo: ponto de restauração verificável do `cardapio_digital_test` antes do deploy.

### 8.1 Pré-requisitos

1. Localizar as ferramentas no Windows: `Get-Command pg_dump, pg_restore, psql` ou procurar em `C:\Program Files\PostgreSQL\<versão>\bin`. O caminho histórico informado é `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe` (evidência histórica, não verificação atual). Se não existirem, instalar as ferramentas de linha de comando da mesma versão maior do servidor. [NV]
2. Diretório de destino fora do repositório **e fora do OneDrive**, por exemplo `C:\Backups\rustika`. O `.gitignore` já ignora `*.dump` e `*.backup`, mas a pasta do projeto está dentro do OneDrive, então um dump ali seria sincronizado.
3. Parar backend, frontend e qualquer executor de testes. Confirmar zero sessões de `cardapio_test_app` em `pg_stat_activity`.
4. Registrar versão do PostgreSQL e o resultado do roteiro da seção 4.3.

### 8.2 Execução do backup (após autorização)

```powershell
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$arquivo = "C:\Backups\rustika\cardapio_digital_test_pre3d37_$ts.dump"
$env:PGPASSWORD = '<lida de fonte local>'
pg_dump -h 127.0.0.1 -p 5432 -U cardapio_migrator -d cardapio_digital_test -Fc --create -f $arquivo
Remove-Item Env:PGPASSWORD
Get-FileHash -Algorithm SHA256 $arquivo
```

`--create` leva junto o dono do banco e as ACLs de nível de banco. Default ACLs de schema já vão no dump comum.

### 8.3 Verificação de integridade

1. `pg_restore --list $arquivo` precisa listar o conteúdo sem erro (lê o índice do arquivo, não toca o banco).
2. Guardar o SHA-256 junto do arquivo.
3. Teste de restauração em banco temporário (nome sugerido `cardapio_restore_check`), **nunca** sobre `cardapio_digital_test`:
   - criar o banco temporário (exige autorização e `CREATEDB`)
   - `pg_restore -d cardapio_restore_check --no-owner $arquivo`
   - rodar as consultas de grants e de default ACLs e comparar com o estado de origem
   - remover o banco temporário (exige autorização)
4. Roles são objetos do cluster e não vão no dump de um banco. Registrar atributos e memberships por consulta (seção 4.3). Não usar `pg_dumpall --roles-only`, porque ele grava hashes de senha.

### 8.4 Recuperação

- Não usar `prisma migrate reset` nem `migrate resolve` como rollback (a política do projeto já os bloqueia).
- Em falha do deploy: manter a aplicação parada, guardar a saída já redigida pelo `prisma-run.ts`, inspecionar `_prisma_migrations` e os objetos criados, e não repetir o deploy às cegas.
- As migrations `20261027` e `20261031` têm `BEGIN/COMMIT` explícitos; a `20261102` roda como script múltiplo. Mesmo assim, não presumir atomicidade total até a inspeção pós-falha.
- Restauração: com autorização, recriar o banco a partir do dump verificado (`pg_restore --create`) ou usar `--clean --if-exists` num banco já parado. Depois, repetir a auditoria da seção 4.3 antes de qualquer nova tentativa.
- Como o Test tem tabelas vazias, a alternativa prática e equivalente é recriação controlada do banco com a migration inicial. Ainda assim, o dump verificado é a condição do plano.

---

## 9. Plano de aplicação das migrations em Test (não executar nesta entrega)

### 9.1 Comando real do projeto

Verificado em `backend/package.json` e `scripts/prisma-run-policy.ts`:

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend

# 1. leitura
npm run db:migrate:status:test

# 2. confirmação exigida pela política, só neste terminal
$env:CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION = 'APPLY_CARDAPIO_DIGITAL_TEST'

# 3. aplicação (executa: tsx scripts/prisma-run.ts migrate-test migrate deploy)
npm run db:migrate:deploy:test

# 4. limpeza
Remove-Item Env:CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION

# 5. leitura final
npm run db:migrate:status:test
```

Nenhuma flag extra, nenhum contorno de proteção. Esse comando **não foi executado**.

### 9.2 Pré-condições (todas verdadeiras antes do passo 3)

1. Alterações protegidas no Git ou em cópia externa (decisão do usuário), e fim de linha das duas migrations novas decidido antes do deploy (R4). Não editei os arquivos.
2. `migrate status` mostra 1 aplicada e 3 pendentes, sem falhas e sem divergência.
3. `server_version_num` maior ou igual a 170000 (R2).
4. `orders` com 0 linhas; roles `cardapio_test_app` e `cardapio_dev_app` existem; nenhuma sessão ativa de `cardapio_test_app`.
5. Backup feito, hash registrado e restauração testada (seção 8).
6. Autorização escrita e específica do usuário para o `deploy` em Test.

### 9.3 Condições de parada

Qualquer pré-condição falsa; `_prisma_migrations` com linha sem `finished_at` e sem `rolled_back_at`; erro do `deploy`; ou resultado da verificação abaixo diferente do esperado. Nesses casos: parar, não repetir, aplicar a seção 8.4.

### 9.4 Verificação pós-execução (somente leitura)

```sql
SELECT migration_name, checksum, finished_at, rolled_back_at
FROM _prisma_migrations ORDER BY started_at;
-- esperado: 4 linhas, todas com finished_at preenchido e checksum igual à tabela da seção 5

SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'products'::regclass AND conname = 'products_source_identity_consistent';
-- esperado: contém ^[A-Za-z0-9]+$

SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'order_status' ORDER BY enumsortorder;
-- esperado: RECEIVED, IN_PREPARATION, READY, DELIVERED, CANCELLED

SELECT table_name, privilege_type FROM information_schema.role_table_grants
WHERE grantee = 'cardapio_test_app' AND table_schema = 'public' ORDER BY 1, 2;
-- esperado exatamente:
--  admins: SELECT | categories: SELECT | products: SELECT
--  orders, order_items, order_status_history, comanda_sessions: INSERT, SELECT
--  comandas, comanda_invitations: INSERT, SELECT, UPDATE

SELECT has_table_privilege('cardapio_test_app', '_prisma_migrations', 'SELECT') AS app_le_controle,
       has_sequence_privilege('cardapio_test_app', 'orders_order_number_seq', 'USAGE') AS app_usa_sequencia;
-- esperado: false, true
```

Mais: `npm run db:migrate:status:test` informando "up to date", e `pg_default_acl` sem concessões novas inesperadas para `cardapio_test_app` ou `PUBLIC`.

### 9.5 Evidências necessárias para aprovar

Saída redigida do status antes e depois; resultado das consultas acima; hash e `pg_restore --list` do backup; versão do PostgreSQL; confirmação de que nenhuma credencial aparece nos logs.

---

## 10. Testes futuros de integração (planejados, nada persistido)

Fluxo: login administrativo, convite, comanda, sessão, pedido. Rodar contra Test com `NODE_ENV=test` e `DB_PROFILE=app-test`, nunca contra Dev.

### 10.1 Dados que a aplicação não consegue criar (R8)

Precisam entrar por role privilegiada em procedimento próprio, com autorização: um admin de teste (hash gerado por `hashPassword`, conforme `docs/admin-provisioning.md`), uma categoria com `public_key`, e produtos de teste: um `AVAILABLE`, um `UNAVAILABLE`, um `UNKNOWN`, um interno (`public_key` nulo) e um com código alfanumérico no formato do PA062240 (`rustika-PA062240`, 5000 centavos). Os scripts de Seed existentes apontam para Dev e não servem para isso.

### 10.2 Cenários

| Grupo | Cenário | Esperado |
|---|---|---|
| Admin | credenciais válidas | 200, cookie `rustika_admin` |
| Admin | senha errada, e-mail inexistente, conta inativa | 401 `INVALID_CREDENTIALS` |
| Admin | sem `Origin`, ou sem `X-Rustika-Request`, ou sem JSON | 403 / 403 / 415 |
| Admin | 11 logins em 15 min do mesmo IP | 429 com `Retry-After` |
| Convite | sem cookie admin | 401 `ADMIN_UNAUTHENTICATED` |
| Convite | comanda `"000123"` nova ou aberta | 201 e linha em `comandas` e `comanda_invitations` |
| Convite | comanda fechada (fechar via role privilegiada) | 409 `COMANDA_CLOSED` |
| Convite | número inválido, validade 0 ou 31 | 400 |
| Resgate | convite válido | 201, cookie `rustika_session`, `consumed_at` preenchido, 1 sessão |
| Resgate | mesmo convite de novo | 401 `INVALID_INVITATION` |
| Resgate | convite expirado (convite de 1 min e espera, ou `expires_at` alterado por role privilegiada) | 401 |
| Resgate | convite revogado (`revoked_at` por role privilegiada) | 401 |
| Resgate | dois resgates simultâneos do mesmo convite | exatamente um 201 |
| Sessão | `GET /current` válido | 200 |
| Sessão | sem cookie, expirada, revogada, comanda fechada | 401 `INVALID_SESSION` |
| Pedido | produto público `AVAILABLE` | 201; 1 linha em `orders`, itens com snapshot, 1 evento de histórico (`from_status` nulo, `to_status` RECEIVED), total igual ao recalculado |
| Pedido | produto interno | 404 `PRODUCT_NOT_FOUND` |
| Pedido | `UNAVAILABLE` e `UNKNOWN` | 409 `PRODUCT_UNAVAILABLE` |
| Pedido | `rustika-PA062240` com preço esperado 5000 | 201, total 5000 |
| Pedido | preço alterado no banco antes do envio | 409 `PRICE_CHANGED`, nenhuma linha nova |
| Pedido | mesma chave e mesmo corpo | 200, mesmo `orderNumber`, contagem de `orders` inalterada |
| Pedido | mesma chave e corpo diferente | 409 `IDEMPOTENCY_CONFLICT` |
| Pedido | 5 requisições paralelas com a mesma chave | 1 pedido no banco |
| Pedido | sessão B reutiliza a chave da sessão A | cria pedido próprio; não recupera o de A |
| Pedido | sem cookie, sem `Idempotency-Key`, `Origin` errada, texto puro | 401 / 400 / 403 / 415 |
| Transação | pedido com 2 itens, o segundo inexistente | 404 e zero linhas em `orders`, `order_items`, `order_status_history` |
| Transação | falha forçada depois do INSERT de `orders` | opcional: exige objeto de teste criado por role privilegiada (por exemplo um gatilho temporário), então só com autorização própria. Esperado: rollback total; a sequência `order_number` pode ficar com lacuna |

Verificação de persistência após cada cenário: consultas `SELECT` por role privilegiada. Limpeza: restaurar do backup ou esvaziar por role privilegiada com autorização. Nunca com a role da aplicação.

---

## 11. Pendências e prioridades

Crítica

1. Proteger o trabalho no Git ou em cópia externa (R1) e decidir a política de fim de linha das migrations (R4). Não fiz commit.
2. Confirmar `pg_dump` e `pg_restore` no Windows (R3) e produzir backup com restauração testada.
3. Rodar no Windows a auditoria de leitura da seção 4.3 e o `npm run db:migrate:status:test`, e anexar a saída redigida.
4. Confirmar a versão do PostgreSQL (R2) e `orders` vazia (R6).
5. Autorização específica para o `deploy` em Test.

Alta

6. Decidir o contrato de CSRF de `POST /api/orders` (exigir ou não `X-Rustika-Request`) e alinhar `orders-api.md`, `access-api.md` e `rf004-onda-2.3c2-migration-offline.md`.
7. Rate limit em `POST /api/orders`; `trust proxy` e limite global de scrypt antes de publicar atrás de proxy.
8. Plano de ACL para `cardapio_dev_app` (R7), com mapa das operações reais e rollback, antes de liberar pedidos em Dev.
9. Procedimento aprovado de fixtures privilegiadas para Test (R8) e de provisionamento do admin.
10. Estratégia de sessão administrativa para produção (store compartilhado ou instância única documentada).
11. Esclarecer o histórico do schema de Dev (R5).

Média e baixa

12. Rodar `npm test`, `typecheck`, `build` e `db:validate` no Windows e registrar a contagem real (440/440).
13. Constraint `orders_session_scope_consistent` com nome enganoso (R10); regex de maiúsculas versus banco; migration de permissões que falha em shadow.
14. Resíduos na raiz (`$testRunner`, JSONs vazios, `changes.diff`, `vitest-report.json`): decidir manter ou arquivar.
15. Frontend: checkout real, favicon, imagens e descrições (fora desta fase).

---

## 12. Arquivos alterados

- Criado: `RELATORIO-ENTREGA-3D.3.7.md` (este arquivo, na raiz do projeto).
- Nenhum outro arquivo do projeto foi criado, alterado, movido ou apagado. [EXEC: `git status --short` com as mesmas 116 linhas antes e depois, 13 M e 103 ??, mais este relatório]
- Fora do projeto (VM temporária, descartável): lista de baseline do `git status`, SHA-256 dos 190 arquivos e saída do `tsc`.
- O `tsc` roda com `noEmit`. A tentativa de Vitest falhou antes de iniciar; nenhum arquivo novo apareceu em `dist`, `node_modules/.vite` ou `node_modules/.vitest`.

---

## 13. Comandos executados

Todos de leitura, no shell da VM, dentro da pasta montada do projeto, com `GIT_OPTIONAL_LOCKS=0` nos comandos Git.

| Comando (resumo) | Finalidade |
|---|---|
| `ls`, `find`, `wc`, `grep`, `sed -n`, `cat` | Listar e ler código, migrations, schema, docs, scripts e testes |
| `git branch --show-current`, `git log --oneline -5`, `git status --short`, `git diff --stat`, `git ls-files`, `git config --get core.autocrlf` | Estado do Git |
| `sha256sum` | Checksums das migrations e baseline de 190 arquivos |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (2 vezes) | Typecheck |
| `NODE_ENV=test DB_PROFILE=app-test node node_modules/vitest/vitest.mjs run tests/domain/rules.test.ts` | Tentativa de teste de domínio; falhou por binário nativo ausente |
| `which node npm npx pg_dump pg_restore psql` | Disponibilidade de ferramentas (só node, npm, npx existem) |

Não foram executados: `prisma migrate deploy/status`, qualquer script de Seed, publicação, executor, `psql`, `pg_dump`, `pg_restore`, nem leitura de `.env` ou dos arquivos de segredos.

---

## 14. Estado do Git

```
branch: main
último commit: 1e80bdb chore: baseline inicial do projeto RUSTIKA (único)
git status --short: 116 entradas (13 " M", 103 "??")
git diff --stat (rastreados): 13 arquivos, 833 inserções, 527 remoções
commits criados nesta sessão: nenhum
```

Nenhum comando destrutivo foi usado (`reset`, `clean`, `checkout --`, `restore`, `push --force`).

---

## 15. Parecer final

A 3D.3.7 fica **concluída como auditoria documental e plano**, e **não aprovada para aplicação**.

O que está sustentado: as quatro migrations estão em ordem, sem operação destrutiva, coerentes com o `schema.prisma` e com as operações reais dos services; o conjunto de permissões da migration `20261031` cobre exatamente o fluxo implementado; a política do `prisma-run` impede `deploy` fora do perfil e do banco de Test e exige confirmação explícita; o typecheck passa.

O que falta antes de qualquer deploy: auditoria de leitura do banco Test (não foi possível daqui), versão do PostgreSQL, ferramentas e prova de backup restaurável, proteção do trabalho no Git, decisão sobre fim de linha das migrations novas e autorização específica.

Próxima etapa sugerida para o ChatGPT definir após a revisão: fase de preparação do ambiente Windows (backup, auditoria de leitura, status do Prisma), sem tocar em código.


---

# PARTE II: ENTREGA 3D.3.7-G

Consolidação da auditoria Windows/Linux e preparação do baseline seguro

Data: 03/11/2026, 21h30 (America/Sao_Paulo)
Escopo: somente leitura. Nenhum commit, nenhuma migration, nenhum Seed, nenhuma alteração de banco, ACL, credencial, `.env` ou código. O único arquivo alterado nesta etapa é este relatório.
Classes: as mesmas da Parte I, mais [WEB] para fonte pública consultada nesta sessão.

---

## 16. Evidências recebidas do Windows

**Nenhuma saída do Windows foi recebida até o momento desta atualização.** Nada nesta seção é declarado como confirmado pelo Windows. Os resultados da VM Linux (typecheck com exit code 0) não substituem a conferência no Windows: o Node, o sistema e os binários são outros.

| Item | Resultado histórico a comparar | Comando a rodar no Windows | Saída recebida | Status |
|---|---|---|---|---|
| Typecheck | 0 erros TypeScript | `npm run typecheck` | nenhuma | PENDENTE |
| Testes | 440/440, 20 arquivos | `npm test` | nenhuma | PENDENTE |
| Status das migrations | 1 aplicada e 3 pendentes, banco `cardapio_digital_test` | `npm run db:migrate:status:test` | nenhuma | PENDENTE |
| Ferramentas PostgreSQL | `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe` (histórico) | comandos abaixo | nenhuma | PENDENTE |
| Versão do servidor | PostgreSQL 18 (indício histórico) | `SELECT current_setting('server_version_num');` | nenhuma | PENDENTE |

Roteiro (rodar em `backend`, colar a saída no chat; não salvar arquivos de saída dentro da pasta do projeto, que está no OneDrive):

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
$env:NODE_ENV = 'test'; $env:DB_PROFILE = 'app-test'
npm run typecheck
npm test
Remove-Item Env:NODE_ENV, Env:DB_PROFILE

npm run db:migrate:status:test

$bin = 'C:\Program Files\PostgreSQL\18\bin'
Get-Command pg_dump, pg_restore, psql -ErrorAction SilentlyContinue | Select-Object Name, Source
Test-Path "$bin\pg_dump.exe"; Test-Path "$bin\pg_restore.exe"; Test-Path "$bin\psql.exe"
& "$bin\pg_dump.exe" --version
& "$bin\pg_restore.exe" --version
```

Critérios de comparação quando as saídas chegarem:

- Typecheck: sem linhas de erro e exit code 0. Qualquer erro contradiz o histórico e reabre a 3D.3.7.
- Testes: linha final com 20 arquivos e 440 testes aprovados. Se o total divergir, comparar com a contagem estática (273 chamadas literais de `it(`) só como pista, não como prova.
- `migrate status`: deve citar o banco `cardapio_digital_test`, listar `20261027000000`, `20261031000000` e `20261102000000` como não aplicadas, e nenhuma falha. O `prisma-run.ts` já redige a URL.
- Ferramentas: o `--version` de `pg_dump` e `pg_restore` precisa ter a mesma versão maior do servidor (ou maior).

---

## 17. Resultados ainda não verificados

| Item | Por quê | Como fechar |
|---|---|---|
| 440/440 testes e 20 arquivos | Vitest não roda na VM Linux (binário `rolldown` ausente) | `npm test` no Windows |
| Build aprovado | Só há o artefato `dist/server.js` de 21:10 | `npm run build` no Windows |
| `prisma validate` | Engine do Prisma é binário Windows | `npm run db:validate` no Windows |
| Estado real do banco Test (roles, tabelas, contagens, `_prisma_migrations`) | Sem acesso ao PostgreSQL daqui | Seção 4.3 da Parte I, no Windows |
| Versão do servidor PostgreSQL | Só há indício histórico | `SHOW server_version;` |
| Ferramentas `pg_dump` e `pg_restore` | Sem acesso ao Windows | Roteiro da seção 16 |
| Estado de `_prisma_migrations` em Dev | Nunca consultado | Consulta de leitura em Dev, com autorização |
| Privilégios reais de `cardapio_dev_app` em `categories` e `products` | Herdado de relatório | `inspect-dev.sql` |
| Comportamento do `upsert` de comanda sem `UPDATE` | Só testável com banco real | Teste de integração com os grants reais |
| Atomicidade da migration `20261102` | Depende de como o Prisma envia o script | Observar na primeira aplicação em Test |

---

## 18. Inventário de alterações Git

Estado em 03/11 21h30: branch `main`, commit único `1e80bdb086aed59b08e3b35e5141f03f840d7fa9`, **sem remote configurado** (`git remote -v` vazio). 13 arquivos rastreados modificados e 104 entradas não rastreadas, que expandidas dão 117 arquivos (116 mais este relatório). [EXEC]

### 18.1 Rastreados modificados (13)

Onze dos treze aparecem com fim de linha CRLF na pasta de trabalho contra LF no índice, o que infla o diff bruto (833 inserções e 527 remoções). Ignorando o CR, o que mudou de fato: [EXEC]

| Arquivo | Linhas (+/-) reais | Observação |
|---|---|---|
| `backend/src/app.ts` | +19 / -2 | Registra routers e CORS com credenciais; importa 14 arquivos não versionados |
| `backend/src/middleware/errorHandler.ts` | +23 / -6 | Tratamento de JSON inválido e corpo grande |
| `backend/src/domain/rules.ts` | +1 / -1 | Regra de chave de produto alfanumérica |
| `backend/tests/domain/rules.test.ts` | +10 / -0 | |
| `backend/tests/health.test.ts` | +6 / -3 | |
| `frontend/package.json` | +2 / -1 | |
| `frontend/src/App.tsx` | +10 / -3 | Importa `CatalogStatus` e `useCatalog`, não versionados |
| `frontend/src/components/Catalog.tsx` | +1 / -1 | |
| `frontend/src/components/ConnectionIndicator.tsx` | +8 / -5 | |
| `frontend/src/components/ProductCard.tsx` | +4 / -3 | |
| `frontend/src/components/ProductModal.tsx` | +4 / -2 | |
| `frontend/src/types/catalog.ts` | +8 / -2 | |
| `frontend/src/services/api.ts` | +240 / -1 | Cliente HTTP real (LF) |

### 18.2 Não rastreados (117 arquivos) classificados por função

| Grupo | Arquivos | Qtde | Papel |
|---|---|---|---|
| E1. Necessários para compilar e rodar | `backend/src/`: `domain/orderInput.ts`, `mappers/` (2), `routes/` (3), `security/` (3), `services/` (5); `backend/prisma/migrations/20261031.../` e `20261102.../`; frontend: `CatalogStatus.tsx`, `hooks/useCatalog.ts`, `services/catalogStore.ts`, `catalogSource.ts`, `catalogAdapter.ts` | 21 | `app.ts` e `App.tsx` já versionados importam estes arquivos. O commit baseline sozinho não compila. Os dois SQL são exigidos pelo `migrate deploy` |
| E2. Necessários para validar | `backend/tests/` (16, incluindo fixtures e testes de scripts), `frontend/tests/` (6), `backend/docs/` (4 contratos), `frontend/docs/` (1), `backend/src/domain/categoryPublication.ts` (usado só por scripts e testes) | 28 | Sustentam o 440/440 e documentam os contratos |
| E3. Código existente, ainda não ligado à aplicação | `AppWrapper.tsx`, `pages/AdminLogin.tsx`, `pages/AdminDashboard.tsx`, `pages/Checkout.tsx`, `components/ComandaRedeem.tsx` | 5 | `main.tsx` carrega `App`, e nada importa estes cinco. O fluxo de acesso e checkout não está acessível pela interface hoje |
| E4. Scripts operacionais | `backend/scripts/` (21 arquivos: seeds, executores, inspeções, validações, análises) | 21 | Não fazem parte do runtime. `executor-seed-real.ts` e `publish-category-publication.ts` têm `--execute` e alvo fixo em Dev. A classificação dos demais é por nome, sem revisão linha a linha |
| E5. Dado de origem do catálogo | `backend/data/Exportacao-produtos.xlsx` (18 KB) | 1 | Fonte da recuperação de 168 produtos. Dado de negócio, não está no `.gitignore` |
| E6. Histórico e análise | 20 relatórios na raiz, 6 em `backend/`, este relatório, e 8 arquivos de reconciliação na raiz (`ambiguidades.json`, `mapeamento*.json`, `produtos_banco.json`, `reconciliation-output.json`, `validacao-vinculos.json`, `analise-fechamento.txt`, `dry-run-recovery.txt`) | 35 | Documentação das fases anteriores. A varredura por padrões de segredo (URL com senha, `password=`, chave privada) não achou ocorrência; vale só como triagem, não como garantia |
| E7. Resíduos | `$testRunner` (7 bytes), `backend/changes.diff` (0), `backend/vitest-report.json` (falha antiga), `ausentes.json` (0), `sem_correspondencia.json` (0), `candidatos.json` (12 bytes) | 6 | Candidatos a ignorar ou arquivar. Nada foi apagado |

Total: 21 + 28 + 5 + 21 + 1 + 35 + 6 = 117. [EXEC] para as contagens; [INSP] para a classificação.

### 18.3 Riscos dos arquivos não rastreados

1. O baseline não é reconstruível: `app.ts` importa 14 arquivos e `App.tsx` importa 5 que só existem no disco.
2. Uma operação como `git clean -fd`, um clone novo ou um conflito do OneDrive apaga ou desvia esse trabalho. O OneDrive sincroniza arquivos, mas não guarda a história de forma que o Git guardaria.
3. Duas das quatro migrations não têm versão registrada. O `migrate deploy` depende do arquivo local, e o checksum depende dos bytes exatos dele (seção 20).
4. O fim de linha misto (CRLF nos arquivos novos, LF no que está commitado) mascara o diff real e muda o checksum das migrations.
5. Sem remote, o único backup do repositório é o disco local e o OneDrive.
6. Dado de negócio (planilha e JSONs de reconciliação) e scripts com `--execute` contra Dev entrariam num repositório sem política de visibilidade definida.

### 18.4 Estratégia proposta de versionamento (para aprovação, nada executado)

Princípios: nunca `git add .` nem `git add -A`; sempre caminhos explícitos; nenhum comando destrutivo; cada commit pequeno e verificável; o conteúdo dos arquivos não muda, só o fim de linha, e só onde for aprovado.

1. **Cópia externa antes de qualquer Git.** Copiar a árvore de trabalho para fora do OneDrive, sem `node_modules`, `dist` e `.env`:
   ```powershell
   robocopy C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital C:\Backups\rustika\arvore-20261103 /E /XD node_modules dist /XF .env
   ```
2. **Branch de trabalho**, sem mexer em arquivos: `git switch -c chore/consolidacao-3d37`.
3. **Commit 1: política de fim de linha.** Somente um `.gitattributes` novo, proposto assim:
   ```
   * text=auto
   backend/prisma/migrations/**/*.sql text eol=lf
   *.ps1 text eol=crlf
   ```
4. **Commits seguintes, por grupo, com caminhos explícitos:**
   - C2: E1 backend e os 13 modificados do backend (migrations só depois da decisão de fim de linha, seção 20)
   - C3: testes e docs do backend (E2)
   - C4: E1 frontend, os modificados do frontend e testes do frontend
   - C5: código ainda não ligado (E3)
   - C6: scripts operacionais (E4)
   - C7: dados e histórico (E5 e E6), somente se o repositório for privado
   - E7 fica de fora até o usuário decidir entre ignorar e arquivar
5. **Prova de que o commit se basta:** clone local em pasta temporária e rodar nela `npm ci`, `npm run typecheck`, `npm test` e `npm run build` no backend, e typecheck e build no frontend. Se passar, a árvore versionada reproduz o que funciona hoje.
6. **Marco:** tag `baseline-3d37` depois da prova do passo 5, e definição de um remote privado (decisão do usuário).

Alternativa mínima, se faltar tempo: um único commit de "snapshot" numa branch própria com caminhos explícitos, dividido depois. Tem o defeito de misturar o lixo do grupo E7 e a planilha.

---

## 19. Divergências de segurança (A, B, C)

### 19.0 Como o comportamento foi demonstrado

Script fora do repositório, rodado na VM Linux contra o `dist/app.js` compilado em 03/11 às 21:10, criando `createApp()` sem Prisma e chamando as rotas com supertest, em processo, sem rede e sem banco. A raiz do backend foi simulada com uma cópia do `database-profiles.json`, de modo que o `.env` não foi lido. Os status 503 abaixo vêm de não haver Prisma e mostram que a requisição passou por todas as guardas anteriores. [EXEC]

| Caso | Requisição | Resultado | CORS |
|---|---|---|---|
| A1 | `POST /api/orders` com Origin correta, cookie válido em formato, `Idempotency-Key`, JSON, **sem** `X-Rustika-Request` | 503 `ORDERS_UNAVAILABLE` (passou as guardas) | ACAC true |
| A2 | mesma requisição sem `Idempotency-Key` | 400 `INVALID_IDEMPOTENCY_KEY` | ACAC true |
| A3 | Origin diferente | 403 `ORIGIN_NOT_ALLOWED` | ACAC true |
| A4 | `POST /api/admin/auth/login` sem `X-Rustika-Request` | 403 `ORIGIN_NOT_ALLOWED` | ACAC true |
| B1 | 40 `POST /api/orders` seguidos | 40 respostas 503, **nenhuma 429** | |
| B2 | 12 logins seguidos | 10 respostas 503, a 11ª e a 12ª em 429 | |
| C1 | `GET /api/categories` com Origin | 503 (sem Prisma) | ACAC true, ACAO igual à origem configurada |
| C2 | `GET /api/health` com Origin | 200 | ACAC true |
| C3 | `OPTIONS /api/categories` (preflight) | 204 | ACAC true; `allow-headers`: `Content-Type, X-Rustika-Request, Idempotency-Key` |

ACAC é `Access-Control-Allow-Credentials` e ACAO é `Access-Control-Allow-Origin`.

### 19.A `POST /api/orders` não exige `X-Rustika-Request`

1. **Arquivos e linhas.**
   - `backend/src/routes/order.routes.ts:15` (comentário diz "exact Origin, JSON and a custom header"), `:16` (Origin), `:17` (JSON), `:18` (query), `:19` (cookie), `:20` (`Idempotency-Key`). Não há checagem de `X-Rustika-Request`.
   - `backend/src/routes/access.routes.ts:31-35` (`writeGuard` exige Origin e `X-Rustika-Request: 1`) e `:43`, `:51`, `:56`, `:59` (onde é usado).
   - `backend/src/app.ts:28` (`X-Rustika-Request` consta em `allowedHeaders`).
   - Docs: `backend/docs/orders-api.md:99` ("header customizado obrigatório"); o exemplo de requisição nas linhas 54 a 59 não inclui o header; `backend/docs/access-api.md:31-39`.
   - Testes: `backend/tests/orders.test.ts:9-10` (o helper de POST nunca envia o header); `backend/tests/access.test.ts:85` (cobre a ausência do header só no login).
2. **Comportamento atual.** Casos A1 a A4 acima. O header só é cobrado nas rotas de acesso.
3. **Risco concreto.** Hoje não há exploração prática: um site de outra origem não consegue enviar o POST com cookie, porque `Content-Type: application/json` e o header `Idempotency-Key` exigem preflight, e o CORS só autoriza a origem configurada; formulário comum cai em 415; e o cookie é SameSite=Lax. O problema é de consistência e de defesa em camadas: o código e a documentação prometem uma proteção que a rota não aplica, e a proteção real depende de o `Idempotency-Key` continuar obrigatório. Se alguém o tornar opcional no futuro, a proteção CSRF cai sem aviso. Gravidade: baixa a média.
4. **Impacto no frontend e nos testes.**
   - Nenhum código do frontend envia pedidos hoje (nenhuma ocorrência de `/orders` ou `Idempotency-Key` em `frontend/src`).
   - Achado relacionado: `api.post` (`frontend/src/services/api.ts:224`) não adiciona `X-Rustika-Request` nem `credentials: 'include'`, e `AdminLogin.tsx:28`, `AdminDashboard.tsx:12` e `:25` e `ComandaRedeem.tsx:33` chamam `api.post` sem passar essas opções. Contra o backend real, o login receberia 403 e o cookie não seria gravado. `getWithAuth` (`api.ts:241-245`) envia `Authorization: Bearer` lido de `localStorage.adminToken`, que o backend nunca emite e que não consta em `allowedHeaders`. Os testes do frontend usam `fetch` simulado (`frontend/tests/checkout.test.mjs`), então nada disso aparece. Essas páginas também não estão ligadas ao `main.tsx` (E3). [INSP]
   - Testes do backend: o helper de `orders.test.ts` e a requisição da linha 121 precisam enviar o header após a correção.
5. **Correção mínima (A1, recomendada).** Na condição da linha 16 de `order.routes.ts`, acrescentar `|| request.get('X-Rustika-Request') !== '1'`, reaproveitando `ORIGIN_NOT_ALLOWED`; atualizar o comentário da linha 15; acrescentar o header ao exemplo de `orders-api.md` e à lista de requisitos. Alternativa A2, só documentação: corrigir `orders-api.md:99` para dizer que o header customizado é o `Idempotency-Key`. A2 não muda código, mas deixa duas convenções diferentes no mesmo backend.
6. **Testes de regressão.** (i) Sem o header: 403 `ORIGIN_NOT_ALLOWED` e transação não chamada. (ii) Valores `0`, `true`, vazio: 403. (iii) Com o header válido: 201 e replay 200 como hoje. (iv) Preflight de `/api/orders` continua listando `X-Rustika-Request`. (v) Os 12 testes atuais de `orders.test.ts` continuam passando depois de o helper enviar o header.
7. **Altera contrato?** A1 sim: o header passa a ser obrigatório em `POST /api/orders`. Como nenhum cliente envia pedidos ainda, a mudança não quebra ninguém. A2 não altera.

### 19.B `POST /api/orders` sem rate limiting

1. **Arquivos e linhas.**
   - `backend/src/routes/order.routes.ts:12-28` (nenhum `accessLimit`); comparar com `access.routes.ts:43` (login 10 por 15 min), `:56` (convite 60 por 5 min), `:59` (resgate 30 por 5 min).
   - `backend/src/security/accessLimits.ts:5-21` (limite por IP, em memória, por processo, janela fixa, até 10000 chaves).
   - `backend/src/app.ts:41` (monta o router de pedidos sem relógio injetável).
   - Docs: `access-api.md` lista os limites das rotas de acesso; `orders-api.md` não cita 429 na tabela de erros.
   - Testes: `access.test.ts:98` cobre o 429; `orders.test.ts` não tem teste de limite.
2. **Comportamento atual.** B1: 40 requisições seguidas chegaram até o serviço sem nenhuma 429; B2: o login corta na 11ª. [EXEC]
3. **Risco concreto.** (i) Qualquer chamador com um cookie bem formado de 64 hexadecimais passa pelas guardas, tem o corpo lido (até 16 KiB) e dispara a transação `Serializable` com leitura de sessão no banco antes de receber `INVALID_SESSION`; sem teto, isso é pressão sobre o pool do Prisma sem precisar de sessão válida. (ii) Quem tem sessão válida (8 horas) pode enviar quantos pedidos quiser, cada um com uma chave nova, o que enche a fila do estabelecimento com pedidos falsos; a idempotência só impede duplicata da mesma chave. (iii) Adivinhar o token (256 bits) é inviável, então não é bypass de autenticação. Gravidade: média, de disponibilidade e abuso.
4. **Impacto no frontend e nos testes.** Nenhum hoje. O checkout futuro precisa tratar 429 e `Retry-After`. Cuidado de calibragem: clientes no Wi-Fi do estabelecimento saem pelo mesmo IP público, então um teto por IP baixo bloqueia clientes legítimos; e como `trust proxy` não está configurado, atrás de proxy todos dividem um só balde. Os testes atuais criam um app novo por teste, e o mapa de contagem é por instância, então não colidem.
5. **Correção mínima.** Incluir `accessLimit(...)` como primeiro middleware de `router.post` em `order.routes.ts`, passando o relógio (`dependencies.authClock`) pelo `app.ts:41`. Valor inicial a decidir, com folga para uso real (sugestão a validar: 120 requisições por IP em 5 minutos). Melhor versão: chave por hash da sessão em vez de IP, via um parâmetro opcional de função de chave em `accessLimit`, com algo na ordem de 10 pedidos por sessão a cada 5 minutos, mais um teto de IP largo. Os números são hipóteses, não medições.
6. **Testes de regressão.** (i) Depois de N pedidos, o seguinte volta 429 com `Retry-After`. (ii) O serviço não é chamado nas respostas 429. (iii) A janela reinicia com o relógio injetado. (iv) Sessões diferentes têm baldes diferentes, se a chave por sessão for adotada. (v) Fluxos normais abaixo do limite continuam 201. (vi) Definir a ordem entre limite e leitura do corpo (um corpo grande de um IP limitado deve dar 429, não 413).
7. **Altera contrato?** Acrescenta o erro 429 `TOO_MANY_REQUESTS` com `Retry-After` na tabela de erros de `orders-api.md`. É aditivo: o formato de requisição e de resposta de sucesso não muda.

### 19.C CORS com credenciais aplicado globalmente

1. **Arquivos e linhas.**
   - `backend/src/app.ts:25-29` (`cors({ origin, credentials: true, allowedHeaders })` antes de qualquer rota).
   - No commit baseline, `app.ts:21` tinha `cors({ origin: env.corsOrigin })`, sem credenciais. A mudança veio na 3D.3.6. [EXEC: `git show HEAD:backend/src/app.ts`]
   - Docs: `backend/docs/orders-api.md:99-101` ("CORS com credenciais fica restrito à rota de pedidos; o catálogo público mantém seu comportamento").
   - Testes: `orders.test.ts:20` e `:35` (esperam ACAC true no POST e no preflight de pedidos); `access.test.ts:141-142`. Nenhum teste afirma o CORS do catálogo ou do health.
2. **Comportamento atual.** C1 a C3: catálogo, health e preflight do catálogo respondem com `Access-Control-Allow-Credentials: true`.
3. **Risco concreto.** Baixo. A origem permitida é um único valor fixo (nem refletida, nem curinga), então nenhum site de terceiro lê respostas com credenciais. O catálogo é público. O que existe é divergência de documentação e exposição maior que a necessária: qualquer endpoint público futuro herdaria CORS com credenciais sem decisão explícita.
4. **Impacto no frontend e nos testes.** As leituras do catálogo no frontend não usam credenciais (`readEnvelope`, `api.ts`, só `Accept`), então estreitar o escopo não as afeta. As chamadas que precisam de credenciais são `/api/admin/*`, `/api/comanda-sessions/*` e `/api/orders` (`getWithAuth` em `api.ts:245`).
5. **Correção mínima.** C1 (recomendada): corrigir `orders-api.md:99-101` para descrever o comportamento real (CORS com credenciais para a única origem configurada, em toda a API), sem alterar código. C2, se o escopo restrito for exigido: trocar o `cors` global por dois, um sem credenciais para `/api/health`, `/api/categories` e `/api/products`, e um com credenciais e `allowedHeaders` montado em `/api/admin`, `/api/comanda-sessions` e `/api/orders` (cerca de 6 linhas em `app.ts`).
6. **Testes de regressão (para C2).** (i) Catálogo e health sem ACAC. (ii) Pedidos e acesso mantêm ACAC true e os `allow-headers` atuais (as asserções existentes de `orders.test.ts:20,35` e `access.test.ts:141-142` continuam valendo). (iii) Preflight de rota não mapeada. (iv) Origem estrangeira sem permissão em ambos.
7. **Altera contrato?** C1 não. C2 altera apenas cabeçalhos de resposta de endpoints públicos, de forma não quebrante.

### 19.D Resumo e recomendação

| Divergência | Gravidade | Correção recomendada | Contrato |
|---|---|---|---|
| A. `X-Rustika-Request` ausente em pedidos | Baixa a média | A1: uma condição, doc e testes | Sim (header obrigatório) |
| B. Sem rate limit em pedidos | Média | Limite por IP folgado agora e chave por sessão depois | Aditivo (429) |
| C. CORS com credenciais global | Baixa | C1: corrigir a documentação | Não |

Nenhuma dessas implementações foi alterada. Decisão do usuário e do ChatGPT: A1 ou A2, os valores de B, e C1 ou C2.

---

## 20. Revisão das migrations

### 20.1 Checksums e fim de linha [EXEC]

| Migration | Bytes | CR / linhas | Termina em quebra de linha | SHA-256 do arquivo atual | SHA-256 se só os CR forem removidos |
|---|---|---|---|---|---|
| `20261023000000_initial_schema` | 5508 | 0 / 159 | sim | `1a9cd08b9d49fa9f70eabcceaa4a696f5aee07555f6a88562ec789340f0d3983` | igual |
| `20261027000000_rf004_comandas_catalogo_pedidos` | 8641 | 0 / 161 | sim | `05f583e854a87b77612c2f7d10a0a178ef45ea099d3237808b5bf0bd7c698122` | igual |
| `20261031000000_rf004_fix_permissions` | 1624 | 39 / 39 | sim | `960766a8fb1576e6094622f112e1a3a9cd7455f56907a3405a8fbb183959e10b` | `a94ea87327c5131775aede7de8355d2f3fd996ea5a1d86392014db5f91bee4fd` |
| `20261102000000_update_products_source_identity_constraint` | 710 | 12 / 13 | **não** | `885b8de5dcc0cf5e7618d574ba5c013ae8b60c9b983260706c5819422564454f` | `a07bf3b06ee771787c4dfed0a0de75a815fd676ccc3ba9769d18050c6048a8c3` |

Os dois SQL mais antigos estão em LF e commitados (`git ls-files --eol`: índice e pasta em LF). Os dois novos estão em CRLF, não commitados, e o último não termina em quebra de linha (a última linha não tem CR). Os checksums batem com os registrados na Parte I.

Por que importa: relatos públicos nos issues do Prisma descrevem que a diferença entre CRLF e LF muda o checksum e gera o aviso "migration was modified after it was applied" [WEB]. Não verifiquei esse comportamento na versão 6.19.3 do projeto, então a regra prática é tratar os bytes como parte do contrato da migration.

Política proposta, sem executar: (1) `.gitattributes` com `backend/prisma/migrations/**/*.sql text eol=lf` (seção 18.4); (2) antes da primeira aplicação em qualquer banco, converter os dois SQL novos para LF removendo apenas os CR, sem acrescentar a quebra de linha final (assim os hashes da última coluna acima valem); (3) só converter depois de consultar `_prisma_migrations` em Dev, porque, se Dev já registrou esses dois arquivos com os checksums CRLF, a conversão faria o Dev acusar modificação. Nada foi convertido.

### 20.2 `MAINTAIN` e a versão do PostgreSQL

- O privilégio `MAINTAIN` foi introduzido no PostgreSQL 17, junto com o papel predefinido `pg_maintain`; as notas de versão o descrevem como permissão por tabela para operações de manutenção como VACUUM, ANALYZE, REINDEX e CLUSTER [WEB: notas de versão do PostgreSQL 17].
- A migration `20261027` usa `REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN` (linha do primeiro `REVOKE`). Em servidor anterior à 17, o `REVOKE` falha por privilégio desconhecido. Como a migration tem `BEGIN`/`COMMIT` explícitos, o erro aborta a transação e nada é aplicado, mas o Prisma marca a migration como falha, e o `migrate resolve` está bloqueado pela política do projeto. Logo, a checagem de versão tem de vir antes do deploy. [INSP]
- Evidência de que o servidor é a versão 18 (compatível): o histórico informado cita `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe`, e `scripts/Invoke-Rf004InitialLab.ps1` usa como pré-condição `server_version_num = '180006'`. [HERD] Ambas são evidências históricas.
- **Pendente**: a versão do servidor Windows só se confirma com `SELECT current_setting('server_version_num');` rodado lá. Esperado: valor maior ou igual a `170000`.
- `ALTER TYPE ... ADD VALUE` dentro de transação é aceito desde a versão 12, então não é restrição adicional para 17 ou 18.

### 20.3 Impacto esperado das permissões depois das migrations (banco Test)

Efeito líquido para `cardapio_test_app` após `20261027` e `20261031` [INSP], confrontado com o que os endpoints fazem:

| Tabela | Privilégios resultantes | Operações exigidas pelo código | Situação |
|---|---|---|---|
| `admins` | SELECT | login, revalidação de sessão admin | ok |
| `categories` | SELECT | catálogo, elegibilidade de produto | ok |
| `products` | SELECT | catálogo, precificação de pedido | ok |
| `orders` | SELECT, INSERT | criar pedido, buscar replay | ok |
| `order_items` | SELECT, INSERT | itens do pedido | ok |
| `order_status_history` | SELECT, INSERT | primeiro evento do histórico | ok |
| `comandas` | SELECT, INSERT, UPDATE | upsert de comanda na emissão do convite | ok; ver nota 1 |
| `comanda_invitations` | SELECT, INSERT, UPDATE | criar, e `updateMany` de `consumed_at` no resgate | ok; ver nota 2 |
| `comanda_sessions` | SELECT, INSERT | criar sessão, validar sessão | ok; sem `UPDATE`, não há revogação pela aplicação |
| `_prisma_migrations` | nenhum | não usa | ok |
| sequência `orders_order_number_seq` | USAGE, SELECT | número do pedido | ok |

Notas:

1. `UPDATE` em `comandas` existe por causa de `upsert` com `update: {}` (`comandaAccess.service.ts`). Se o Prisma gerar `INSERT ... ON CONFLICT DO NOTHING` ou fizer leitura e criação, o `UPDATE` sobra e permitiria à aplicação alterar status e fechamento da comanda. Candidato a endurecimento, validável só com o banco real. Não é bloqueio.
2. Em `comanda_invitations`, só `consumed_at` é atualizado. Um `GRANT UPDATE (consumed_at)` por coluna seria suficiente. Também candidato a endurecimento.
3. `cardapio_dev_app` no banco Test: a primeira migration o revoga em pedidos, itens, histórico, tabelas novas e `_prisma_migrations`, e a segunda concede só à role-alvo do banco. Esperado: sem acesso nas tabelas novas.
4. `PUBLIC`: revogado em pedidos, itens, histórico, tabelas novas e `_prisma_migrations`. Nenhuma das duas migrations toca nos privilégios de `PUBLIC` em `admins`, `categories` e `products`. Conferir com `pg_default_acl` e `role_table_grants`.
5. Teste estático existente: `tests/scripts/fix-permissions-migration.test.ts` (11 testes) valida a segunda migration por expressões regulares sobre o texto (nenhum `GRANT` a `PUBLIC`, nenhum acesso a `_prisma_migrations`, matriz de tabelas). Ele não prova o efeito no banco.

Nada disso foi executado contra banco. `migrate deploy` não foi executado.

---

## 21. Disponibilidade das ferramentas PostgreSQL

Correção da Parte I: a Parte I tratou `pg_dump` e `pg_restore` como ausentes. Isso misturava três ambientes diferentes.

| Local | Situação | Classe |
|---|---|---|
| VM Linux desta sessão | `psql`, `pg_dump` e `pg_restore` ausentes. Irrelevante para a máquina do Windows | [EXEC] |
| Registro histórico recente | `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe` | [HERD] |
| `docs/security/initial-migration-acl-hardening.md` (23/10) | `PG_DUMP=False`, `PG_RESTORE=False`, no ambiente de execução daquela época; não prova ausência no Windows | [HERD] |
| Windows atual | Não verificado até receber a saída do roteiro da seção 16 | [NV] |

Regra de compatibilidade a verificar: o `pg_dump` usado deve ter a versão maior igual ou superior à do servidor.

---

## 22. Plano de fixtures para o banco Test

Tudo abaixo é plano. Nenhum registro foi criado, nenhuma role foi criada e nenhum script foi escrito.

### 22.1 Role de provisionamento (menor privilégio)

- `cardapio_test_app` não serve: precisa continuar só com os privilégios da seção 20.3. Conceder escrita nela contaminaria o teste.
- `cardapio_migrator` já existe e é dona das tabelas, mas também faz DDL; usá-la é a alternativa de contingência, só com autorização explícita e com a guarda de banco abaixo.
- **Alvo recomendado:** uma role nova e dedicada, por exemplo `cardapio_test_fixtures`, existente só para o banco `cardapio_digital_test`, criada mediante autorização (é alteração de role e de ACL). Privilégios mínimos: `CONNECT` em `cardapio_digital_test`; `USAGE` no schema `public`; `SELECT, INSERT` em `admins`, `categories`, `products`, `comandas`, `comanda_invitations`, `comanda_sessions`; `UPDATE` em `products`, `comandas`, `comanda_invitations`, `comanda_sessions` (preparar os cenários de preço alterado, comanda fechada, convite revogado e sessão revogada); `SELECT` em `orders`, `order_items`, `order_status_history` para verificação. Sem `CREATE`, sem `TRUNCATE`, sem acesso a `_prisma_migrations`, sem acesso a Dev e Shadow. Rollback: `REVOKE` dos grants e `DROP ROLE`.
- A limpeza entre rodadas deve ser por restauração do ponto de backup "migrado e limpo" (seção 23), e não por `DELETE` na role de fixtures.

### 22.2 Desenho da ferramenta de carga (futuro, fora do repositório de runtime)

- Script novo em `backend/scripts`, nunca importado por `src/`.
- Padrão de segurança igual ao de `prisma-run-policy.ts`: dry-run por padrão; escrita só com `--execute` e variável de confirmação própria; aborta se `current_database()` for diferente de `cardapio_digital_test`, se `current_user` for diferente da role esperada, ou se as tabelas não estiverem com as contagens esperadas.
- Uma única transação; ordem respeitando as chaves estrangeiras: admins, categorias, produtos, comandas, convites, sessões. Pedidos são criados pela API nos testes, não por carga direta.
- Identificadores determinísticos e marcador `fixture-3d37` nos nomes, para auditoria. Tokens de convite e de sessão gerados na hora, com apenas o SHA-256 gravado; os tokens em texto ficam só na memória da execução de teste.
- Senha do administrador: gerada na hora, hash por `hashPassword` (`src/security/password.ts`), entrada oculta, nunca em argumento, arquivo, log ou chat (`docs/admin-provisioning.md`).

### 22.3 Conteúdo das fixtures

| Entidade | Registros | Para cobrir |
|---|---|---|
| Administradores | 1 ativo, 1 inativo | Login válido e conta inativa; revalidação por `updatedAt` |
| Categorias | 1 pública ativa, 1 pública inativa, 1 sem `public_key` | Produto de categoria inativa ou não pública bloqueado |
| Produtos públicos | 1 `AVAILABLE`, 1 `UNAVAILABLE`, 1 `UNKNOWN`, 1 inativo, 1 para o cenário de preço alterado | Elegibilidade e `PRODUCT_UNAVAILABLE`, `PRICE_CHANGED` |
| Produto alfanumérico | `PA062240`, `rustika-PA062240`, R$ 50,00 (5000 centavos), `AVAILABLE`, nome "PANCETA / TORRESMO DE ROLO" | Códigos alfanuméricos e total de 5000 centavos |
| Produto com zero à esquerda | um código como `044` | Não converter códigos para número |
| Produtos internos | 2 com `public_key` e campos `source_*` nulos | Nunca expostos pela API pública e rejeitados no pedido |
| Comandas | 1 aberta para o fluxo normal, 1 fechada (`status = CLOSED` e `closed_at` preenchido), 1 aberta extra para acesso cruzado | `COMANDA_CLOSED`, isolamento entre comandas |
| Convites | criados pela API no fluxo normal; inseridos por carga: 1 expirado, 1 consumido, 1 revogado | Reuso, expiração, revogação |
| Sessões | criadas pelo resgate; inseridas por carga: 1 expirada, 1 revogada, 1 de comanda fechada | `INVALID_SESSION` em todos os estados |
| Pedidos | nenhum na carga | Criados pela API nos cenários da Parte I, seção 10 |

Cuidados das constraints: `AVAILABLE` exige preço maior que zero; `comandas.number` tem de ter 1 a 6 dígitos; `status = OPEN` exige `closed_at` nulo e os outros status exigem `closed_at` não nulo e maior ou igual a `opened_at`; convite e sessão exigem `expires_at > created_at`, e hashes com 64 hexadecimais; sessão exige convite da mesma comanda (chave composta).

### 22.4 Verificação depois da carga (futura)

Contagens por tabela, `convalidated` das constraints, e leitura via `cardapio_test_app` pela API (`/api/categories`, `/api/products`) conferindo que só os 5 produtos públicos elegíveis aparecem e que os internos não.

---

## 23. Plano de backup e recuperação (atualizado)

Mudanças em relação à seção 8: caminho das ferramentas e dois pontos de restauração. O restante vale como está. Nada foi criado nem restaurado.

1. Ferramentas: usar o `pg_dump`/`pg_restore` da versão do servidor (caminho histórico `C:\Program Files\PostgreSQL\18\bin`, a confirmar na seção 16).
2. **Ponto B0**, antes do deploy: banco Test só com a migration inicial, dump `-Fc --create`, SHA-256 do arquivo, `pg_restore --list` e teste de restauração em banco temporário, fora do OneDrive.
3. **Ponto B1**, depois do deploy e antes das fixtures: o banco "migrado e limpo". Serve de estado inicial de cada rodada de integração. Restaurar o B1 substitui qualquer limpeza por `DELETE`, e devolve as sequências ao estado original.
4. Recuperação: sem `migrate reset` e sem `migrate resolve`; aplicação parada; restauração em banco novo ou `--clean --if-exists` com autorização; depois repetir a auditoria de leitura.
5. Roles são do cluster e não vão no dump de um banco: registrar atributos e memberships por consulta, sem `pg_dumpall --roles-only` (grava hashes de senha).

---

## 24. Tarefas sugeridas: Claude Code e Codex

Regras de coordenação:

- Um branch e um worktree por tarefa (`git worktree add ..\rustika-<tarefa> -b task/<id>`), sem merge automático. Nenhuma tarefa começa antes da T1.
- Cada arquivo tem um único dono ativo (tabela abaixo). Duas tarefas nunca editam o mesmo arquivo ao mesmo tempo.
- Cada tarefa devolve um relatório no formato de 12 itens da política do projeto, e o usuário o leva ao ChatGPT antes de integrar.
- Nenhuma sessão Codex foi iniciada. Esta seção é só proposta.

Donos de arquivos:

| Arquivos | Dono |
|---|---|
| `backend/src/routes/order.routes.ts`, `backend/src/app.ts`, `backend/src/security/accessLimits.ts`, `backend/docs/orders-api.md`, `backend/docs/access-api.md`, `backend/tests/orders.test.ts` | T2 |
| `frontend/src/services/api.ts`, `frontend/src/pages/*`, `frontend/src/components/ComandaRedeem.tsx`, `frontend/tests/*` | T3 |
| `backend/docs/rf004-*.md`, `backend/docs/security/*`, `README.md`, `frontend/docs/*` | T4 |
| `backend/scripts/fixtures-test.ts`, `backend/tests/scripts/fixtures-test.test.ts` (novos) | T5 |
| `backend/tests/integration/**`, `backend/vitest.integration.config.ts` (novos), uma linha de script em `backend/package.json` | T6 |
| `backend/prisma/**`, `backend/config/**`, `.env`, `backend/src/services/**`, `backend/src/domain/**` | protegidos em todas as tarefas |

**T1. Proteção do trabalho no Git** (Claude Code)
- Objetivo: executar a estratégia da seção 18.4.
- Arquivos permitidos: metadados do Git, `.gitattributes` novo, `.gitignore`.
- Protegidos: conteúdo de qualquer arquivo de código, SQL, `.env`.
- Testes obrigatórios: clone temporário com `npm ci`, typecheck, testes e build passando; comparação de SHA-256 antes e depois (iguais, exceto fim de linha aprovado).
- Critérios de aceite: `git status` limpo salvo grupo E7; tag `baseline-3d37`; nenhum comando destrutivo no histórico.
- Riscos: conversão de fim de linha ao adicionar; planilha e JSONs num repositório sem política de visibilidade.
- Dependências: aprovação desta estratégia; decisão sobre o fim de linha das migrations.
- Autorização: sim, para branch, commits e criação do `.gitattributes`.

**T2. Correções de segurança A, B e C no backend** (Codex, em worktree)
- Objetivo: aplicar as correções escolhidas na seção 19.
- Arquivos permitidos: os da linha T2 da tabela de donos.
- Protegidos: migrations, serviços, domínio, frontend, scripts, configuração.
- Testes obrigatórios: os de regressão de 19.A, 19.B e 19.C; `npm test` (com `NODE_ENV=test` e `DB_PROFILE=app-test`), `npm run typecheck`, `npm run build`.
- Critérios de aceite: todos os testes anteriores e novos passando; `git diff --name-only` limitado aos arquivos permitidos; `orders-api.md` e `access-api.md` coerentes com o código, com linha de referência.
- Riscos: valores de limite mal calibrados para Wi-Fi compartilhado; ordem entre limite e leitura do corpo.
- Dependências: T1; decisões A1 ou A2, valores de B, C1 ou C2.
- Autorização: decisão de contrato do usuário. Não toca em banco.

**T3. Alinhamento do cliente HTTP do frontend** (Codex, depois de T7)
- Objetivo: `api.post` enviar `X-Rustika-Request: 1` e `credentials: 'include'` nas rotas de acesso; remover o uso de `Authorization` e `localStorage.adminToken`; tratar 429 com `Retry-After`; preparar o envio de pedido com `Idempotency-Key` UUID v4.
- Arquivos permitidos: os da linha T3.
- Protegidos: todo o `backend/`; componentes de catálogo já validados.
- Testes obrigatórios: os 43 testes atuais do frontend; novos testes para os headers, as credenciais e o 429; typecheck e build.
- Critérios de aceite: nenhuma mudança no catálogo; páginas de acesso continuam sem ligação ao `main.tsx` (ligar é decisão de produto, fora do escopo).
- Riscos: mocks que escondem diferença de contrato.
- Dependências: T2 (contrato do header) e T7 (persistência real validada em Test); a regra do projeto é não mexer no frontend durante a preparação das migrations.
- Autorização: sim, do usuário, para iniciar a fase de frontend.

**T4. Alinhamento da documentação** (Codex)
- Objetivo: tornar os docs fiéis ao código (permissões pós-migration `20261031`, estado da integração, ACL).
- Arquivos permitidos: os da linha T4.
- Protegidos: todo código e SQL, e os docs que a T2 possui.
- Testes obrigatórios: cada afirmação nova com arquivo e linha; links relativos válidos.
- Critérios de aceite: nenhuma contradição restante entre `rf004-onda-2.3c2-migration-offline.md` e as migrations.
- Riscos: baixo.
- Dependências: T2.
- Autorização: não.

**T5. Ferramenta de carga de fixtures** (Claude Code)
- Objetivo: escrever o script da seção 22.2 e seus testes, sem executá-lo.
- Arquivos permitidos: os dois arquivos novos da linha T5.
- Protegidos: `src/`, `prisma/`, `config/`, scripts existentes.
- Testes obrigatórios: testes com mocks das guardas (banco errado, role errada, contagens inesperadas, ausência de `--execute`, ausência da variável de confirmação), ordem das inserções, determinismo dos IDs; typecheck e build.
- Critérios de aceite: dry-run sem escrita; nenhuma importação a partir de `src/`.
- Riscos: é um caminho de escrita em banco; deve falhar fechado.
- Dependências: T1 e a decisão da role (22.1).
- Autorização: escrever o código não exige; executá-lo exige autorização explícita.

**T6. Testes de integração contra Test** (Claude Code)
- Objetivo: implementar a matriz de cenários da Parte I, seção 10, num harness separado do `npm test`.
- Arquivos permitidos: os da linha T6.
- Protegidos: testes existentes, `src/`.
- Testes obrigatórios: o próprio harness, com guarda que se recusa a rodar fora de `NODE_ENV=test` e `app-test`, e pula quando as variáveis não existem.
- Critérios de aceite: todos os cenários documentados com evidência de persistência e de rollback; relatório com as saídas.
- Riscos: dependência de dados privilegiados (R8, R9); ordem entre cenários.
- Dependências: T7 (migrations aplicadas), T8 (fixtures), T5, T2.
- Autorização: sim, para conectar ao Test e gravar pedidos.

**T7. Aplicação das migrations em Test** (Claude Code com o usuário)
- Objetivo: seguir o runbook das seções 8 e 9 da Parte I.
- Arquivos permitidos: nenhum arquivo de código. Só o comando existente do projeto.
- Protegidos: tudo.
- Testes obrigatórios: verificação pós-execução da seção 9.4.
- Critérios de aceite: quatro linhas em `_prisma_migrations` com `finished_at`; checksums conferem; grants conforme 20.3.
- Riscos: seção 6 (R2, R4, R5, R6).
- Dependências: seção 25 inteira.
- Autorização: sim, texto explícito para o `deploy`.

**T8. Provisionamento da role e das fixtures** (usuário ou Claude Code, SQL aprovado)
- Objetivo: criar a role de 22.1 e executar a carga de T5.
- Arquivos permitidos: nenhum de código; SQL revisado antes.
- Protegidos: Dev e Shadow.
- Testes obrigatórios: verificação de 22.4.
- Critérios de aceite: contagens e constraints válidas; ponto B1 criado antes da carga.
- Riscos: alteração de ACL.
- Dependências: T5, T7.
- Autorização: sim, separada para criar role e para gravar dados.

**T9. Plano de ACL para Dev** (Claude Code, primeiro só leitura)
- Objetivo: mapear as operações reais da aplicação e propor o conjunto mínimo de privilégios de `cardapio_dev_app`, com rollback.
- Arquivos permitidos: um documento novo em `backend/docs/`.
- Protegidos: bancos e código.
- Testes obrigatórios: `inspect-dev.sql` rodado e comparado com a matriz da seção 20.3.
- Critérios de aceite: plano aprovado antes de qualquer `GRANT` ou `REVOKE`.
- Riscos: tirar de Dev um privilégio que um script operacional usa.
- Dependências: T1.
- Autorização: sim, para consultar Dev; outra, separada, para qualquer alteração.

Ordem sugerida: T1, depois T2, T5 e T9 em paralelo (arquivos disjuntos), depois T7, T8, T6, T3 e T4.

---

## 25. Bloqueadores da próxima execução

Para aplicar as migrations em Test (T7):

1. Saídas do Windows da seção 16 recebidas e comparadas.
2. Trabalho protegido no Git ou em cópia externa (T1, passo 1 no mínimo).
3. Decisão sobre o fim de linha dos dois SQL novos e, se for converter, consulta de leitura a `_prisma_migrations` em Dev antes.
4. `server_version_num` maior ou igual a 170000 confirmado no servidor Windows.
5. Auditoria de leitura do banco Test (Parte I, seção 4.3): `orders` vazia, roles presentes, sem migrations falhas, sem sessões ativas de `cardapio_test_app`.
6. Ferramentas `pg_dump` e `pg_restore` confirmadas e backup B0 verificado, com teste de restauração.
7. Autorização escrita e específica para `npm run db:migrate:deploy:test`.

Para os testes de integração, além dos itens acima: decisões A, B e C da seção 19, role de fixtures aprovada (22.1) e autorização para gravar em Test.

---

## 26. Registro da 3D.3.7-G

Comandos executados nesta etapa, todos de leitura, na VM e dentro da pasta montada do projeto:

| Comando (resumo) | Finalidade |
|---|---|
| `git status --short`, `git ls-files --others --exclude-standard`, `git diff --numstat`, `git diff --ignore-cr-at-eol --numstat`, `git ls-files --eol`, `git check-attr`, `git remote -v`, `git show HEAD:backend/src/app.ts`, `git log -1` | Inventário e comparação com o baseline |
| `sha256sum -c` contra o baseline de 190 arquivos | Confirmar que nenhum arquivo do projeto mudou (0 divergências) |
| `grep`, `sed -n`, `cat`, `wc`, `stat`, `tr`, `xxd` | Linhas de código e docs, fim de linha, checksums |
| `tsc -p tsconfig.build.json --noEmit --listFilesOnly` (backend) e `tsc -p tsconfig.json --noEmit --listFilesOnly` (frontend) | Lista de arquivos compilados |
| `node demo.js` (script em pasta temporária fora do projeto) contra `dist/app.js` | Demonstração de A, B e C. A primeira tentativa falhou porque o backend procura `config/database-profiles.json` a partir do diretório corrente; a segunda, com a raiz simulada, funcionou |
| Duas buscas na web | Introdução do `MAINTAIN` no PostgreSQL 17 e relatos sobre checksum e fim de linha no Prisma |

Não executados: `prisma migrate deploy` e `status`, Seed, qualquer `psql`, `pg_dump`, `pg_restore`, leitura de `.env` ou de arquivos de segredos, qualquer comando Git que escreva (`add`, `commit`, `reset`, `clean`, `restore`, `checkout`).

Arquivos alterados: apenas `RELATORIO-ENTREGA-3D.3.7.md`. Os arquivos temporários do demo e das listas ficaram fora do projeto e são descartáveis.

Estado do Git ao fim: branch `main`, commit `1e80bdb`, 13 modificados e 104 não rastreados (o mesmo conjunto da abertura da etapa, mais este relatório já contado). Nenhum commit criado.

---

## 27. Parecer final

A 3D.3.7 continua **pendente de validação no Windows** e **sem autorização para aplicar migrations**.

O que esta etapa fechou: inventário completo do Git com classificação por função e uma estratégia de versionamento para aprovação; as três divergências de segurança demonstradas por execução, com linhas, risco, impacto, correção mínima e testes de regressão (A de gravidade baixa a média, B média, C baixa); checksums conferidos, com a diferença de fim de linha das duas migrations novas e o plano para tratá-la; a compatibilidade do `MAINTAIN` (PostgreSQL 17 ou superior) com o indício histórico de servidor 18, pendente de confirmação; o impacto esperado das permissões; o plano de fixtures com a role de menor privilégio; a divisão de tarefas entre Claude Code e Codex sem arquivos em comum.

O que continua aberto: todas as saídas do Windows (typecheck, 440/440, status das migrations, ferramentas PostgreSQL, versão do servidor); a auditoria de leitura do banco Test; o backup B0 verificado; e a decisão do usuário sobre Git, fim de linha, contrato A, valores de B e escopo de C.

Uma correção de rumo ficou registrada: a Parte I afirmava que `pg_dump` e `pg_restore` estavam ausentes. A ausência vale só para a VM Linux e para o registro de 23/10; no Windows a disponibilidade segue desconhecida até a saída do roteiro.

Nenhuma fase seguinte foi iniciada. Aguardo a revisão do usuário com o ChatGPT.


---

# PARTE III: ENTREGA 3D.3.7-H

Fechamento de evidências Windows e proteção do repositório

Data: 03/11/2026 (America/Sao_Paulo)
Executor: Claude Code, **desta vez rodando nativamente no Windows 11** (PowerShell 5.1 e Git Bash), e não na VM Linux das Partes I e II. Por isso várias pendências "só no Windows" foram fechadas por execução.
Escopo: leitura e execução de testes. Nenhuma migration, nenhum Seed, nenhuma escrita em banco, nenhuma fixture, nenhuma alteração de role, ACL, credencial, `.env`, código, `.gitignore` ou `.gitattributes`. Nenhum `git add`, `commit`, `reset`, `clean` ou `push`.

Legenda da Parte III (substitui a da Parte I nesta parte):

- **[EXEC]** Confirmada nesta execução (Windows, 03/11/2026)
- **[INSP]** Confirmada por inspeção de código, arquivo ou configuração
- **[HERD]** Herdada de execução anterior, não reconfirmada
- **[PEND-W]** Pendente de validação no Windows pelo usuário (exige credencial ou autorização)

---

## 28. Estado de evidências do Windows

Ambiente: Windows 11 Home 10.0.26200, Node v24.20.0, npm 12.2.0, Git 2.55.0.windows.3, PowerShell 5.1. [EXEC]

| # | Item | Resultado histórico | Resultado nesta execução | Classe |
|---|---|---|---|---|
| W1 | `npm run typecheck` (backend) | 0 erros (VM Linux) | **Exit 0, 0 linhas `error TS`**, ~10 s. Executado 2 vezes | [EXEC] |
| W2 | `npm test` com `NODE_ENV=test`, `DB_PROFILE=app-test` | 440/440, 20 arquivos [HERD] | **20 arquivos aprovados, 440/440 testes aprovados**, ~30 s, exit 0. Executado 2 vezes | [EXEC] |
| W3 | `npm run db:migrate:status:test` | 1 aplicada, 3 pendentes | Banco `cardapio_digital_test` em `127.0.0.1:5432`; "4 migrations found"; não aplicadas: `20261027000000`, `20261031000000`, `20261102000000`; nenhuma falha, nenhum aviso de modificação. Exit 1, que é o código normal do Prisma quando há pendências | [EXEC] |
| W4 | `pg_dump.exe` | caminho histórico `...\18\bin` | `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe` → **pg_dump (PostgreSQL) 18.6** | [EXEC] |
| W5 | `pg_restore.exe` | não confirmado | **pg_restore (PostgreSQL) 18.6**, mesmo diretório | [EXEC] |
| W6 | `psql.exe`, `postgres.exe` | | ambos 18.6. Nenhum dos quatro está no `PATH`; usar caminho completo | [EXEC] |
| W7 | Serviço do servidor | | `postgresql-x64-18`, Running, início automático, `-D "C:\Program Files\PostgreSQL\18\data"`; `PG_VERSION` = 18; `port = 5432` (bate com o datasource do Prisma) | [EXEC] |
| W8 | Versão exata do servidor por SQL (`server_version_num`) | | Não consultada: exige senha. A versão maior 18 está confirmada pelo diretório de dados do serviço em execução, o que já satisfaz `>= 170000` para o `MAINTAIN` | [INSP] major 18; [PEND-W] valor exato |
| W9 | Checksums das 4 migrations | seção 20.1 | Os 4 SHA-256 conferem byte a byte com as seções 5 e 20.1 | [EXEC] |
| W10 | `core.autocrlf` | "indefinido" (Parte I, VM) | **`true`**, definido em `C:/Program Files/Git/etc/gitconfig` (nível sistema). Ver seção 35 | [EXEC] |
| W11 | Estado de `_prisma_migrations` (checksum gravado da inicial), contagem de `orders`, roles, sessões ativas | [HERD] | Não consultado: exige senha de `cardapio_migrator` | [PEND-W] |
| W12 | Restauração testada de backup | | Não executado: exige autorização (cria banco temporário) | [PEND-W] |
| W13 | Typecheck, testes e build do frontend | 43 testes [HERD] | Não executado nesta entrega (fora do escopo pedido) | [HERD] |
| W14 | `npm run build` e `npm run db:validate` do backend | | Não executados: `build` regrava `dist/`, e foi pedido evitar escritas persistentes. `validate` não foi pedido | [HERD] |

Efeito colateral dos testes: o Vitest pode gravar cache em `node_modules/.vite`/`.vitest`, que é ignorado pelo Git. Nenhum arquivo versionado ou não ignorado mudou (seção 39). [EXEC]

O que depende do Windows e **não** pode ser feito na VM Linux (registro pedido no item 2 da entrega): Vitest (binário nativo `rolldown` só existe para Windows no `node_modules`), engine do Prisma (`prisma validate`, `migrate status`), acesso ao PostgreSQL local em `127.0.0.1:5432`, ferramentas `pg_dump`/`pg_restore`/`psql`, configuração de sistema do Git (`autocrlf`), serviço e diretório de dados do PostgreSQL. Nesta execução, rodando no Windows, só ficaram pendentes os itens que exigem credencial ou autorização (W8 exato, W11, W12).

---

## 29. Roteiro PowerShell preparado

Arquivo: [`Invoke-Validacao-3D37H.ps1`](Invoke-Validacao-3D37H.ps1), na raiz do projeto, não rastreado. Texto em ASCII para não depender de BOM no PowerShell 5.1.

Uso:

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital
powershell -ExecutionPolicy Bypass -File .\Invoke-Validacao-3D37H.ps1
powershell -ExecutionPolicy Bypass -File .\Invoke-Validacao-3D37H.ps1 -ConsultarServidor
```

| Etapa | O que faz | Escrita? |
|---|---|---|
| Guardas | Aborta se `CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION` existir na sessão; aborta se a raiz não tiver `backend\package.json` | não |
| 1. Identidade | Nome e versão do pacote, Prisma, Node, npm, branch, HEAD, remote, contagens do `git status`, `core.autocrlf` com origem, presença de `.gitattributes` (todos com `GIT_OPTIONAL_LOCKS=0`) | não |
| 2. PostgreSQL | `--version` de `pg_dump`, `pg_restore`, `psql`, `postgres`; serviço; `PG_VERSION` do diretório de dados, com alerta se < 17 | não |
| 3. Migrations | Bytes, contagem de CR e LF, quebra final, SHA-256 comparado com a tabela da seção 20.1, `git ls-files --eol` | não |
| 4. Typecheck | `npm run typecheck`, exit code e contagem de `error TS` | não |
| 5. Testes | `npm test` com `NODE_ENV=test` e `DB_PROFILE=app-test`, restaurando as variáveis anteriores em `finally` | só cache ignorado |
| 6. Status | `npm run db:migrate:status:test`; verifica banco Test, 3 pendentes citadas, ausência de `failed`/`modified after`/`drift` | não (leitura de `_prisma_migrations`) |
| 7. Opcional `-ConsultarServidor` | `psql` com `PGOPTIONS=-c default_transaction_read_only=on` e `ON_ERROR_STOP`: versão exata, linhas de `_prisma_migrations` com checksum, contagens, atributos das roles, sessões ativas por usuário | não; o servidor recusa escrita na sessão |

Proteção de dados sensíveis: a senha nunca é argumento (o `psql` pede com entrada oculta ou usa o pgpass do usuário); URLs `postgres://usuario:senha@` e pares `password=`/`token=` são mascarados antes de imprimir; o `.env` não é lido pelo roteiro (o Prisma o carrega internamente, e o `prisma-run.ts` já redige a saída); nada é salvo em disco.

Validação do próprio roteiro: parser do PowerShell sem erros e uma execução completa sem `-ConsultarServidor`, com todos os itens OK e "Consultas read-only no Test" como PENDENTE. [EXEC]

O que o usuário ainda precisa rodar: somente a etapa 7 (`-ConsultarServidor`), que fecha W8 e W11. Esperado: `versao_num >= 170000`; 1 linha em `_prisma_migrations` (`20261023000000_initial_schema`, checksum `1a9cd08b…0d3983`, concluída, não revertida); `orders` = 0; nenhuma sessão de `cardapio_test_app`.

---

## 30. Inventário Git consolidado

Estado no início desta execução [EXEC], idêntico ao registrado na seção 18:

| Item | Valor |
|---|---|
| Branch | `main` |
| Commits | 1 (`1e80bdb chore: baseline inicial do projeto RUSTIKA`) |
| Remote | nenhum |
| Entradas no `git status --short` | 117: 13 ` M` e 104 `??` |
| Arquivos não rastreados expandidos | 117 (inclui este relatório) |
| `.gitattributes` | não existe |
| `core.autocrlf` | `true` (sistema) |
| Ignorados presentes | `backend/.env`, `backend/dist/`, `frontend/dist/`, `recovery-run.log`, `node_modules/` |

Ao fim desta execução: 118 não rastreados (os 117 mais `Invoke-Validacao-3D37H.ps1`), mesmos 13 modificados. [EXEC]

Validação do inventário da seção 18.2: as contagens por grupo (E1 21, E2 28, E3 5, E4 21, E5 1, E6 35, E7 6) somam 117 e a distribuição por pasta confere (raiz 33, `backend/scripts` 21, `backend/src` 15, `backend/tests` 16, `frontend/src` 10, `frontend/tests` 6, `backend/docs` 4, relatórios em `backend/` 6, `backend/prisma` 2, demais 1 cada). [EXEC para contagens, INSP para a classificação]

Triagem de sensíveis nos 129 arquivos candidatos (não rastreados e modificados, exceto a planilha) [EXEC, só triagem]:

- Padrões de segredo (URL com senha, chave privada, `password|secret|token = '<8+ caracteres>'`): 3 ocorrências, todas valores fictícios de teste em `backend/tests/access.test.ts:87` e `backend/tests/scripts/inspect-reconciliation.test.ts:385,398` (casos que verificam justamente a redação de segredos).
- E-mails: apenas `@example.com` e `@example.test`.
- Sequências que pareciam telefone: são códigos EAN de produtos.
- Nenhum arquivo com nome de segredo (`secret`, `cred`, `pgpass`, `.env`, `key`) entre os candidatos.
- A planilha `backend/data/Exportacao-produtos.xlsx` não foi aberta; é dado de negócio (catálogo) e precisa de decisão de visibilidade.

A triagem não é garantia: só a revisão humana do diff antes de cada commit fecha esse ponto.

---

## 31. Estratégia proposta de checkpoint

Revisa a seção 18.4 à luz do `core.autocrlf=true` (seção 35). Nada foi executado.

### 31.1 Por que a ordem importa

Com `autocrlf=true` e sem `.gitattributes`:

1. `git add` converte CRLF em LF no índice. Os dois SQL novos entrariam no repositório com bytes diferentes dos que estão no disco.
2. Um clone ou checkout nesta máquina grava **todos** os arquivos de texto com CRLF, inclusive as duas migrations antigas. O SHA-256 de `20261023000000_initial_schema` passaria de `1a9cd08b…0d3983` (gravado no Test, [HERD]) para `fd781a6b…44d495`, e o Prisma acusaria migration modificada depois de aplicada. Simulado por cálculo nesta execução [EXEC].
3. Um `deploy` feito da pasta atual gravaria os checksums CRLF dos dois SQL novos; um `deploy` feito de um clone gravaria outros. Duas cópias "iguais" do projeto dariam resultados diferentes.

Conclusão: o `.gitattributes` tem de existir **antes** do primeiro `git add` de qualquer migration, e a prova por clone (passo 6 abaixo) só tem valor depois dele.

### 31.2 Política de fim de linha recomendada (substitui a proposta da seção 20.1)

Preservar os bytes atuais de todas as migrations, sem conversão:

```gitattributes
* text=auto
backend/prisma/migrations/** -text
*.ps1 text eol=crlf
*.xlsx binary
```

`-text` desliga qualquer conversão de fim de linha para as migrations. Efeito: as duas antigas continuam LF, as duas novas continuam CRLF, e todo clone recebe exatamente os bytes cujos SHA-256 estão na seção 20.1. Isso atende "não converter LF/CRLF" e elimina a dependência de consultar o Dev antes de converter. O custo é cosmético (fim de linha misto dentro da pasta de migrations).

A alternativa da Parte II (`eol=lf` e remover os CR dos dois SQL novos) continua válida, mas altera arquivos e só é segura depois de ler `_prisma_migrations` em Dev (R5). Fica como opção, não como recomendação.

### 31.3 Sequência proposta (aguarda aprovação)

1. **Cópia externa**, fora do OneDrive, sem `node_modules`, `dist` e `.env`:
   ```powershell
   robocopy C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital C:\Backups\rustika\arvore-20261103 /E /XD node_modules dist /XF .env
   ```
   Depois, `Get-FileHash` das 4 migrations na cópia e comparação com a seção 20.1.
2. **Branch**: `git switch -c chore/checkpoint-3d37`.
3. **C1, política**: só o `.gitattributes` da 31.2. Antes de commitar, `git check-attr -a -- backend/prisma/migrations/20261031000000_rf004_fix_permissions/migration.sql` deve mostrar `text: unset`.
4. **Commits por grupo, sempre com caminhos explícitos** (nunca `git add .` ou `-A`), revisando `git diff --cached --stat` e o conteúdo antes de cada commit:

   | Commit | Conteúdo | Arquivos |
   |---|---|---|
   | C2 | Migrations novas | `backend/prisma/migrations/20261031000000_rf004_fix_permissions/migration.sql`, `backend/prisma/migrations/20261102000000_update_products_source_identity_constraint/migration.sql`. Depois do commit: `git ls-files --eol` deve mostrar `i/crlf w/crlf attr/-text` e o SHA-256 no disco continua o da seção 20.1 |
   | C3 | Backend essencial (E1) e modificados do backend | `backend/src/app.ts`, `backend/src/domain/rules.ts`, `backend/src/middleware/errorHandler.ts`, `backend/src/domain/orderInput.ts`, `backend/src/mappers/catalog.mapper.ts`, `backend/src/mappers/order.mapper.ts`, `backend/src/routes/access.routes.ts`, `backend/src/routes/catalog.routes.ts`, `backend/src/routes/order.routes.ts`, `backend/src/security/accessLimits.ts`, `backend/src/security/adminSessions.ts`, `backend/src/security/password.ts`, `backend/src/services/adminAuth.service.ts`, `backend/src/services/catalog.service.ts`, `backend/src/services/comandaAccess.service.ts`, `backend/src/services/order.service.ts`, `backend/src/services/orderSession.ts` |
   | C4 | Testes e contratos do backend (E2) | `backend/src/domain/categoryPublication.ts`, `backend/tests/domain/rules.test.ts`, `backend/tests/health.test.ts`, `backend/tests/access.test.ts`, `backend/tests/catalog.test.ts`, `backend/tests/categoryPublication.test.ts`, `backend/tests/orders.test.ts`, `backend/tests/fixtures/{access,catalog,orders}.ts`, `backend/tests/services/{access,catalog,order}.service.test.ts`, `backend/tests/scripts/fix-permissions-migration.test.ts`, `backend/docs/{access-api,admin-provisioning,catalog-api,orders-api}.md` |
   | C5 | Frontend essencial (E1), modificados e testes | `frontend/package.json`, `frontend/src/App.tsx`, `frontend/src/components/{Catalog,ConnectionIndicator,ProductCard,ProductModal,CatalogStatus}.tsx`, `frontend/src/services/{api,catalogAdapter,catalogSource,catalogStore}.ts`, `frontend/src/types/catalog.ts`, `frontend/src/hooks/useCatalog.ts`, `frontend/tests/*.mjs` (6), `frontend/docs/catalog-integration.md` |
   | C6 | Frontend ainda não ligado (E3) | `frontend/src/AppWrapper.tsx`, `frontend/src/components/ComandaRedeem.tsx`, `frontend/src/pages/{AdminLogin,AdminDashboard,Checkout}.tsx` (mensagem do commit deve dizer que não estão ligados ao `main.tsx` e que o cliente HTTP deles ainda não funciona contra o backend real, seção 33.D) |
   | C7 | Scripts operacionais (E4) e seus testes | os 21 de `backend/scripts/` listados na seção 18.2 e `backend/tests/scripts/{executor-seed-real,inspect-reconciliation,seed-dev,seed-real-corrected,seed-real}.test.ts`. Mensagem deve citar que `executor-seed-real.ts` e `publish-category-publication.ts` têm `--execute` contra Dev. Os 5 testes de scripts ficam aqui, e não em C4, porque importam esses scripts; C4 e C7 juntos sustentam o 440/440 |
   | C8 | Histórico (E6) | os 27 relatórios `RELATORIO-ENTREGA-*.md` não rastreados (21 na raiz, incluindo este, e 6 em `backend/`) e `Invoke-Validacao-3D37H.ps1` |
   | fora | Dados (E5) e reconciliação | `backend/data/Exportacao-produtos.xlsx`, `ambiguidades.json`, `mapeamento.json`, `mapeamento-25-produtos.json`, `produtos_banco.json`, `reconciliation-output.json`, `validacao-vinculos.json`, `analise-fechamento.txt`, `dry-run-recovery.txt`: só entram se o remote for privado e o usuário aprovar; até lá, ficam fora e protegidos pela cópia externa do passo 1 |
   | fora | Resíduos (E7) | `$testRunner`, `backend/changes.diff`, `backend/vitest-report.json`, `ausentes.json`, `sem_correspondencia.json`, `candidatos.json`: decisão do usuário entre arquivar fora do repositório ou acrescentar ao `.gitignore` em commit próprio |

5. **Verificação entre commits**: depois de C3 a C7, `git status --short` deve conter apenas os grupos "fora" e nenhum arquivo de `src/`, `tests/` ou `prisma/`.
6. **Prova de reprodutibilidade**: `git clone` local para uma pasta fora do OneDrive, `npm ci` no backend e no frontend, e nela: `npm run typecheck`, `npm test` (com o perfil de teste), `npm run build`; no frontend, typecheck, testes e build; e SHA-256 das 4 migrations no clone igual ao da seção 20.1. Só então a tag `checkpoint-3d37`.
7. **Remote privado**: decisão do usuário (provedor, visibilidade). Nenhum `push` antes disso.

Condições de parada do checkpoint: qualquer SHA-256 de migration diferente depois do `add` ou no clone; qualquer aviso `CRLF will be replaced` ou `LF will be replaced` em arquivo de `backend/prisma/migrations/`; qualquer arquivo de E5/E7 aparecendo em `git diff --cached`; teste ou typecheck falhando no clone.

---

## 32. Arquivos essenciais ainda não rastreados

Conferido nesta execução: os 21 arquivos do grupo E1 continuam fora do Git (`git ls-files` vazio para cada um). [EXEC]

| Área | Arquivos | Quem depende |
|---|---|---|
| Backend `src` (14) | `domain/orderInput.ts`; `mappers/catalog.mapper.ts`, `order.mapper.ts`; `routes/access.routes.ts`, `catalog.routes.ts`, `order.routes.ts`; `security/accessLimits.ts`, `adminSessions.ts`, `password.ts`; `services/adminAuth.service.ts`, `catalog.service.ts`, `comandaAccess.service.ts`, `order.service.ts`, `orderSession.ts` | `app.ts` versionado |
| Migrations (2) | `20261031000000_rf004_fix_permissions/migration.sql`, `20261102000000_update_products_source_identity_constraint/migration.sql` | `migrate deploy` |
| Frontend (5) | `components/CatalogStatus.tsx`, `hooks/useCatalog.ts`, `services/catalogStore.ts`, `catalogSource.ts`, `catalogAdapter.ts` | `App.tsx` versionado |

Observação: `backend/src/routes/` tem também `health.routes.ts`, já rastreado no baseline; por isso a pasta mostra 3 não rastreados e 1 rastreado. Dos 15 não rastreados de `backend/src`, 14 são E1 e `domain/categoryPublication.ts` é E2 (usado só por scripts e testes). E1 = 14 + 2 + 5 = 21, como na seção 18.2. [EXEC]

---

## 33. Riscos de segurança pendentes e contratos a corrigir

Nada abaixo foi implementado. As linhas foram reconfirmadas nesta execução. [INSP]

### 33.A Header `X-Rustika-Request` em `POST /api/orders`

- Situação: `backend/src/routes/order.routes.ts:15-20` exige Origin exata, JSON, sem query, cookie e `Idempotency-Key`, mas não `X-Rustika-Request`. As rotas de acesso exigem (`access.routes.ts:31-35`).
- **Contrato proposto (A1, recomendado):** todo `POST`, `PUT`, `PATCH` e `DELETE` sob `/api` com cookie exige, nesta ordem: `Origin` igual a `CORS_ORIGIN` → 403 `ORIGIN_NOT_ALLOWED`; `X-Rustika-Request: 1` (valor exato) → 403 `ORIGIN_NOT_ALLOWED`; `Content-Type: application/json` → 415. Em `/api/orders` acrescenta-se `Idempotency-Key` UUID v4 → 400.
- Pontos de alinhamento, todos a alterar juntos numa única tarefa:

| Camada | Arquivo | Mudança |
|---|---|---|
| Backend | `backend/src/routes/order.routes.ts:15-16` | Checar o header junto com o Origin; idealmente extrair o `writeGuard` de `access.routes.ts` para `backend/src/security/` e reutilizar nas duas rotas |
| Docs | `backend/docs/orders-api.md:54-59, 99` e `backend/docs/access-api.md:31-39` | Mesma lista de requisitos e ordem dos erros nos dois documentos |
| Testes backend | `backend/tests/orders.test.ts:9-10` (helper) e `:121` | Helper envia o header; novos casos sem header, `0`, `true`, vazio |
| Frontend | `frontend/src/services/api.ts:224-238` | `post` envia `X-Rustika-Request: 1` (ver 33.D) |
| Testes frontend | `frontend/tests/checkout.test.mjs` | Afirmar os headers enviados ao `fetch` simulado |

### 33.B Rate limiting de pedidos

Política proposta, pensando em clientes que dividem o IP do Wi-Fi do estabelecimento:

| Camada | Chave | Limite inicial (hipótese, a calibrar) | Motivo |
|---|---|---|---|
| L1 Sessão | SHA-256 do cookie `rustika_session` já validado em formato | 10 pedidos por 5 min | Limita abuso de quem tem sessão válida sem afetar outras mesas |
| L2 Falhas de sessão | IP, contando só respostas 401 `INVALID_SESSION` | 30 por 5 min | Corta varredura com cookies inventados sem penalizar quem está autenticado |
| L3 Teto de IP | IP | 300 por 5 min | Rede de proteção larga; comporta dezenas de mesas no mesmo NAT |

Regras:

- O limitador roda antes do `express.json` (já é a posição das guardas), para que um IP limitado receba 429 e não 413.
- `Retry-After` em toda 429; `orders-api.md` ganha a linha 429 `TOO_MANY_REQUESTS`.
- `accessLimit` (`backend/src/security/accessLimits.ts:5-21`) precisa de um parâmetro opcional de função de chave e de uma regra de capacidade: hoje, com 10000 chaves ativas, **toda chave nova recebe 429** (linha 13), o que vira bloqueio geral de clientes legítimos. Para L1 e L3 o correto é descartar a entrada mais antiga, não recusar a nova.
- `trust proxy`: não existe hoje (`grep` sem ocorrência). Atrás de proxy, L2 e L3 colapsam num único balde. Configurar só por variável de ambiente com número de saltos explícito (nunca `true`), na fase de produção.
- Limites são por processo; com mais de uma instância, store compartilhado (fase de produção).
- Testes: os seis de 19.B, mais: sessões diferentes no mesmo IP não se bloqueiam; 401 repetidos do mesmo IP chegam a 429 sem afetar uma sessão válida desse IP; capacidade cheia não bloqueia chave nova.

### 33.C CORS com credenciais global

- Reconfirmado: `backend/src/app.ts:25-29`, `credentials: true` para todas as rotas.
- Avaliação de risco concreto: **nenhum identificado**. A origem é um valor único; `CORS_ORIGIN` sem validação (`backend/src/config/env.ts:40`) falha fechado nos casos ruins, porque `*` com credenciais é recusado pelo navegador e as guardas comparam o Origin por igualdade exata (todo POST viraria 403). O catálogo não lê cookie.
- **Decisão recomendada: corrigir a documentação (C1)** em `backend/docs/orders-api.md:99-101`, sem mudar código agora. Levar para a fase de produção: (i) validar `CORS_ORIGIN` na inicialização (uma única origem `http(s)://host[:porta]`, sem `*`, sem vírgula, `https` obrigatório em produção); (ii) C2, CORS com credenciais só em `/api/admin`, `/api/comanda-sessions` e `/api/orders`.

### 33.D Cliente HTTP do frontend

Achados reconfirmados [INSP]:

| Problema | Local | Efeito contra o backend real |
|---|---|---|
| `post` não envia `credentials: 'include'` | `frontend/src/services/api.ts:224-238` | Em origem diferente (`5173` → `4000`), o navegador não grava o cookie do login nem envia o cookie em logout, convite, resgate e pedido |
| `post` não envia `X-Rustika-Request: 1` | mesmo trecho | Login, logout, convite e resgate recebem 403 |
| `getWithAuth` envia `Authorization: Bearer` de `localStorage.adminToken` | `api.ts:241-245` | O backend nunca emite esse token e `Authorization` não está em `allowedHeaders`: o preflight falha quando o token existe. Token em `localStorage` também contraria o desenho de cookie HttpOnly |
| Erros não expõem status nem `Retry-After` | `api.ts:236`, `errorMessage` | A interface não distingue 401, 409, 429 |
| Não há envio de pedido | nenhuma ocorrência de `/orders` ou `Idempotency-Key` em `frontend/src` | Checkout não integrado |

Arquivos que precisarão ser alterados (mapa, sem implementação):

1. `frontend/src/services/api.ts`: `post` com `credentials: 'include'` e `X-Rustika-Request: 1`; `getWithAuth` sem `Authorization` e sem `localStorage`; erro tipado com `status`, `code` e `retryAfter`; função `createOrder(body, idempotencyKey)`.
2. `frontend/src/pages/AdminLogin.tsx:13, 28`, `frontend/src/pages/AdminDashboard.tsx:12, 25`, `frontend/src/components/ComandaRedeem.tsx:15, 33`: tratamento dos novos erros; nenhuma mudança de chamada se o cliente passar a fazer o certo por padrão.
3. `frontend/src/pages/Checkout.tsx`: geração da `Idempotency-Key` (UUID v4) uma vez por tentativa de envio e reuso no reenvio.
4. `frontend/tests/checkout.test.mjs` e um teste novo para o cliente HTTP: headers, credenciais, 429.
5. Ligação de `AppWrapper.tsx` ao `main.tsx`: decisão de produto, separada.

---

## 34. Contratos que precisarão de correção (resumo)

| # | Contrato | Hoje | Proposto | Arquivos |
|---|---|---|---|---|
| K1 | Header de escrita | Só nas rotas de acesso | Em todas as escritas com cookie (33.A) | `order.routes.ts`, `access.routes.ts`, `orders-api.md`, `access-api.md`, testes |
| K2 | 429 em pedidos | Inexistente | `TOO_MANY_REQUESTS` com `Retry-After` (33.B) | `order.routes.ts`, `accessLimits.ts`, `app.ts`, `orders-api.md`, testes |
| K3 | Escopo do CORS | Doc diz "só pedidos", código é global | Doc descreve o global (33.C, C1) | `orders-api.md` |
| K4 | Credenciais do cliente | `post` sem cookie; `Bearer` inexistente | Cookie em todas as rotas autenticadas; sem `Authorization` (33.D) | `frontend/src/services/api.ts` e consumidores |
| K5 | Documentação de permissões | Docs descrevem estado anterior à `20261031` | Docs fiéis às migrations (seção 5.2) | `backend/docs/rf004-onda-2.3c2-migration-offline.md`, `orders-api.md` |
| K6 | `source_code` | Banco aceita minúsculas, API só maiúsculas | Decidir e alinhar (seção 5.3); sem urgência | migration futura ou validação |

---

## 35. Migrations e checksums

Reconfirmado nesta execução [EXEC]:

| Migration | Bytes | CR / LF | Quebra final | SHA-256 no disco | No Git | SHA-256 se checkout CRLF (`autocrlf=true`, sem `.gitattributes`) | SHA-256 se só LF |
|---|---|---|---|---|---|---|---|
| `20261023000000_initial_schema` | 5508 | 0 / 159 | sim | `1a9cd08b9d49fa9f70eabcceaa4a696f5aee07555f6a88562ec789340f0d3983` | sim, `i/lf w/lf` | `fd781a6b8367e51969bdb0e600c64a8bd94758be3fbe87ffd0a3dba6e544d495` | igual ao disco |
| `20261027000000_rf004_comandas_catalogo_pedidos` | 8641 | 0 / 161 | sim | `05f583e854a87b77612c2f7d10a0a178ef45ea099d3237808b5bf0bd7c698122` | sim, `i/lf w/lf` | `0f5e3ac1c44d369a2a5ef6fb31c5e23ba7c33456ed8b554719f4f3ddc5429944` | igual ao disco |
| `20261031000000_rf004_fix_permissions` | 1624 | 39 / 39 | sim | `960766a8fb1576e6094622f112e1a3a9cd7455f56907a3405a8fbb183959e10b` | não | igual ao disco | `a94ea87327c5131775aede7de8355d2f3fd996ea5a1d86392014db5f91bee4fd` |
| `20261102000000_update_products_source_identity_constraint` | 710 | 12 / 12 | **não** | `885b8de5dcc0cf5e7618d574ba5c013ae8b60c9b983260706c5819422564454f` | não | igual ao disco | `a07bf3b06ee771787c4dfed0a0de75a815fd676ccc3ba9769d18050c6048a8c3` |
| `migration_lock.toml` | | | | `99836963713b4f5b269ad49af0ed3d7b0b2e336115c2f92dc9ac683d139d0900` | sim, `i/lf w/lf` | | |

Correção da Parte I e da seção 20.1: a Parte I dizia `core.autocrlf` indefinido e a seção 20.1 contava "12 / 13" linhas para a última migration. No Windows, `autocrlf` vale `true` (nível sistema) e a contagem de bytes é 12 CR e 12 LF (13 linhas, a última sem quebra). A conclusão prática muda: o risco de checksum não é só para os arquivos novos, **as duas migrations já versionadas também mudariam de bytes num clone feito nesta máquina**. Por isso a política `-text` da seção 31.2.

Demais pontos, sem mudança em relação às seções 5, 6 e 20 (todos [INSP], reconfirmados por leitura do relatório e dos arquivos):

- **Versionamento**: antigas no commit `1e80bdb`; novas fora do Git (seção 32).
- **Dependências**: `20261027` exige `orders` vazia e as roles `cardapio_test_app` e `cardapio_dev_app`; `20261031` depende das tabelas criadas pela `20261027` e falha fora de `cardapio_digital_dev`/`_test` (e no shadow); `20261102` depende do nome de constraint criado pela `20261027`.
- **PostgreSQL 17+**: `REVOKE ... MAINTAIN` na `20261027`. Servidor confirmado como versão maior 18 (18.6 nos binários do serviço) [EXEC/INSP]; valor exato de `server_version_num` [PEND-W].
- **Riscos de ACL**: `UPDATE` amplo em `comandas` e `comanda_invitations` (candidato a grant por coluna); `PUBLIC` não tratado em `admins`, `categories`, `products`; `cardapio_dev_app` com escrita em catálogo em Dev (R7). Nenhum é bloqueio para Test.
- **Pré-condições de backup**: B0 com `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe -Fc --create`, fora do OneDrive, SHA-256, `pg_restore --list` e restauração em banco temporário com autorização (seções 8 e 23). Ferramentas agora confirmadas [EXEC]; execução [PEND-W].
- **Condições de parada**: as da seção 9.3, mais: checksum de qualquer migration no disco diferente da tabela acima no momento do deploy; `migrate status` citando modificação ou drift; deploy a partir de um clone sem a política `-text`.

`migrate deploy` não foi executado.

---

## 36. Ordem recomendada de implementação

A ordem avaliada (1 checkpoint, 2 headers, 3 rate limit, 4 testes, 5 backup, 6 migrations, 7 testes HTTP, 8 checkout, 9 permissões) está quase certa. Três ajustes, com justificativa:

| Ajuste | Motivo |
|---|---|
| **a.** A política de fim de linha entra no passo 1, e não depois | Sem ela, o próprio checkpoint altera os bytes das migrations (seção 31.1) |
| **b.** O passo 4 vira um portão repetido ao fim de cada passo de código (2, 3 e 8), e não uma etapa única | Cada mudança de contrato precisa provar typecheck, testes e build antes da seguinte |
| **c.** Fixtures (role e carga) entram entre 6 e 7, e a parte de Dev do passo 9 (estado de `_prisma_migrations` de Dev e plano de ACL) sobe para antes do 8 | Os testes HTTP precisam de admin, categorias e produtos que a aplicação não cria (R8); o checkout real do frontend roda contra Dev, cujo schema e ACL não estão documentados (R5, R7) |

Os passos 2–3 (código) e 5–6 (banco) não dependem um do outro e podem correr em paralelo, desde que o 7 só comece com os dois concluídos.

Ordem final proposta:

| # | Passo | Depende de | Autorização |
|---|---|---|---|
| 1 | Cópia externa, `.gitattributes`, checkpoint Git por grupos, prova por clone, tag | aprovação da seção 31 | sim |
| 2 | K1 (header) e K3 (doc de CORS) no backend, com testes | 1 | decisão de contrato |
| 3 | K2 (rate limit, 33.B), com testes | 1 (pode juntar com 2 numa só tarefa, mesmos arquivos) | decisão dos valores |
| 4 | Portão: typecheck, `npm test`, build (repetido após 2, 3 e 8) | | não |
| 5 | Etapa 7 do roteiro (`-ConsultarServidor`) e backup B0 com restauração testada | 1 | sim (banco temporário) |
| 6 | `migrate deploy` em Test, verificação da seção 9.4, backup B1 | 5 | sim, texto explícito |
| 6b | Script de fixtures (código) e depois role e carga em Test | 1 (código); 6 (execução) | sim, separada para role e para dados |
| 7 | Testes HTTP com persistência em Test (seção 10) | 2, 3, 6, 6b | sim |
| 8a | Leitura de `_prisma_migrations` e ACL em Dev, plano de ACL | 1 | sim, para consultar Dev |
| 8 | K4 (cliente HTTP) e checkout real no frontend | 2, 3, 7, 8a | sim (fase de frontend) |
| 9 | Produção: sessão admin compartilhada, `trust proxy`, validação de `CORS_ORIGIN`, CORS C2, ACL por coluna, revogação de sessão, Dev ACL aplicada | 7, 8 | sim |

---

## 37. Divisão Claude Code / Codex

Critério: Claude Code onde há banco, Git, credencial, julgamento de risco ou execução local no Windows; Codex onde a tarefa é código isolado, com arquivos delimitados e testes com mocks, num worktree próprio. Nenhuma tarefa Codex foi iniciada.

| Passo | Executor | Por quê |
|---|---|---|
| 1 Checkpoint Git | **Claude Code**, com o usuário aprovando cada commit | Git local, `autocrlf`, decisão sobre dados sensíveis |
| 2 + 3 Backend K1, K2, K3 | **Codex** (uma tarefa, worktree `task/t2-backend-contratos`, arquivos da linha T2 da seção 24 mais `backend/src/security/`) | Código e testes com mocks; contrato já especificado em 33.A e 33.B |
| 4 Portão | quem fez o passo; Claude Code confere no Windows antes de integrar | O Vitest e o Prisma dependem de binários Windows |
| 5 Backup B0 | **Claude Code** com o usuário (senha digitada pelo usuário) | Banco e credencial |
| 6 Migrations Test | **Claude Code** com o usuário | Escrita em banco |
| 6b Script de fixtures | **Claude Code** (código e execução) | Caminho de escrita em banco, deve falhar fechado |
| 7 Testes HTTP | **Claude Code** | Conexão real ao Test |
| 8a Dev (leitura e plano) | **Claude Code** | Consulta a banco |
| 8 Frontend K4 e checkout | **Codex** (worktree `task/t3-frontend-http`, arquivos da linha T3 da seção 24) | Código isolado do frontend, testes com `fetch` simulado |
| K5 Documentação | **Codex** (linha T4 da seção 24) | Só docs, depois do passo 2 |
| 9 Produção | dividir de novo quando chegar a vez | Escopo ainda aberto |

Regra mantida da seção 24: um dono por arquivo, nenhum merge automático, relatório de cada tarefa revisado pelo usuário com o ChatGPT antes de integrar.

---

## 38. Bloqueadores restantes

Fechados nesta execução: typecheck no Windows, 440/440 no Windows, `migrate status` (1 aplicada, 3 pendentes), presença e versão de `pg_dump`/`pg_restore` (18.6), versão maior do servidor (18), checksums.

Ainda abertos:

| # | Bloqueador | Para | Como fechar |
|---|---|---|---|
| X1 | Aprovação da estratégia de checkpoint (seção 31) e da política `-text` | passo 1 | Usuário e ChatGPT |
| X2 | Checkpoint Git executado e provado por clone | passos 2 em diante | Passo 1 |
| X3 | Etapa 7 do roteiro: `server_version_num`, checksum gravado da inicial, `orders` = 0, roles, sessões | passo 6 | Usuário roda `-ConsultarServidor` e cola a saída |
| X4 | Backup B0 com restauração testada | passo 6 | Autorização para banco temporário |
| X5 | Decisões de contrato: A1 ou A2; valores de L1–L3; C1 agora e C2 depois | passos 2 e 3 | Usuário e ChatGPT |
| X6 | Autorização escrita para `npm run db:migrate:deploy:test` | passo 6 | Usuário |
| X7 | Role de fixtures aprovada (seção 22.1) | passos 6b e 7 | Usuário |
| X8 | Estado de `_prisma_migrations` e ACL em Dev | passo 8 | Autorização para consultar Dev |
| X9 | Decisão de visibilidade da planilha e dos JSONs de reconciliação; destino dos resíduos E7 | passo 1 (só para esses arquivos) | Usuário |

---

## 39. Registro da 3D.3.7-H e parecer final

### 39.1 Comandos executados

Todos no Windows, na pasta do projeto, com `GIT_OPTIONAL_LOCKS=0` nos comandos Git.

| Comando (resumo) | Finalidade | Escrita |
|---|---|---|
| `git branch`, `log`, `remote -v`, `status --short`, `ls-files` (`--others`, `--eol`, `--ignored`), `diff --name-only`, `config --show-origin` | Inventário | não |
| `git add --dry-run -- <migration 20261031>` | Observar aviso de fim de linha. **Registro por transparência**: é um `git add` em modo simulação, que não grava no índice; `git status` ficou idêntico. Não deveria ter sido usado, dada a restrição literal da entrega | não |
| `sha256sum` (192 arquivos e simulações CRLF/LF), `sed`, `tr`, `grep`, `wc` | Baseline, checksums, triagem | só no scratchpad da sessão, fora do projeto |
| `node --version`, `npm --version`, `--version` das ferramentas PostgreSQL, `Get-Service`/`Get-CimInstance Win32_Service`, leitura de `PG_VERSION` e da linha `port` do `postgresql.conf` | Ambiente | não |
| `npm run typecheck` (2 vezes) | W1 | não |
| `npm test` com `NODE_ENV=test` e `DB_PROFILE=app-test` (2 vezes) | W2 | só cache ignorado |
| `npm run db:migrate:status:test` (2 vezes) | W3 | não |
| Parser do PowerShell e execução de `Invoke-Validacao-3D37H.ps1` | Validar o roteiro | não |

Não executados: `migrate deploy`, Seed, qualquer executor ou publicação, `psql` (exige senha), `pg_dump`, `pg_restore`, `npm run build`, leitura de `.env` ou de arquivos de segredo, `git add` real, `commit`, `reset`, `clean`, `restore`, `checkout`, `push`. Uma cópia de lista temporária foi gravada por engano em `/tmp` do Git Bash (pasta temporária do usuário, fora do projeto); não contém dados sensíveis, só nomes de arquivos.

### 39.2 Arquivos alterados

- Alterado: `RELATORIO-ENTREGA-3D.3.7.md` (linha de estrutura e esta Parte III).
- Criado: `Invoke-Validacao-3D37H.ps1` (raiz, não rastreado).
- Integridade: `sha256sum -c` contra o baseline de 192 arquivos gravado no início: **192/192 iguais** (o baseline foi conferido antes de editar este relatório). `git status --short` igual ao inicial, mais `?? Invoke-Validacao-3D37H.ps1`. [EXEC]
- Estado do Git ao fim: `main`, `1e80bdb`, 13 modificados, 105 entradas não rastreadas (118 arquivos), nenhum commit.

### 39.3 Parecer final da 3D.3.7

**A 3D.3.7 está concluída como auditoria e fechamento de evidências. A aplicação de migrations continua não autorizada.**

Sustentado por execução no Windows nesta entrega: typecheck limpo; suíte de 440/440 testes em 20 arquivos; banco Test com 1 migration aplicada e 3 pendentes, sem falha nem divergência informada pelo Prisma; PostgreSQL 18 (18.6) com `pg_dump` e `pg_restore` da mesma versão disponíveis; checksums das 4 migrations iguais aos documentados.

Achado novo que muda o plano: `core.autocrlf=true` no Git do Windows faria o próprio checkpoint alterar os bytes de migrations, inclusive da já aplicada no Test. A política `-text` para `backend/prisma/migrations/**` preserva os arquivos atuais sem conversão e tem de vir antes do primeiro commit.

Continua aberto: a etapa de consulta read-only ao servidor (`-ConsultarServidor`), o backup B0 testado, o checkpoint Git aprovado e executado, as decisões de contrato A, B e C e as autorizações específicas (seção 38).

Nenhuma fase seguinte foi iniciada. Aguardo as saídas da etapa 7 do roteiro e a revisão do ChatGPT.
