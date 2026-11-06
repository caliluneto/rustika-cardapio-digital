# Integração HTTP com PostgreSQL Test — 3D.3.10

Suíte que exercita **Express real, rotas reais, services reais e Prisma real** contra
`cardapio_digital_test`. Preparada e não executada: depende das migrations em Test,
da role de fixtures e de autorização expressa para escrever em Test.

Esta é a revisão da 3D.3.9 para a 3D.3.10: agora são **5 migrations** (a quinta endurece ACLs; desde a 3D.4.1 o conjunto esperado tem **6**, a sexta concede `UPDATE (status, updated_at)` em `orders`),
a role de fixtures deixou de ser apenas uma proposta textual e a restauração do backup foi
corrigida para um plano executável — porém o dump registrado na 3D.3.9 está ausente.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `vitest.integration.config.mts` | Única config que inclui a suíte. Execução sequencial (`fileParallelism: false`). |
| `tests/integration-db/globalSetup.ts` | Primeira trava: aborta sem as variáveis antes de importar ou conectar. |
| `tests/integration-db/support/preflight.ts` | Regras puras de trava, identidade, migrations/checksums e matriz. Testadas com mocks em `npm test`. |
| `tests/integration-db/support/databases.ts` | Abre as conexões, coleta fatos só com SELECT e `pg_try_advisory_lock`, decide. |
| `tests/integration-db/support/permissions.ts` | ACL efetiva de runtime e fixtures, incluindo PUBLIC, herança, defaults e sequências. |
| `tests/integration-db/support/fixtures.ts` | Identidade da execução, provisionamento, auxiliares de cenário e limpeza escopada. |
| `tests/integration-db/support/harness.ts` | App real por arquivo, relógio controlável, helpers HTTP e resíduo zero. |
| `tests/integration-db/{auth,comandas,orders,security}.integration.ts` | Cenários. |
| `tests/integration-db/cleanup-stale.ts` | Remove resíduos de execuções interrompidas (dry-run por padrão). |
| `tests/integration-db-support.test.ts` | Prova, com mocks, que as travas abortam nos casos errados, inclusive banco inacessível. |
| `docs/fixture-role.md` + `docs/sql/{provision,enable,rollback,verify}-test-fixtures.sql` | Provisão, verificação e rollback da role de fixtures; **não executados**. |

## Por que `npm test` nunca roda a suíte

1. Os arquivos terminam em `.integration.ts`, fora do padrão do Vitest (`*.test.ts`).
2. Não existe `vitest.config.ts`; só `vitest.integration.config.mts` inclui esses arquivos,
   usado apenas por `npm run test:integration:db`.
3. `globalSetup` e cada arquivo chamam `assertIntegrationGate`, que exige
   `RUSTIKA_DB_INTEGRATION=1`, `RUSTIKA_DB_INTEGRATION_CONFIRM=WRITE_CARDAPIO_DIGITAL_TEST`,
   `NODE_ENV=test`, `DB_PROFILE=app-test` e a ausência de `CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION`.
4. Antes da primeira escrita, cada arquivo roda o preflight (abaixo). Qualquer desvio lança
   `IntegrationAbort` e fecha as conexões sem gravar nada. O advisory lock é obtido **antes**
   da checagem de resíduos, eliminando a corrida check-then-lock.
5. As fixtures são forçadas a `connection_limit=1`, para o lock de sessão permanecer na mesma
   conexão física. As URLs são lidas de segredo fora do repositório.

Testado: rodar `npm run test:integration:db` sem as variáveis aborta no `globalSetup`
(sem nenhuma conexão). `npm test` não encontra os arquivos.

## Preflight de identidade (aborta antes de escrever)

| Verificação | Conexão |
| --- | --- |
| `current_database() = cardapio_digital_test` | aplicação, fixtures, migrator |
| `current_user` = `cardapio_test_app` (aplicação), `cardapio_test_fixtures` (fixtures), `cardapio_migrator` (leitura) | aplicação, fixtures, migrator |
| `session_user` igual à role esperada (recusa `SET ROLE` disfarçado) | todas |
| Nenhuma role com superuser, bypassrls, createrole, createdb ou replication | todas |
| Mesmo servidor (`inet_server_addr():port`) nas três conexões | aplicação, fixtures, migrator |
| `server_version_num >= 170000` | todas |
| `_prisma_migrations`: exatamente as **6** migrations (a 6ª, 3D.4.1, está preparada e não aplicada), concluídas, não revertidas, checksums esperados | migrator em `SET TRANSACTION READ ONLY` |
| SHA-256 dos **6** arquivos no disco iguais aos esperados | arquivo |
| Nenhum resíduo de fixture de execução anterior | fixtures |
| Nenhum produto real com `source_code = PA062240` | fixtures |
| Matriz de ACL de runtime e fixtures, incluindo PUBLIC, defaults, colunas, schema e sequências | migrator em `SET TRANSACTION READ ONLY` |
| `pg_try_advisory_lock(3039390001)` obtido (uma execução por vez) | fixtures |

Hoje (1 aplicada, 5 pendentes) o preflight aborta por "migrations pendentes" — por desenho.
Depois da 3D.3.10, a quinta migration precisa estar concluída com o checksum
`24471ed369980bc861d885dc68d9edd3747de73457be620d166eae8b1ec47d6e`.

## Role de fixtures (preparada, NÃO criada)

A matriz foi derivada do uso real de `tests/integration-db/support/fixtures.ts`:

| Tabela | `cardapio_test_app` (runtime) | `cardapio_test_fixtures` |
| --- | --- | --- |
| `admins`, `categories`, `products` | `SELECT` | `admins/categories`: `SELECT,INSERT,DELETE`; `products`: `SELECT,INSERT,UPDATE,DELETE` |
| `comandas`, `comanda_invitations` | `SELECT,INSERT,UPDATE` | `comandas`: `SELECT,INSERT,UPDATE,DELETE`; `comanda_invitations`: `SELECT,INSERT,DELETE` |
| `comanda_sessions` | `SELECT,INSERT` | `SELECT,INSERT,DELETE` |
| `orders`, `order_items`, `order_status_history` | `SELECT,INSERT` (`orders` também `UPDATE (status, updated_at)` por coluna, migration 3D.4.1 preparada e não aplicada) | `SELECT,DELETE` |
| `_prisma_migrations` | nenhum | nenhum |
| `orders_order_number_seq` | `USAGE` | nenhum |
| Schema `public` | `USAGE` | `USAGE`, sem `CREATE` |
| Banco | `CONNECT` só em Test | `CONNECT` só em Test |

A role é `NOLOGIN` até a senha ser definida interativamente; não tem `TRUNCATE`, `REFERENCES`,
`TRIGGER`, `MAINTAIN`, memberships, atributos administrativos, `CREATE`/`TEMP` no banco ou
acesso a sequências. O provisionamento, a verificação e o rollback estão em
`docs/fixture-role.md` e `docs/sql/`. **Nada foi executado.**

### Pré-requisito de isolamento entre bancos

`REVOKE ... FROM cardapio_test_fixtures` **não** anula um `GRANT` feito a `PUBLIC`: privilégios
são aditivos. Enquanto `PUBLIC` tiver `CONNECT` em Dev/Shadow, a role herdaria o acesso. A
provisão falha fechada se detectar isso. Antes de criar a role, com autorização separada:

- aplicar a migration `20261104000000_runtime_least_privilege` nesses bancos (ela revoga
  `PUBLIC` e concede somente às roles de runtime); ou
- revogar `CONNECT, TEMPORARY ... FROM PUBLIC` e conceder explicitamente às roles legítimas; ou
- usar `pg_hba.conf` para rejeitar `cardapio_test_fixtures` fora de Test (configuração de
  cluster, não SQL versionado).

O `PERMISSIONS_SQL` também verifica `has_database_privilege` em todos os bancos conectáveis;
qualquer CONNECT fora de Test bloqueia a execução.

Segredo: `fixtures-test.env` na pasta de segredos existente, fora do repositório, com uma única
linha `DATABASE_URL="postgresql://cardapio_test_fixtures:<senha-urlencoded>@127.0.0.1:5432/cardapio_digital_test?schema=public"`.
O loader recusa outro banco, outro usuário, host não local ou chaves extras. O perfil de
fixtures é exclusivo da suíte e não pode ser usado por `prisma-run.ts` nem por
`createPrismaRuntime`.

## Fixtures (fictícias, por execução)

Cada arquivo gera um `runId` aleatório de 8 hexadecimais e um marcador `fixture-3d39-<runId>`
(o prefixo 3D.3.9 foi mantido para não invalidar os dados e testes já preparados).

| Dado | Identidade |
| --- | --- |
| Administrador ativo e inativo | `fixture-3d39-<runId>@rustika.test` / `…-inativo@rustika.test`; senha gerada na hora, só em memória, hash scrypt |
| Categoria pública | `public_key = fixture-3d39-<runId>`, nome `Fixture 3D39 <runId>` |
| Produto público numérico | `rustika-9NNNNNNN`, R$ 59,99, AVAILABLE |
| Produto PA062240 | `rustika-PA062240`, R$ 50,00, AVAILABLE (único: por isso uma execução por vez) |
| Produto indisponível / sem confirmação | `rustika-8NNNNNNN` UNAVAILABLE / `rustika-7NNNNNNN` UNKNOWN |
| Produto de preço alterável | `rustika-6NNNNNNN`, R$ 20,00 |
| Produto interno | sem `public_key` nem `source_*` |
| Comandas | faixa reservada de 10 números `9xxxx0..9` derivada do `runId`; a fechada é inserida, as abertas nascem pela API |
| Convites e sessões | pela API; estados especiais (expirado, revogado, sessão revogada/expirada) pelos auxiliares |
| Pedidos | só pela API |

## Limpeza isolada

`FixtureRun.cleanup()` apaga, numa transação e na ordem filho → pai, **apenas** linhas alcançáveis
a partir da identidade da execução: histórico, itens e pedidos das comandas reservadas; sessões,
convites e comandas reservadas; produtos da categoria da execução; a categoria; os dois admins.
Nenhum `TRUNCATE`, nenhum `DELETE` sem filtro (o plano é testado com mocks). O `afterAll` de cada
arquivo confere que nada da execução ficou. Execução interrompida: `npm run test:integration:db:cleanup`
lista; `-- --execute` remove. Pedidos consomem números da sequência `order_number`; a lacuna é
esperada. A limpeza repete o preflight completo (com `allowLeftovers`) e valida argumentos antes
de apagar.

## Execução futura (Operações C/D/E, com autorização)

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
$env:NODE_ENV = 'test'; $env:DB_PROFILE = 'app-test'
$env:RUSTIKA_DB_INTEGRATION = '1'
$env:RUSTIKA_DB_INTEGRATION_CONFIRM = 'WRITE_CARDAPIO_DIGITAL_TEST'
npm run test:integration:db
Remove-Item Env:RUSTIKA_DB_INTEGRATION, Env:RUSTIKA_DB_INTEGRATION_CONFIRM, Env:NODE_ENV, Env:DB_PROFILE
```

Resultado esperado conhecido: o teste "privilégios efetivos da role da aplicação conferem com a
matriz mínima" deve **falhar** enquanto a migration 20261104 não estiver aplicada e as ACLs
reais não forem verificadas. Depois da migration, ele passa a ser a prova de regressão; a
segurança só está comprovada após consultar as ACLs reais no banco migrado.

## Restauração de backup

O dump registrado na 3D.3.9 não existe mais no caminho documentado. O plano corrigido, com banco
descartável, `--no-owner`, `--no-privileges`, `--single-transaction`, validação e limpeza, está
em `docs/restore-backup.md`. Nada foi restaurado.
