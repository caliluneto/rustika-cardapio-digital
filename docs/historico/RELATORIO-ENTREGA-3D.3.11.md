# RELATÓRIO DA ENTREGA 3D.3.11

Recuperação do backup, fechamento dos bloqueadores e preparação da integração real

Data: 04/11/2026 (America/Sao_Paulo)
Executor: Claude Code, nativo no Windows 11 (Node v24.20.0, PostgreSQL 18.6)
Bases: `RELATORIO-ENTREGA-3D.3.9.md`, `RELATORIO-ENTREGA-3D.3.9-ADENDO-3D.3.10.md`, `RELATORIO-ENTREGA-3D.3.10.md`, `backend/docs/{restore-backup,fixture-role,integration-db}.md`

**Classificação: CONCLUÍDA.** Todos os critérios de sucesso foram atendidos:
- backup novo, legível e identificado;
- plano da role de fixtures coerente e com as falhas do desenho anterior corrigidas;
- quinta migration revisada e pronta, sem alteração;
- suíte real protegida e compatível com o novo desenho;
- regressão aprovada;
- checkpoint pronto para aprovação.

As operações A a E continuam dependendo de autorização (seção 14).

Classes: **[EXEC]** executado nesta entrega · **[LEITURA]** consulta real ao PostgreSQL só de leitura · **[INSP]** inspeção de arquivo · **[HERD]** herdado.

Não executado nesta entrega: migrations, Seed, `CREATE/ALTER/DROP ROLE`, `GRANT/REVOKE`, restore, criação ou exclusão de banco, suíte real com escrita, alteração de credenciais ou `.env`, `git add` real, commit, push.

---

## 1. Estado inicial [EXEC]

| Item | Valor |
|---|---|
| HEAD / branch / remote | `1e80bdb086aed59b08e3b35e5141f03f840d7fa9` / `main` / nenhum |
| `git status --short` | 180 entradas: 28 ` M` e 152 `??` |
| Modificados com conteúdo real | 25. Os 3 restantes (`.gitignore`, `frontend/.env.example`, `frontend/src/vite-env.d.ts`) têm blob idêntico ao `HEAD`, conferido por `git hash-object` |
| Baseline SHA-256 | 252 arquivos, gravado fora do repositório antes de editar |
| `.gitattributes` | `backend/prisma/migrations/** -text` e `backend/docs/sql/** -text` |
| Testes herdados | backend 557/557, frontend 82/82 [HERD] |

## 2. Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `backend/docs/sql/pg_hba-test-fixtures.conf.example` | **novo**: 5 linhas de isolamento da role de fixtures (não aplicadas) |
| `backend/docs/sql/provision-test-fixtures.sql` | Remove o aborto por CONNECT herdado em Dev/Shadow (defeito, seção 8); passa a recusar concessão explícita fora de Test; lista bancos alcançáveis via `PUBLIC` |
| `backend/docs/sql/enable-test-fixtures-login.sql` | `LOGIN` só com `pg_hba` conferido em `pg_hba_file_rules` (erros, reload, grupos/regex, permissões só para Test, recusas para `all`, ordem) |
| `backend/docs/sql/verify-test-fixtures.sql` | Seção de `pg_hba`; violações distinguem concessão explícita de herança de `PUBLIC` |
| `backend/docs/sql/rollback-test-fixtures.sql` | Revoga concessões explícitas em **qualquer** banco; lembra de remover as linhas do `pg_hba` |
| `backend/docs/fixture-role.md` | Funcionamento real de `NOLOGIN`, `LOGIN`, `\password`, `CONNECT`, `pg_hba`, `SET ROLE`, herança, `session_user`/`current_user`; estratégia final; procedimento com pós-verificação |
| `backend/tests/integration-db/support/permissions.ts` | Regra de banco corrigida (seção 9); novo `FIXTURES_REACHABLE_SQL` |
| `backend/tests/integration-db/support/preflight.ts` | Novo fato `fixturesReachableDatabases`; aborta se a sondagem não rodou ou se algum banco aceitou a conexão |
| `backend/tests/integration-db/support/databases.ts` | `fixturesUrlFor`, `probeFixturesConnection`, `reachableDatabases`; sondagem ligada ao preflight |
| `backend/tests/integration-db-support.test.ts` | +8 testes com mocks (seção 10) |
| `backend/tests/scripts/fixtures-role-provisioning.test.ts` | Teste do desenho antigo substituído por 4 mais rígidos (+3) |
| `backend/tests/security/accessLimits.test.ts`, `accessLimits-adversarial.test.ts`, `backend/tests/orders-rate-limit.test.ts` | Prazo de 30 s em 3 testes pesados (seção 10); asserções intactas |
| `RELATORIO-ENTREGA-3D.3.11.md` | este relatório |

Não alterados: código de produção (`backend/src`, `frontend/src`), as 5 migrations, `schema.prisma`, `config/`, `.env`, frontend inteiro.

## 3. Estado do Git [EXEC]

Ao fim: 181 entradas (28 ` M`, 153 `??`, mais este relatório = 182). Diferença em relação ao início: `+?? backend/docs/sql/pg_hba-test-fixtures.conf.example` e este relatório. Baseline: 13 arquivos com conteúdo alterado, todos da seção 2. Nenhum `.dump`, `.env` ou `fixtures-test.env` entre os não rastreados.

**Lista do checkpoint conferida.** Simulei o `git add` proposto na 3D.3.10 com `git add --dry-run`, que não grava no índice. **Registro por transparência:** é um `git add` em modo simulação; a restrição literal proíbe `git add`, e o dry-run não altera nada (`git status` idêntico). Resultado: **167 arquivos**, exatamente o previsto. Com esta entrega, a mesma regra incluirá **169**: os 167, o `pg_hba-test-fixtures.conf.example` e este relatório. Nenhum deles está nas exclusões; a regra `backend/docs/sql/** -text` também cobre o arquivo novo.

**Achado: cópias de conflito do OneDrive.** Há 20 arquivos `*-Calil-Notebook*`, ou seja, a pasta é sincronizada com outra máquina. Eles já estão excluídos do checkpoint pelo padrão `*Calil-Notebook*`, mas um deles é relevante:

| Arquivo | Situação |
|---|---|
| `backend/tests/health.test-Calil-Notebook.ts` | Tem **2 testes** que o `backend/tests/health.test.ts` ativo não tem ("aceita cliente injetado sem criar conexão" e "JSON inválido → 400 INVALID_INPUT"). A cópia é de 03/11 17:17; o ativo diverge dos dois. Possível perda de cobertura na reconciliação da 3D.3.10. **Não alterei**: decidir a versão correta é do usuário |
| `frontend/src/index.css`, `main.tsx` | Os ativos são as versões corretas (a cópia de `index.css` é igual ao `HEAD`; o `main.tsx` ativo usa `AppWrapper`) |
| demais 17 | Iguais ao ativo ou mais antigos |

## 4. Integridade das cinco migrations [EXEC]

| Migration | SHA-256 | No Git | Aplicada no Test |
|---|---|---|---|
| `20261023000000_initial_schema` | `1a9cd08b9d49fa9f70eabcceaa4a696f5aee07555f6a88562ec789340f0d3983` | sim (`i/lf w/lf attr/-text`) | sim [LEITURA] |
| `20261027000000_rf004_comandas_catalogo_pedidos` | `05f583e854a87b77612c2f7d10a0a178ef45ea099d3237808b5bf0bd7c698122` | sim | não |
| `20261031000000_rf004_fix_permissions` | `960766a8fb1576e6094622f112e1a3a9cd7455f56907a3405a8fbb183959e10b` | não | não |
| `20261102000000_update_products_source_identity_constraint` | `885b8de5dcc0cf5e7618d574ba5c013ae8b60c9b983260706c5819422564454f` | não | não |
| `20261104000000_runtime_least_privilege` | `24471ed369980bc861d885dc68d9edd3747de73457be620d166eae8b1ec47d6e` | não | **não** (`_prisma_migrations` tem 1 linha) [LEITURA] |
| `migration_lock.toml` | `99836963713b4f5b269ad49af0ed3d7b0b2e336115c2f92dc9ac683d139d0900` | sim | — |

Todos iguais aos da 3D.3.10, antes e depois desta entrega.

## 5. Backup: recuperado e novo [EXEC]

**O backup da 3D.3.8 nunca esteve ausente.** O adendo da 3D.3.10 procurou `cardapio_test_pre3d38_20261104-012137.dump`, mas o arquivo se chama **`cardapio_digital_test_pre3d38_20261104-012137.dump`**. Ele está no caminho original com o SHA-256 original (`1be946052157…925265`). A conclusão "backup não encontrado" decorreu de erro no nome procurado. O adendo não foi alterado; esta seção o corrige.

Novo backup, como autorizado:

| Requisito | Como foi atendido |
|---|---|
| Só leitura | Perfil `migrate-test` com `PGOPTIONS=-c default_transaction_read_only=on`; confirmado `transaction_read_only = on` |
| Origem exclusivamente Test | Perfil, URL e `current_database()` = `cardapio_digital_test`; host `127.0.0.1:5432`; sem isso, abortaria |
| Versão compatível | `pg_dump (PostgreSQL) 18.6`, servidor `180006` |
| Fora do repositório e do OneDrive | `C:\Users\u1n3c\AppData\Local\RustikaBackups\` |
| Nome exclusivo, sem sobrescrita | Data UTC e sufixo aleatório; nome reservado com abertura exclusiva (`wx`) antes do `pg_dump`; o dump antigo segue intacto |
| Senha | Só no ambiente do processo filho; nunca impressa nem gravada |
| Timeout e falhas | 30 s por consulta, 120 s no dump, 60 s nas leituras; falha preserva o arquivo para análise e interrompe |

## 6. SHA-256 e localização do backup [EXEC]

```text
C:\Users\u1n3c\AppData\Local\RustikaBackups\cardapio_digital_test_pre-migrations-3d311_20261104-102650Z_1a9636.dump
tamanho: 20 928 bytes
SHA-256: f2304f0ac150218ef6dc36a1cbdc517402180daa8ed73bd949c6d2f05306cadf
formato: PGDMP 1.16.0, CUSTOM, gzip; pg_dump 18.6; origem 18.6; dbname cardapio_digital_test; 59 entradas TOC
```

Validação sem restaurar:

1. Arquivo existe; tamanho e SHA-256 acima.
2. `pg_restore --list`: exit 0, cabeçalho coerente.
3. Script SQL gerado **em arquivo**, sem conectar a banco (`pg_restore --create --file`): 564 linhas, `CREATE DATABASE cardapio_digital_test`, `ALTER DATABASE … OWNER TO cardapio_migrator`, as 7 tabelas, 15 linhas de GRANT, REVOKE ou DEFAULT PRIVILEGES, 7 `COPY`, nenhum `CREATE/ALTER ROLE` e nenhuma senha.
4. Objetos esperados para o estado anterior às migrations: só as 7 tabelas da migration inicial; nenhuma `comanda*` (0 ocorrências).
5. **Corresponde ao estado anterior às migrations pendentes.** Antes do dump, por leitura: `_prisma_migrations` com 1 linha (`20261023…`, checksum `1a9cd08b…`), objetos das pendentes ausentes, todas as tabelas com 0 linhas, nenhuma outra sessão conectada. O script SQL é **idêntico** ao do dump da 3D.3.8, exceto pelos tokens aleatórios `\restrict`/`\unrestrict` que o `pg_dump` 18 gera a cada execução.
6. Limitações: **não está provado que é restaurável**, porque nenhuma restauração foi feita. A leitura prova formato, integridade da compressão e conteúdo, não a aplicação em um banco. Roles não fazem parte do dump. O arquivo só vale para o estado atual (pré-migrations).

## 7. Revisão da migration de ACL (`20261104000000_runtime_least_privilege`) [INSP]

**Conclusão: pronta para aplicação futura, sem defeito que exija mudança. Checksum preservado.**

| Ponto | Verificação |
|---|---|
| Identidade do banco | Só `cardapio_digital_test` (runtime `cardapio_test_app`) ou `cardapio_digital_dev` (`cardapio_dev_app`); outro banco faz `RAISE EXCEPTION` |
| Identidade de quem aplica | `current_user = session_user = cardapio_migrator`, PG ≥ 17, dono do banco = migrator; roles de runtime sem atributos administrativos e sem memberships; os 11 objetos existem; nenhum owner inesperado; nenhuma ACL de coluna |
| Revogações | `ALL` de `PUBLIC` e das duas roles de runtime no banco, no schema `public`, em todas as tabelas, sequências e `_prisma_migrations`. Default privileges globais e por schema, para tabelas e sequências |
| Concessões | `CONNECT` no próprio banco, `USAGE` em `public`; `SELECT` em `admins/categories/products`; `SELECT, INSERT` em `orders/order_items/order_status_history/comanda_sessions`; `SELECT, INSERT, UPDATE` em `comandas/comanda_invitations`; `USAGE` em `orders_order_number_seq` |
| Impacto funcional | Login e sessão admin (leitura de `admins`); catálogo (leitura); convite (`upsert` de comanda precisa de INSERT, UPDATE e SELECT; convite precisa de INSERT); resgate (`UPDATE consumed_at`, INSERT de sessão); pedido (INSERT com `RETURNING`, que exige SELECT; `nextval` exige `USAGE`). As FKs são checadas com os privilégios do dono, então não é preciso `REFERENCES`. Nenhuma operação do código fica sem privilégio |
| `PUBLIC` | Revogado no banco e no schema; nas tabelas, só o que existir (hoje nada). No Test, `PUBLIC` já não tem `CONNECT` nem `USAGE` em `public` [LEITURA, dump] |
| Compatibilidade | Roda depois da `20261031` e substitui a matriz dela pela mínima; não altera DDL nem dados. As 4 anteriores ficam intactas |
| Runtime x provisionamento | Não cria nem altera roles e não toca `cardapio_test_fixtures`, cujas concessões são do script próprio |
| Dev | O ramo Dev existe, mas **não é alcançável** pelo wrapper (`prisma-run.ts` só faz deploy em Test). Em Dev ela quebraria scripts que usam `cardapio_dev_app` para escrever no catálogo (é a intenção do menor privilégio), e a checagem de owner falharia se houver objeto de outro dono. Aplicar em Dev exige rodada própria |
| Resíduos | `REVOKE … _prisma_migrations` é redundante com `ALL TABLES` (inofensivo). Tipos e funções mantêm o padrão de `PUBLIC` (não há funções no schema) |

## 8. Estratégia final das roles de fixtures

Leitura real do cluster [LEITURA, `pg_database.datacl` via conexão read-only do Test]:

| Banco | `CONNECT` de `PUBLIC` |
|---|---|
| `cardapio_digital_dev`, `cardapio_digital_shadow`, `cardapio_digital_test` | **não** (só roles explícitas) |
| `postgres`, `template1` | sim (padrão do PostgreSQL) |
| `rf004_lab_neg_20261027_01`, `rf004_lab_pos_20261027_01` | sim (dono `cardapio_migrator`) |
| `cardapio_restore_precheck` | sim (dono `postgres`, criado em 26/10/2026, anterior às entregas 3D.3.x) |
| `plataforma_sites_ia`, `plataforma_sites_ia_test` | sim (**outro projeto**) |

Defeitos do desenho da 3D.3.10:
1. O bloqueio "CONNECT de `PUBLIC` em Dev/Shadow" **não existe** hoje.
2. O script verificava só Dev e Shadow, então a role herdaria acesso a 7 outros bancos, inclusive de outro projeto.
3. O executor (seção 9) nunca passaria neste cluster.

Mantido do desenho anterior, por estar correto: criação `NOLOGIN` com `\password` e só então `LOGIN`; matriz mínima; `NOINHERIT`; sem memberships; `CONNECTION LIMIT 2`; transação única com falha fechada; sem senha versionada.

**Estratégia final:**
- **Uma role `cardapio_test_fixtures` com `LOGIN`**, sem role intermediária. `SET ROLE` foi avaliado e descartado: o `CONNECT` e o `pg_hba` valem para a role de login, então a intermediária não isola; ela acrescentaria credencial e membership; e `RESET ROLE` desfaz a troca dentro da sessão. Explicação completa em `docs/fixture-role.md`.
- **Isolamento por `pg_hba.conf`**, com 5 linhas dedicadas no topo:
  - permissão só para `cardapio_digital_test`, por SCRAM e loopback;
  - `reject` para `all` em socket local, 127.0.0.1 e ::1.
  
  Afeta só esta role, sem revogar nada de `PUBLIC`, Dev, Shadow ou do outro projeto.
- **Verificação antes do `LOGIN`**: o script de habilitação lê `pg_hba_file_rules` e exige:
  - nenhuma linha com erro;
  - reload posterior à última edição do arquivo;
  - nenhum grupo ou regex em `USER`;
  - permissões da role só para Test, com SCRAM e loopback;
  - as três recusas presentes, todas antes da primeira regra com `USER all`.
- **Pós-verificação real**: `psql -w` como fixtures em Dev e em `postgres` deve falhar com "pg_hba.conf rejects connection". O preflight da suíte repete essa prova sozinho.
- **Rollback**: remover as 5 linhas, recarregar e rodar `rollback-test-fixtures.sql`, que agora revoga concessões explícitas em qualquer banco.

Separação mantida: migration (`cardapio_migrator`), runtime (`cardapio_test_app`), fixtures (`cardapio_test_fixtures`) e conexão administrativa (role local `SUPERUSER`, só para provisionar, verificar e reverter).

Limitação: a checagem do `pg_hba` é SQL executável só por superuser e só depois de existir a role. Os testes estáticos garantem a presença das regras, não sua execução.

## 9. Correções realizadas

| # | Defeito comprovado | Correção |
|---|---|---|
| 1 | `PERMISSIONS_SQL` tratava **qualquer** `CONNECT`/`TEMP` fora do Test como violação. Como `PUBLIC` conecta em `postgres` e outros bancos, inclusive para `cardapio_test_app`, a suíte **nunca** passaria sem revogações amplas fora do RÚSTIKA | Fora do Test, só concessões **explícitas** à role contam. No Test, qualquer `CREATE`/`TEMP` (mesmo herdado) ou falta de `CONNECT` é violação |
| 2 | Nenhuma prova de que a role de fixtures não alcança outros bancos | `FIXTURES_REACHABLE_SQL` lista os bancos conectáveis por privilégio; `probeFixturesConnection` tenta autenticar em cada um (só `$connect`, nenhum comando). Uma conexão aceita aborta. Sondagem não executada também aborta |
| 3 | `provision-test-fixtures.sql` abortava sempre que `PUBLIC` tivesse `CONNECT` em Dev/Shadow, mesmo com a role `NOLOGIN` (inofensiva), e ignorava os demais bancos | Provisão `NOLOGIN` não aborta por herança, mas recusa concessão explícita fora de Test e lista os bancos alcançáveis. O isolamento é exigido no `LOGIN` |
| 4 | `verify-test-fixtures.sql` acusaria para sempre o herdado de `PUBLIC` em `postgres` e similares (nunca daria zero) | Mesma distinção explícito/herdado; seção de `pg_hba` |
| 5 | Rollback só revogava em Dev/Shadow | Laço sobre qualquer banco com concessão explícita |
| 6 | Três testes pesados estouravam o prazo padrão de 5 s sob carga, alternando entre rodadas (passavam isolados) | Prazo de 30 s só nesses três; nenhuma asserção mudou |

Compatibilidade com o executor confirmada: o preflight exige `session_user = current_user = cardapio_test_fixtures`, coerente com a role única sem `SET ROLE`.

## 10. Testes executados [EXEC]

Novos ou substituídos (+11 líquidos):

- `integration-db-support.test.ts` (+8):
  - sondagem não executada aborta;
  - conexão aceita em `postgres`, `cardapio_digital_dev` ou `plataforma_sites_ia` aborta (3 casos);
  - `reachableDatabases` testa todos e devolve só os aceitos;
  - a URL de sondagem troca só o banco e recusa 5 nomes suspeitos;
  - **abertura completa com dependências falsas**: com pg_hba recusando tudo, o preflight passa e sonda os 3 bancos sem nenhuma escrita;
  - com um banco de outro projeto aceitando, aborta antes de qualquer escrita.
- `fixtures-role-provisioning.test.ts`: o teste do desenho antigo virou 4:
  - provisão `NOLOGIN` sem aborto por herança, mas com recusa de concessão explícita;
  - `LOGIN` condicionado ao `pg_hba` (erros, reload, grupos/regex, padrão das permissões, 3 recusas, ordem, bloco antes do `ALTER ROLE … LOGIN`);
  - exemplo de `pg_hba` linha a linha;
  - verificação e rollback cobrindo qualquer banco.

Trava de entrada [EXEC, sem conexão]: `npm run test:integration:db` sem as variáveis abortou no `globalSetup` com `IntegrationAbort`. `vitest list` confirma que a config inclui só os 4 arquivos `*.integration.ts`.

## 11. Resultados backend/frontend [EXEC]

| Projeto | Typecheck | Testes | Build |
|---|---|---|---|
| Backend | exit 0 | **568/568**, 28 arquivos, em **duas rodadas seguidas** (557 + 11) | exit 0 |
| Frontend | não alterado; não executado | 82/82 [HERD] | — |

Todos os testes são com mocks ou estáticos; nenhum escreve no PostgreSQL.

## 12. Estado da suíte real

| Requisito | Situação |
|---|---|
| Fora do `npm test` | sim: sufixo `.integration.ts`, sem `vitest.config.ts`, config própria (testado) |
| Confirmações explícitas | `RUSTIKA_DB_INTEGRATION=1` e `RUSTIKA_DB_INTEGRATION_CONFIRM=WRITE_CARDAPIO_DIGITAL_TEST`, `NODE_ENV=test`, `DB_PROFILE=app-test`, sem confirmação de deploy |
| Banco e identidade | `cardapio_digital_test` nas 3 conexões; `current_user` e `session_user` exatos; sem atributos administrativos; mesmo servidor |
| 5 migrations e checksums | gravados e no disco, todas concluídas e não revertidas |
| ACL efetiva | `PERMISSIONS_SQL` (corrigido) e a nova sondagem de isolamento |
| Fixtures isoladas e limpeza | por `runId`, filhos antes dos pais, sem `TRUNCATE`, resíduo zero conferido; advisory lock antes da checagem de resíduos |
| Dev/Shadow | rejeitados pelo banco esperado e, para a role de fixtures, pela sondagem |
| Falha antes de escrever | provado com mocks (seção 10) |
| Estado atual | **não pode rodar**: faltam 4 migrations, a role, o `pg_hba` e o `fixtures-test.env`. O preflight abortaria, por desenho |

## 13. Bloqueadores remanescentes

1. Autorização para cada operação da seção 14.
2. Decisão sobre `backend/tests/health.test.ts` versus a cópia de conflito do OneDrive (2 testes possivelmente perdidos), **antes** do checkpoint.
3. Prova de restauração (Operação B): exige role com `CREATEDB`/`SUPERUSER` (o migrator não tem) e autorização para criar e apagar o banco descartável.
4. Edição do `pg_hba.conf` (Operação D): configuração do cluster, feita pelo operador com backup do arquivo.
5. Exposição já existente (não causada por esta entrega): `PUBLIC` dá `CONNECT` e `TEMP` em `postgres`, `template1`, `rf004_lab_*`, `cardapio_restore_precheck` e nos bancos de outro projeto a **toda** role do cluster, inclusive `cardapio_test_app` e `cardapio_dev_app`. Tratar fora desta trilha, porque afeta outras aplicações.
6. Dev continua sem a migration de menor privilégio; o wrapper não permite aplicá-la lá.
7. Sincronização OneDrive com outra máquina: risco contínuo de novos conflitos enquanto não houver checkpoint e remoto.

## 14. Próximas operações autorizáveis

Cada uma é independente e exige autorização própria. Nenhuma passa à seguinte automaticamente.

### Operação A — Checkpoint Git
- Pré-condição: decidir o item 13.2.
- Comando: o `git add` com exclusões da 3D.3.10, seção 15.4 (sem mudança). Esperado: **169 arquivos**.
- Conferir antes do commit:
  - `git diff --cached --name-only | Measure-Object -Line` = 169;
  - o filtro de proibidos da 3D.3.10 devolve vazio;
  - `git diff --cached --name-only | Select-String '\.env$|fixtures-test|\.dump$'` vazio;
  - SHA-256 das 5 migrations iguais à seção 4.
- Commit somente após autorização; sem push (não há remoto).
- Parada: contagem diferente de 169, qualquer item proibido ou aviso de CRLF/LF em migration.

### Operação B — Prova de restauração
- Dump: `…\cardapio_digital_test_pre-migrations-3d311_20261104-102650Z_1a9636.dump`, conferir o SHA-256 `f2304f0a…6cadf` antes.
- Seguir `backend/docs/restore-backup.md`: banco `cardapio_restore_check_<AAAAMMDD>_<HHMMSS>`, nunca `--create`, `--no-owner --no-privileges --single-transaction --exit-on-error`, validar com `verify-restore.sql` e remover o banco descartável.
- Nunca restaurar sobre Dev, Test, Shadow, `postgres` ou template.
- Parada: SHA divergente, destino existente ou fora do padrão, qualquer erro do `pg_restore`.

### Operação C — Migrations em Test (4 pendentes, em ordem)
```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
npm run db:migrate:status:test                 # esperado: 4 pendentes, nenhuma falha
$env:CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION = 'APPLY_CARDAPIO_DIGITAL_TEST'
npm run db:migrate:deploy:test                 # wrapper: só migrate-test / cardapio_digital_test
Remove-Item Env:CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION
npm run db:migrate:status:test                 # esperado: up to date
```
- Pós: `_prisma_migrations` com 5 linhas concluídas e os checksums da seção 4; privilégios de `cardapio_test_app` iguais à matriz da seção 7 (consulta da 3D.3.9, seção 8); `pg_default_acl` sem DML para runtime.
- O wrapper recusa Dev.
- Parada: pré-condição falsa, erro, linha sem `finished_at`, checksum divergente. Nunca `migrate reset`/`resolve`.

### Operação D — Provisionamento de fixtures
1. Backup do `pg_hba.conf` fora do OneDrive; inserir as 5 linhas do exemplo no topo; `SELECT pg_reload_conf()`.
2. `provision-test-fixtures.sql` (exige a Operação C concluída), `\password cardapio_test_fixtures`, `enable-test-fixtures-login.sql`, `verify-test-fixtures.sql` (violações = 0).
3. Pós-verificação: `psql -w` como fixtures em `cardapio_digital_dev` e `postgres` deve falhar.
4. Criar `fixtures-test.env` fora do repositório e do OneDrive.
- Parada: qualquer `RAISE`, conexão aceita fora do Test, violação diferente de zero.

### Operação E — Integração real
```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
$env:NODE_ENV = 'test'; $env:DB_PROFILE = 'app-test'
$env:RUSTIKA_DB_INTEGRATION = '1'; $env:RUSTIKA_DB_INTEGRATION_CONFIRM = 'WRITE_CARDAPIO_DIGITAL_TEST'
npm run test:integration:db
Remove-Item Env:RUSTIKA_DB_INTEGRATION, Env:RUSTIKA_DB_INTEGRATION_CONFIRM, Env:NODE_ENV, Env:DB_PROFILE
```
- Cobre login, convite, resgate, comanda, pedido, persistência, idempotência, concorrência, preços e produtos internos, com limpeza por execução.
- Se interrompida: `npm run test:integration:db:cleanup` (dry-run) e depois `-- --execute`.
- Parada: qualquer `IntegrationAbort`, resíduo diferente de zero, falha de cenário.

## 15. Parecer final

**CONCLUÍDA.**

| Critério | Situação |
|---|---|
| Backup novo, legível e identificado | sim; e o backup antigo nunca esteve ausente (nome procurado errado na 3D.3.10) |
| Plano da role de fixtures coerente | sim; estratégia final com `LOGIN` único, isolamento por `pg_hba` e prova por conexão; 3 defeitos do desenho anterior corrigidos |
| Migration de menor privilégio pronta | sim; revisada, sem alteração, checksum preservado |
| Suíte real preparada e protegida | sim; incompatibilidade com o cluster real corrigida, com novas provas por mocks |
| Regressão | backend 568/568 (2 rodadas), typecheck e build ok; frontend não alterado |
| Checkpoint pronto para aprovação | sim; 169 arquivos, com pendência de decisão no item 13.2 |
| Bloqueios documentados | seção 13 |

A restaurabilidade do backup e a segurança real das ACLs continuam **não comprovadas** até as Operações B a E.

Nenhuma fase seguinte foi iniciada.
