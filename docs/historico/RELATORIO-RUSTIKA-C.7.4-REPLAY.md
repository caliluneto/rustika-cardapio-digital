# RÚSTIKA — C.7.4 — validação pós-replay

Data: 2026-11-09. Escopo: consultas ao Neon em modo somente leitura. Nenhuma migration, seed, alteração de schema/ACL, renomeação ou deploy foi executado nesta validação.

## Identidade e histórico

- Perfil usado: `migrate-homolog-replay`, com secrets já preparados fora do repositório. Nenhuma URL ou senha foi impressa ou gravada neste relatório.
- `npm run homolog:replay:status`: código de saída **0**, `7 migrations found`, `Database schema is up to date!`. O wrapper verificou previamente o inventário SHA-256 e a identidade do servidor.
- Consultas em `BEGIN READ ONLY`: banco `cardapio_digital_test`, role `cardapio_migrator`, `neon.project_id=aged-scene-47291697` e marca do cluster iguais ao perfil aprovado.
- `public._prisma_migrations`: **7 registros exatos**, todos com `finished_at` preenchido, nenhum com `rolled_back_at`; nomes e checksums **7/7** iguais a `backend/scripts/bootstrap/expectedMigrations.ts`. Não há migration pendente ou registro de falha.
- `ops/homolog/sql/03-verify-replay.sql`: **PASSOU**, notice `OK: replay conforme o esperado`. Foi enviado pelo cliente `pg`, retirando apenas a metainstrução `psql` `\set ON_ERROR_STOP on`; o próprio SQL executou `BEGIN READ ONLY` e `ROLLBACK`.

## Schema, permissões e dados

| Verificação | Resultado |
| --- | --- |
| Tabelas em `public` | 10, incluindo `_prisma_migrations` |
| Índices | 38 |
| Constraints | 100: 15 `CHECK`, 11 FKs, 64 `NOT NULL`, 10 PKs |
| Enums / sequências | 3 / 1 |
| Objetos `public` com owner diferente de `cardapio_migrator` | 0 |
| Owner do banco e schema | Aceitos pelo `03-verify-replay.sql` |
| `cardapio_test_app`: `UPDATE(orders.status)` | Sim |
| `cardapio_test_app`: `UPDATE(products.availability_state)` | Sim |
| `cardapio_test_app`: `SELECT(admins)` / `INSERT(admins)` / `SELECT(_prisma_migrations)` | Sim / não / não |
| Dados | `admins` e as outras oito tabelas de aplicação: 0 linhas cada; `_prisma_migrations`: 7 |

Fingerprint SHA-256 do snapshot: `0f941358a176c6a8ef22d9c6b897150e3fea23e7e5a5a04ab2bf1148fbb29c97`. O [snapshot A](backend/docs/c74-replay-schema-snapshot.json) foi gerado pelas funções existentes `readSchemaSnapshot` e `fingerprint`; a CLI `schema:fingerprint` não aceita o perfil transitório de replay. O arquivo contém metadados de schema e ACL, sem URL ou credencial.

**Limite do fingerprint:** `snapshotCompletenessProblems` retorna duas classes de role desconhecida: nove ACLs padrão de `cloud_admin`/`neon_superuser` e quatro memberships administrativas de `neondb_owner`. A membership observada da migradora para `neondb_owner` é `ADMIN=true`, `SET=false`, `INHERIT=false`; o `03-verify-replay.sql` a aceita. Essas entradas são específicas do ambiente Neon e **impedem declarar o snapshot completo pelo critério atual**. A comparação direta A×B ainda pode ser executada, pois `schema:compare` não chama o verificador de completude; igualdade dos hashes não dispensará a análise separada dessas roles. O snapshot não guarda os flags `SET`/`INHERIT`: a revogação futura precisa ser verificada pelos scripts Neon próprios. Não modificar migrations históricas.

## Precondições da fase definitiva

No momento da leitura: `cardapio_digital_homolog` e as três roles definitivas ainda não existem; bancos Dev/Shadow ausentes; nenhuma outra sessão no replay, transação preparada ou slot de replicação observado; `neondb_owner` tem `CREATEDB` e `CREATEROLE`.

**Bloqueio concreto para o rename:** a membership atual de `neondb_owner` em `cardapio_migrator` não concede `SET` nem `INHERIT`. O `neon/01b-elevate-inherit-for-rename.sql` exige uma membership prévia com `SET=true`; `04-finalize-rename.sql` exige herança para o owner. Nenhuma dessas permissões foi alterada nesta fase. A ausência de sessões foi observada pontualmente e deve ser reconfirmada imediatamente antes do rename.

Plano mínimo para uma fase futura autorizada de escrita: (1) preservar este snapshot A, anterior à elevação temporária; (2) conectar como administrador ao banco `postgres` pelo endpoint direto, reconfirmar precondições, executar `neon/01-grant-set-true-migrator.sql`, depois `neon/01b-elevate-inherit-for-rename.sql`; (3) executar `04-finalize-rename.sql` e revogar a membership temporária com `neon/02-revoke-set-true-migrator.sql`; (4) validar ownership e status final, gerar snapshot B, comparar A×B e resolver separadamente a classificação das roles externas; (5) concluir os grants/bootstrap controlados e só então verificar o perfil `app-homolog-neon` e preparar o Render Free conforme `backend/docs/neon-homolog.md`. O `03-verify-replay.sql` não deve ser repetido durante a janela de membership temporária. Esses passos não foram executados aqui.

Nota operacional: `pg` emitiu aviso de mudança futura na semântica de `sslmode=require`; nesta execução a validação de TLS e identidade do wrapper passou. Nenhuma versão de Prisma ou dependência foi alterada.
