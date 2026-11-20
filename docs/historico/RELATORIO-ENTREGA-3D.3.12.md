# RELATÓRIO DA ENTREGA 3D.3.12

Reconciliação final, checkpoint Git e preparação da execução PostgreSQL Test

Data: 04/11/2026 (America/Sao_Paulo)
Executor: Claude Code, nativo no Windows 11 (Node v24.20.0, PostgreSQL 18.6)

**Classificação: CONCLUÍDA no escopo permitido.** O checkpoint Git está **preparado e aguarda autorização explícita**: nenhum `git add` real nem commit foi executado. Há também uma decisão pendente sobre o `frontend/src/index.css`, que **regrediu** (seção 2).

Classes: **[EXEC]** executado · **[LEITURA]** consulta real só de leitura · **[INSP]** inspeção · **[HERD]** herdado.

Não executado: migrations, Seed, escrita em Dev ou Test, restore, criação ou exclusão de banco, alteração de role, ACL ou `pg_hba.conf`, suíte real com escrita, alteração de credenciais, exclusão de cópias de conflito, `git add`, commit.

---

## 1. Estado inicial [EXEC]

| Item | Valor |
|---|---|
| HEAD / branch / remote | `1e80bdb` / `main` / nenhum |
| `git status --short` | 182 entradas |
| Baseline SHA-256 | 254 arquivos, gravado fora do repositório antes de editar |
| Migrations | 5 SQL e o lock, com os hashes registrados na 3D.3.11 |
| Testes herdados | backend 568/568, frontend 82/82 |

## 2. Conflitos OneDrive analisados

Método: comparação das 20 cópias `*-Calil-Notebook*` com o arquivo ativo, com o `HEAD` e com **o baseline SHA-256 que gravei no início da 3D.3.9**, que é a evidência de como cada arquivo estava antes das entregas 3D.3.10 e 3D.3.11.

**Conclusão: o OneDrive substituiu arquivos ativos por versões antigas** e renomeou as versões mais novas como cópias de conflito. O `health.test.ts` ativo tem data de 22/10, anterior ao próprio commit baseline (28/10).

| Arquivo ativo | Diagnóstico | Decisão |
|---|---|---|
| `backend/tests/health.test.ts` | **Regrediu.** O ativo (22/10) tem 3 testes; o `HEAD` e a cópia têm 5. A cópia é idêntica byte a byte ao arquivo do início da 3D.3.9, já adaptado ao contrato atual | **Recuperados os 2 testes** (seção 3) |
| `frontend/src/index.css` | **Regrediu (grave).** O ativo (22/10, 176 linhas) é o CSS inicial do projeto e não define **122 das 123** classes usadas pelos componentes (`app-shell`, `cart-drawer`, `order-review`, `product-card`…). A cópia (273 linhas) é **idêntica ao `HEAD` e ao estado do início da 3D.3.9** e define 102 delas; as 21 restantes são das telas novas, que usam estilo inline. A interface está sem estilo na árvore atual. Testes e build não detectam CSS | **Não alterado. Decisão do usuário** (seção 7.3). Retifica a 3D.3.11, que considerou o ativo correto |
| `backend/src/app.ts`, `config/env.ts`, `lib/prisma.ts` | A cópia é o arquivo do início da 3D.3.9; o ativo difere **só na formatação** (a 3D.3.10 compactou linhas) e perdeu um comentário. Sem diferença funcional | Manter o ativo |
| `backend/tsconfig.json`, `tsconfig.build.json`, `frontend/tsconfig.json` | O ativo acrescentou a exclusão `**/*-Calil-Notebook.*` (3D.3.10). Correto: sem ela as cópias `.ts` seriam compiladas e verificadas | Manter o ativo |
| `frontend/src/main.tsx`, `vite-env.d.ts`, `frontend/.env.example`, `.gitignore` | Só fim de linha ou conteúdo igual ao `HEAD` | Manter o ativo |
| Outros 9 (`README`, `package*.json`, `schema`, `server.ts`, `errorHandler.ts`, `App.tsx`, `api.ts`, `.env.example` do backend) | Cópia idêntica ao ativo | Nada a fazer |

Nenhum arquivo do baseline da 3D.3.9 desapareceu. Nenhuma cópia de conflito foi apagada ou alterada.

## 3. Testes recuperados

Em `backend/tests/health.test.ts`, mantendo os 3 existentes:

| Teste | Origem | Ajuste ao contrato atual |
|---|---|---|
| "aceita cliente injetado sem criar conexão durante o health" | `HEAD` e cópia | nenhum; `createApp({ prisma })` continua expondo `app.locals.prisma` e não conecta |
| "retorna erro padronizado quando o JSON da requisição é inválido" | cópia | **Não restaurei a expectativa do `HEAD`** (POST `/api/health` com JSON inválido → 500 `INTERNAL_ERROR`), que é o contrato antigo. Mantive a da cópia: POST `/api/admin/auth/login` com Origin e `X-Rustika-Request` → **400 `INVALID_INPUT` "JSON inválido."**, que é o contrato do `errorHandler`. Acrescentei uma asserção mais rígida: o erro de parse **não** deve ser registrado como erro interno no log |

Nenhum código do backend foi alterado para fazer testes passarem.

## 4. Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `backend/tests/health.test.ts` | +2 testes (seção 3) |
| `backend/tests/scripts/pg-hba-isolation.test.ts` | **novo**: 7 testes, modelo do `pg_hba` com as regras reais do cluster (seção 12) |
| `backend/docs/restore-backup.md` | Dumps reais e hashes; isolamento do banco descartável; lista de bancos protegidos; remoção do falso "dump ausente" e da opção inexistente `--no-create`; prova de preservação do cluster |
| `backend/tests/scripts/backup-restore-plan.test.ts` | O teste que afirmava "dump ausente" foi trocado pelo fato correto; +2 testes (dump e hash, isolamento e preservação) |
| `RELATORIO-ENTREGA-3D.3.12.md` | este relatório |

Frontend: **nenhum arquivo alterado**.

## 5. Resultados dos testes [EXEC]

| Projeto | Resultado |
|---|---|
| Backend `npm test` (`NODE_ENV=test`, `DB_PROFILE=app-test`) | **579/579**, 29 arquivos, em **duas rodadas seguidas** (568 + 2 recuperados + 2 do plano de restauração + 7 do modelo de `pg_hba`) |
| Frontend `npm test` (sem alteração, para registro) | **82/82** |
| Trava da suíte real | `npm run test:integration:db` sem as variáveis: `IntegrationAbort`, sem conexão |

## 6. Typecheck e build [EXEC]

Backend: typecheck exit 0, build exit 0. Frontend: typecheck exit 0; build não refeito (frontend não alterado).

## 7. Checkpoint Git preparado (AGUARDA AUTORIZAÇÃO)

### 7.1 Lista final e verificações [EXEC]

Lista calculada **sem `git add`**: `git ls-files --others --exclude-standard` e `git diff --name-only` com as exclusões por pathspec, mais `git hash-object` para descartar modificações só de stat.

| Verificação | Resultado |
|---|---|
| Total | **171 arquivos**: 146 novos e 25 modificados com conteúdo real (169 da 3D.3.11, mais `pg-hba-isolation.test.ts` e este relatório). Lista completa no Anexo A |
| Essenciais | as 3 migrations ainda fora do `HEAD` (`20261031`, `20261102`, `20261104`), `.gitattributes`, rotas, segurança, services, testes (inclusive `integration-db/**` e o `health.test.ts` recuperado), docs e scripts SQL: **entram**. As 2 migrations já no `HEAD` não mudaram |
| Cópias de conflito, `$testRunner`, `backend/data/`, `changes.diff`, `vitest-report.json`, JSONs e TXTs de reconciliação | **nenhum** na lista |
| `.env`, `.env.*` (exceto `.example`), `fixtures-test.env`, `*.dump`, `*.pem`, `*.key`, pgpass | **nenhum** na lista |
| Conteúdo | nenhuma URL com senha real (só dois valores fictícios em testes de redação: `private:password@`, `u:${secret}@`), nenhum `PASSWORD '…'` em SQL, nenhuma chave privada, nenhum arquivo acima de 200 kB |
| `.gitattributes` | `backend/prisma/migrations/** -text` e `backend/docs/sql/** -text`; as 5 migrations, o lock e os SQL de fixtures com `text: unset` e `hash-object --no-filters` igual a `hash-object --path`, ou seja, **nenhuma conversão ao entrar no índice** |

### 7.2 Comandos exatos (NÃO executados)

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital
# 0. hashes das migrations antes
Get-FileHash backend\prisma\migrations\*\migration.sql, backend\prisma\migrations\migration_lock.toml -Algorithm SHA256

# 1. stage SOMENTE da lista revisada (Anexo A), por arquivo, sem "git add -A" indiscriminado
git add --pathspec-from-file=<lista-anexo-A.txt> --

# 2. conferência antes do commit
git diff --cached --name-only | Measure-Object -Line          # deve ser 171
git diff --cached --name-only | Select-String -Pattern 'Calil-Notebook|\$testRunner|backend/data/|changes\.diff|vitest-report|analise-fechamento|dry-run-recovery\.txt|ambiguidades|ausentes\.json|candidatos|mapeamento|produtos_banco|reconciliation-output|sem_correspondencia|validacao-vinculos|\.dump$|fixtures-test\.env'   # deve ser vazio
git ls-files --eol -s -- backend/prisma/migrations             # attr/-text; i/ igual a w/

# 3. commit
git commit -m "chore: checkpoint funcional RUSTIKA 3D.3.7-3D.3.12"

# 4. verificação depois
git log --oneline -2
git show --stat --format= HEAD | Select-Object -Last 1          # 171 files changed
Get-FileHash backend\prisma\migrations\*\migration.sql -Algorithm SHA256   # iguais ao passo 0
git status --short                                             # só os excluídos de propósito
```

`--pathspec-from-file` recebe a lista do Anexo A salva num arquivo temporário fora do repositório. Nenhum push: não há remoto.

### 7.3 Decisão pendente: `frontend/src/index.css`

Hoje a lista inclui o `index.css` **regredido**. Commitado assim, ele **substituiria no Git o CSS bom que está no `HEAD`**.

| Opção | Efeito |
|---|---|
| **1 (recomendada)** Restaurar o `index.css` ativo com o conteúdo do `HEAD`, que é igual à cópia de conflito, guardando antes uma cópia do ativo fora do repositório, e então commitar | Árvore e commit voltam ao CSS validado no navegador na 3D.3.8. O arquivo sai da lista de modificados (170 arquivos). Exige rodar testes e build do frontend e uma conferência visual |
| 2 Excluir `index.css` do checkpoint | O commit preserva o CSS bom do `HEAD`, mas a árvore de trabalho continua com a interface sem estilo |
| 3 Commitar como está | **Não recomendado**: versiona a regressão |

## 8. Integridade das migrations [EXEC]

Antes e depois desta entrega, iguais aos da 3D.3.11:

| Migration | SHA-256 |
|---|---|
| `20261023000000_initial_schema` | `1a9cd08b9d49fa9f70eabcceaa4a696f5aee07555f6a88562ec789340f0d3983` |
| `20261027000000_rf004_comandas_catalogo_pedidos` | `05f583e854a87b77612c2f7d10a0a178ef45ea099d3237808b5bf0bd7c698122` |
| `20261031000000_rf004_fix_permissions` | `960766a8fb1576e6094622f112e1a3a9cd7455f56907a3405a8fbb183959e10b` |
| `20261102000000_update_products_source_identity_constraint` | `885b8de5dcc0cf5e7618d574ba5c013ae8b60c9b983260706c5819422564454f` |
| `20261104000000_runtime_least_privilege` | `24471ed369980bc861d885dc68d9edd3747de73457be620d166eae8b1ec47d6e` |
| `migration_lock.toml` | `99836963713b4f5b269ad49af0ed3d7b0b2e336115c2f92dc9ac683d139d0900` |

## 9. Estado dos backups [EXEC]

`C:\Users\u1n3c\AppData\Local\RustikaBackups\` (fora do repositório e do OneDrive):

| Arquivo | Bytes | SHA-256 |
|---|---|---|
| `cardapio_digital_test_pre-migrations-3d311_20261104-102650Z_1a9636.dump` (**para a prova**) | 20 928 | `f2304f0ac150218ef6dc36a1cbdc517402180daa8ed73bd949c6d2f05306cadf` |
| `cardapio_digital_test_pre3d38_20261104-012137.dump` (histórico) | 20 928 | `1be946052157a2c54b7af979c9c174e0d41d70cfaab9abc9b5de90663f925265` |

Ambos conferem com o registrado. Continuam **legíveis, mas não provados restauráveis**.

## 10. Plano de restauração

`backend/docs/restore-backup.md`, corrigido nesta entrega e coberto por 7 testes estáticos:

- **Dump e hash fixos**: o passo 0 para se o SHA-256 divergir (`f2304f0a…6cadf`).
- **Destino**: `cardapio_restore_check_<AAAAMMDD>_<HHMMSS>` validado por regex. É diferente de Dev, Test, Shadow, `postgres`, `template0`/`template1`, `plataforma_sites_ia*`, `cardapio_restore_precheck` e `rf004_lab_*`. Antes de criar, o plano confere que o destino não existe e grava a lista de bancos do cluster.
- **Isolamento**: `createdb -T template0` com a role administrativa, e **`REVOKE ALL ON DATABASE <destino> FROM PUBLIC` logo depois**, porque todo banco novo nasce acessível a `PUBLIC`, inclusive às roles da PLATAFORMA_SITES_IA.
- **Restauração**: **sem `--create`** (não existe `--no-create`; a proteção é não passar `--create`), com `--no-owner --no-privileges --single-transaction --exit-on-error`. O log fica fora do repositório.
- **Pós-verificação**: `verify-restore.sql`, que recusa banco fora do padrão. Esperado: 7 tabelas, a sequência, `_prisma_migrations` com 1 linha e checksum `1a9cd08b…`, as outras tabelas vazias e nenhuma `comanda*`.
- **Parada**: hash divergente, destino existente, qualquer erro do `pg_restore`, tabela ou contagem inesperada.
- **Limpeza**: só com autorização, revalidando o nome; a lista de bancos depois tem de ser igual à de antes. `cardapio_restore_precheck` é preexistente e **não** é alvo.
- **Pré-requisito**: a role `postgres` (única `SUPERUSER`) com senha digitada pelo operador. O migrator não tem `CREATEDB` e não deve ser elevado.

## 11. Prontidão das migrations [LEITURA]

| Verificação | Resultado |
|---|---|
| Identidade | `cardapio_digital_test`, `cardapio_migrator`, `127.0.0.1:5432`, sessão `read only = on` |
| Versão | 18.6 (`180006`) |
| `_prisma_migrations` | 1 linha, `20261023000000_initial_schema`, concluída, não revertida, checksum `1a9cd08b…` igual ao arquivo |
| `migrate status` | "5 migrations found"; pendentes **na ordem**: `20261027`, `20261031`, `20261102`, `20261104` |
| Tabelas | 7, todas com 0 linhas além de `_prisma_migrations` (a trava da `20261027`, que exige `orders` vazia, passa) |
| Objetos das pendentes | ausentes (`comandas`, `comanda_sessions`, enums, `categories.public_key`) |
| Concorrência | 0 sessões de outros clientes, 0 locks de outros processos, 0 transações preparadas |
| Pré-condições da `20261104` | dono de todas as relações = migrator = dono do banco; roles de runtime existem, sem atributos administrativos e **0 memberships**; **0 ACLs de coluna**; PG ≥ 17 |
| Permissões atuais de `cardapio_test_app` | DML completo em `admins`, `categories`, `products`, `orders`, `order_items`, `order_status_history`, e default ACL `arwd`/`rU`. **É isso que a `20261104` corrige**, deixando a matriz mínima |
| `PUBLIC` no Test | sem `CONNECT`, `TEMP` nem `USAGE` em `public` |

Execução preparada (Operação C), com o wrapper do projeto, que só permite `migrate-test` / `cardapio_digital_test`:

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
npm run db:migrate:status:test                       # 4 pendentes, nenhuma falha
$env:CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION = 'APPLY_CARDAPIO_DIGITAL_TEST'
npm run db:migrate:deploy:test                       # aplica as 4, em ordem
Remove-Item Env:CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION
npm run db:migrate:status:test                       # up to date
```

Pós-verificação, só leitura:
- 5 linhas concluídas com os checksums da seção 8;
- `cardapio_test_app` com `SELECT` em `admins/categories/products`; `SELECT,INSERT` em `orders/order_items/order_status_history/comanda_sessions`; `SELECT,INSERT,UPDATE` em `comandas/comanda_invitations`; `USAGE` na sequência; nada em `_prisma_migrations`;
- `pg_default_acl` sem regras de DML para runtime.

Parada: qualquer erro, linha sem `finished_at`, checksum divergente ou matriz diferente. Nunca usar `migrate reset` nem `resolve`.

## 12. Segurança da role de fixtures [LEITURA, INSP, EXEC em mocks]

Configuração real lida (arquivos em `C:\Program Files\PostgreSQL\18\data`, só leitura):

| Item | Valor real | Implicação |
|---|---|---|
| `listen_addresses` | `'localhost'`; escuta só em `127.0.0.1:5432` e `[::1]:5432` | Os caminhos habilitados são TCP loopback IPv4 e IPv6 (mais socket local, se houver); não há interface de rede |
| `pg_hba.conf` (22/10) | 6 regras: `local/host all all` (127.0.0.1/32, ::1/128) e 3 de `replication`, todas SCRAM | **Hoje a role alcançaria todo banco conectável**, inclusive da PLATAFORMA_SITES_IA. As 5 linhas devem ficar **acima da primeira** |
| `replication` | as regras `replication` não casam com `all` | A role é `NOREPLICATION`; replicação recusada pelo atributo |
| `log_statement` | não configurado (padrão `none`) | O hash do `\password` não vai para log |
| `CONNECT` via `PUBLIC` | `postgres`, `template1`, `rf004_lab_*`, `cardapio_restore_precheck`, `plataforma_sites_ia*` | Neutralizado pelo `pg_hba`, não por revogação |

Conferências do plano:

| Ponto | Situação |
|---|---|
| `NOLOGIN` → `LOGIN` | Criada `NOLOGIN` (não autentica, com ou sem senha); `\password`; `LOGIN` só depois da checagem do `pg_hba` |
| Regras específicas e ordem | 2 permissões (Test, SCRAM, 127.0.0.1 e ::1) e 3 recusas (`local`, 127.0.0.1, ::1) para `all`, no topo |
| IPv4 e IPv6 | ambos cobertos; o `localhost` resolve para um dos dois |
| Herança de `CONNECT` via `PUBLIC` | não removível de uma role só; neutralizada pelo `pg_hba` |
| Sem acesso efetivo a outros bancos | **modelo** "primeira regra vence" com as regras reais: com as 5 linhas no topo, a role só entra em `cardapio_digital_test` por TCP; nos outros 9 bancos × 3 caminhos, recusa |
| Bancos da PLATAFORMA_SITES_IA preservados | as linhas não mudam a decisão para nenhuma outra role (testado para 5 roles × 10 bancos × 3 caminhos) |
| Testes adversariais | linhas no final (sem efeito), falta da recusa `::1` (IPv6 aberto), falta da recusa `local` (socket aberto): o modelo confirma o perigo e o `enable-test-fixtures-login.sql` recusa cada caso |
| Aplicação real | **não presumida**: o `enable` exige reload posterior à edição (`pg_conf_load_time()`), a pós-verificação manda conectar com `psql -w` em Dev e em `postgres` esperando "pg_hba.conf rejects connection", e o preflight da suíte tenta conectar em cada banco alcançável e aborta se algum aceitar |

Limitação: o modelo cobre os tipos `local` e `host` com máscaras /32, /128 e `all`. A prova definitiva é a pós-verificação real da Operação D.

## 13. Operações ainda pendentes (cada uma com autorização própria; nenhuma automática)

| Op. | O quê | Preflight | Evidência | Parada |
|---|---|---|---|---|
| **A** | Checkpoint Git (seção 7) | decisão 7.3; hashes das migrations | hash do commit; 171 (ou 170) arquivos; migrations iguais | contagem diferente; item proibido; aviso de EOL |
| **B** | Prova de restauração (seção 10) | SHA do dump; destino inexistente; lista de bancos | log do `pg_restore`; `verify-restore.sql`; lista de bancos igual após limpeza | qualquer erro ou divergência |
| **C** | 4 migrations em Test (seção 11) | `migrate status` = 4 pendentes; sem sessões | 5 linhas concluídas; matriz mínima; default ACL limpo | erro; checksum; matriz |
| **D** | Role de fixtures (`docs/fixture-role.md`) | C concluída; backup do `pg_hba.conf` | `verify-test-fixtures.sql` = 0 violações; `psql -w` recusado em Dev e `postgres` | qualquer `RAISE`; conexão aceita fora do Test |
| **E** | Suíte `integration-db` | preflight automático completo | todos os cenários; resíduo zero | `IntegrationAbort`; falha; resíduo |
| **F** | Primeiro pedido persistido e garantias | E concluída | pedido, itens e histórico em `orders/*` via role de runtime; idempotência, concorrência, preço e produto interno; ACL efetiva | qualquer divergência |

## 14. Estado final do Git [EXEC]

`main`, `1e80bdb`, sem remote, **nenhum commit e nenhum `git add`** nesta entrega (a lista foi calculada com `ls-files`/`diff`, sem simulação de `add`). `git status --short`: 184 entradas (as 182 do início, mais `pg-hba-isolation.test.ts` e este relatório). Baseline de 254 arquivos: 3 com conteúdo alterado (`health.test.ts`, `restore-backup.md`, `backup-restore-plan.test.ts`), mais 2 novos (`pg-hba-isolation.test.ts` e este relatório), todos da seção 4; os outros 251 ficaram idênticos. As 20 cópias de conflito estão intactas.

## 15. Parecer final

**CONCLUÍDA no escopo permitido.**

| Critério | Situação |
|---|---|
| Testes úteis das cópias de conflito reconciliados | sim: 2 recuperados no contrato atual; expectativa antiga incorreta não restaurada |
| Código continua aprovado | backend 579/579 (2 rodadas), typecheck e build ok; frontend 82/82 |
| Checkpoint validado e pronto para aprovação | sim: 171 arquivos verificados, sem segredos, dumps, dados ou cópias. **Depende da decisão sobre o `index.css` regredido** |
| Migrations íntegras | sim |
| Backups identificados | sim, com SHA-256 completos |
| Estratégia de restauração pronta | sim, corrigida e testada estaticamente |
| Plano de integração real definido | sim: operações A a F com preflight, evidência e parada |

Achado principal: **o OneDrive reverteu arquivos ativos para versões antigas**. Em testes isso foi corrigido; no CSS do frontend ainda depende da decisão 7.3. Enquanto não houver checkpoint, e depois um remoto, esse risco continua.

Nenhuma operação seguinte foi iniciada.

---

## Anexo A — Lista final do checkpoint

Gerado por `git ls-files --others --exclude-standard` + `git diff --name-only` (com `git hash-object` para descartar diferenças só de stat), com as exclusões da seção 7. **171 arquivos** (146 novos, 25 modificados). Arquivos modificados marcados com (M).

```text
    .gitattributes
    Invoke-Validacao-3D37H.ps1
    RELATORIO-ENTREGA-3D.2.11.md
    RELATORIO-ENTREGA-3D.2.12.md
    RELATORIO-ENTREGA-3D.2.13.1.md
    RELATORIO-ENTREGA-3D.2.13.2.md
    RELATORIO-ENTREGA-3D.2.13.3.md
    RELATORIO-ENTREGA-3D.2.13.4.md
    RELATORIO-ENTREGA-3D.2.13.5.md
    RELATORIO-ENTREGA-3D.2.13.md
    RELATORIO-ENTREGA-3D.2.14A.md
    RELATORIO-ENTREGA-3D.2.14B.1.md
    RELATORIO-ENTREGA-3D.2.14B.md
    RELATORIO-ENTREGA-3D.2.14C.md
    RELATORIO-ENTREGA-3D.2.14D.1.md
    RELATORIO-ENTREGA-3D.2.14D.2.md
    RELATORIO-ENTREGA-3D.3.1.md
    RELATORIO-ENTREGA-3D.3.10.md
    RELATORIO-ENTREGA-3D.3.11.md
    RELATORIO-ENTREGA-3D.3.12.md
    RELATORIO-ENTREGA-3D.3.2.md
    RELATORIO-ENTREGA-3D.3.3.md
    RELATORIO-ENTREGA-3D.3.4.md
    RELATORIO-ENTREGA-3D.3.5.md
    RELATORIO-ENTREGA-3D.3.6.md
    RELATORIO-ENTREGA-3D.3.7.md
    RELATORIO-ENTREGA-3D.3.8.md
    RELATORIO-ENTREGA-3D.3.9-ADENDO-3D.3.10.md
    RELATORIO-ENTREGA-3D.3.9.md
    backend/RELATORIO-ENTREGA-3D.2.10.md
    backend/RELATORIO-ENTREGA-3D.2.4.md
    backend/RELATORIO-ENTREGA-3D.2.6.md
    backend/RELATORIO-ENTREGA-3D.2.7.md
    backend/RELATORIO-ENTREGA-3D.2.8.md
    backend/RELATORIO-ENTREGA-3D.2.9.md
    backend/docs/access-api.md
    backend/docs/admin-provisioning.md
    backend/docs/catalog-api.md
    backend/docs/fixture-role.md
    backend/docs/integration-db.md
    backend/docs/orders-api.md
    backend/docs/restore-backup.md
(M) backend/docs/sql/README.md
    backend/docs/sql/enable-test-fixtures-login.sql
    backend/docs/sql/pg_hba-test-fixtures.conf.example
    backend/docs/sql/provision-test-fixtures.sql
    backend/docs/sql/rollback-test-fixtures.sql
    backend/docs/sql/verify-restore.sql
    backend/docs/sql/verify-test-fixtures.sql
(M) backend/package.json
    backend/prisma/migrations/20261031000000_rf004_fix_permissions/migration.sql
    backend/prisma/migrations/20261102000000_update_products_source_identity_constraint/migration.sql
    backend/prisma/migrations/20261104000000_runtime_least_privilege/migration.sql
    backend/scripts/_gen-seed-real.js
    backend/scripts/analyze-excel.ts
    backend/scripts/analyze-excel2.ts
    backend/scripts/check-cats.ts
    backend/scripts/check-products.ts
    backend/scripts/dry-run-recovery.ts
    backend/scripts/executor-3d-2-14d-2.ts
    backend/scripts/executor-seed-real.ts
    backend/scripts/generate-map.ts
    backend/scripts/inspect-db-dev.ts
    backend/scripts/inspect-reconciliation.ts
    backend/scripts/inspect-role.ts
    backend/scripts/preflight-category-publication.ts
    backend/scripts/publish-category-publication.ts
    backend/scripts/seed-real.ts
    backend/scripts/test-app-connection.ts
    backend/scripts/test-catalog-http.js
    backend/scripts/test-validation.ts
    backend/scripts/validate-api.ts
    backend/scripts/validate-links.ts
    backend/scripts/verify-db.ts
(M) backend/src/app.ts
(M) backend/src/config/env.ts
    backend/src/domain/categoryPublication.ts
    backend/src/domain/orderInput.ts
(M) backend/src/domain/rules.ts
(M) backend/src/lib/prisma.ts
    backend/src/mappers/catalog.mapper.ts
    backend/src/mappers/order.mapper.ts
(M) backend/src/middleware/errorHandler.ts
    backend/src/routes/access.routes.ts
    backend/src/routes/catalog.routes.ts
    backend/src/routes/order.routes.ts
    backend/src/security/accessLimits.ts
    backend/src/security/adminSessions.ts
    backend/src/security/password.ts
    backend/src/security/writeGuard.ts
    backend/src/services/adminAuth.service.ts
    backend/src/services/catalog.service.ts
    backend/src/services/comandaAccess.service.ts
    backend/src/services/order.service.ts
    backend/src/services/orderSession.ts
    backend/tests/access.test.ts
    backend/tests/catalog.test.ts
    backend/tests/categoryPublication.test.ts
(M) backend/tests/domain/rules.test.ts
    backend/tests/fixtures/access.ts
    backend/tests/fixtures/catalog.ts
    backend/tests/fixtures/orders.ts
(M) backend/tests/health.test.ts
    backend/tests/integration-db-support.test.ts
    backend/tests/integration-db/auth.integration.ts
    backend/tests/integration-db/cleanup-stale.ts
    backend/tests/integration-db/comandas.integration.ts
    backend/tests/integration-db/globalSetup.ts
    backend/tests/integration-db/orders.integration.ts
    backend/tests/integration-db/security.integration.ts
    backend/tests/integration-db/support/databases.ts
    backend/tests/integration-db/support/fixtures.ts
    backend/tests/integration-db/support/harness.ts
    backend/tests/integration-db/support/permissions.ts
    backend/tests/integration-db/support/preflight.ts
    backend/tests/orders-csrf.test.ts
    backend/tests/orders-rate-limit.test.ts
    backend/tests/orders.test.ts
    backend/tests/scripts/backup-restore-plan.test.ts
    backend/tests/scripts/executor-seed-real.test.ts
    backend/tests/scripts/fix-permissions-migration.test.ts
    backend/tests/scripts/fixtures-role-provisioning.test.ts
    backend/tests/scripts/inspect-reconciliation.test.ts
    backend/tests/scripts/least-privilege-migration.test.ts
    backend/tests/scripts/pg-hba-isolation.test.ts
    backend/tests/scripts/seed-dev.test.ts
    backend/tests/scripts/seed-real-corrected.test.ts
    backend/tests/scripts/seed-real.test.ts
    backend/tests/security/accessLimits-adversarial.test.ts
    backend/tests/security/accessLimits.test.ts
    backend/tests/services/access.service.test.ts
    backend/tests/services/catalog.service.test.ts
    backend/tests/services/order.service.test.ts
(M) backend/tsconfig.build.json
(M) backend/tsconfig.json
    backend/vitest.integration.config.mts
    frontend/docs/catalog-integration.md
(M) frontend/package.json
(M) frontend/src/App.tsx
    frontend/src/AppWrapper.tsx
(M) frontend/src/components/CartDrawer.tsx
(M) frontend/src/components/Catalog.tsx
    frontend/src/components/CatalogStatus.tsx
    frontend/src/components/ComandaRedeem.tsx
(M) frontend/src/components/ConnectionIndicator.tsx
(M) frontend/src/components/OrderReview.tsx
(M) frontend/src/components/ProductCard.tsx
(M) frontend/src/components/ProductModal.tsx
(M) frontend/src/contexts/CartContext.tsx
    frontend/src/hooks/useCatalog.ts
(M) frontend/src/index.css
(M) frontend/src/main.tsx
    frontend/src/pages/AdminDashboard.tsx
    frontend/src/pages/AdminLogin.tsx
    frontend/src/pages/Checkout.tsx
(M) frontend/src/services/api.ts
    frontend/src/services/catalogAdapter.ts
    frontend/src/services/catalogSource.ts
    frontend/src/services/catalogStore.ts
    frontend/src/services/orderSubmission.ts
(M) frontend/src/types/catalog.ts
    frontend/tests/catalog-api.test.mjs
    frontend/tests/catalog-fixtures.mjs
    frontend/tests/catalog-state.test.mjs
    frontend/tests/checkout.test.mjs
    frontend/tests/http-client.test.mjs
    frontend/tests/order-recovery.test.mjs
    frontend/tests/order-submission.test.mjs
    frontend/tests/register.mjs
    frontend/tests/typescript-loader.mjs
(M) frontend/tsconfig.json
```
