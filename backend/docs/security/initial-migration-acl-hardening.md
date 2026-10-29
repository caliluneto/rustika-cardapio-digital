# Hardening de ACLs — primeira migração

Documento de revisão e operação assistida. A única operação já executada foi o
`REVOKE TRUNCATE` da default ACL de `cardapio_test_app`, confirmado na Fase
1B.3E. As demais etapas que conectam ao PostgreSQL, alteram privilégios ou
aplicam a migration exigem autorização específica.

Migration definitiva:
`backend/prisma/migrations/20261023000000_initial_schema/migration.sql`.

## Contexto e riscos

- A migration será aplicada por `cardapio_migrator`.
- `cardapio_dev_app` e `cardapio_test_app` são as roles de aplicação.
- A inspeção da Fase 1B.2D identificou default ACLs concedendo `arwd` às roles de
  aplicação no ambiente de desenvolvimento e `arwdD` no ambiente de teste. O `D`
  representa `TRUNCATE`, que não deve ser concedido à aplicação.
- A tabela `public._prisma_migrations` é criada pelo `cardapio_migrator` no
  primeiro `migrate deploy`. Por isso, ela pode herdar as default ACLs definidas
  para esse owner e ficar acessível às roles de aplicação.
- Default ACLs são por owner (`defaclrole`) e podem ser globais ou específicas de
  schema. A inspeção abaixo deve confirmar o owner e a origem real de cada
  privilégio antes de qualquer ajuste.
- Privilégios efetivos podem vir de concessão direta, de role herdada ou de
  `PUBLIC`. Os ajustes devem ser verificados com `has_table_privilege` e com a
  expansão da ACL (`aclexplode`), não apenas com `information_schema`.

## Sequência segura de aplicação

1. Revisão somente leitura dos privilégios (etapa 1).
2. Ajuste autorizado das default ACLs de `cardapio_test_app` (etapa 2,
   concluída na Fase 1B.3E).
3. Migration no banco de testes, com a aplicação parada (etapa 3).
4. Proteção imediata de `_prisma_migrations` (etapa 4).
5. Validação final e liberação da aplicação (etapa 5).
6. Repetição controlada em desenvolvimento/produção, com nova autorização.

Não iniciar a aplicação entre as etapas 3 e 4. O objetivo é evitar que uma
credencial de aplicação acesse `_prisma_migrations` antes do `REVOKE`.

## 1. Revisão somente leitura

Executar conectado ao banco de testes com uma role de inspeção autorizada. Não
usar credenciais de aplicação para os comandos de revisão.

### 1.1 Atributos das roles

```sql
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin
FROM pg_roles
WHERE rolname IN ('cardapio_migrator', 'cardapio_dev_app', 'cardapio_test_app')
ORDER BY rolname;
```

`rolinherit = true` indica que os privilégios das roles herdadas são aplicados
automaticamente. A verificação efetiva deve usar `has_table_privilege`.

### 1.2 Memberships e herança

```sql
SELECT member.rolname AS member_role,
       granted.rolname AS granted_role,
       m.admin_option
FROM pg_auth_members m
JOIN pg_roles member ON member.oid = m.member
JOIN pg_roles granted ON granted.oid = m.roleid
WHERE member.rolname IN ('cardapio_migrator', 'cardapio_dev_app', 'cardapio_test_app')
ORDER BY member.rolname, granted.rolname;
```

Se o `TRUNCATE` ou o acesso a `_prisma_migrations` vier de uma role de grupo, o
`REVOKE` deve ser direcionado ao grantee real identificado nas consultas 1.3 e
1.4, não apenas à role de aplicação.

### 1.3 Default ACLs (globais e do schema `public`)

```sql
SELECT
  pg_get_userbyid(d.defaclrole) AS owner_role,
  COALESCE(n.nspname, '(global)') AS schema_name,
  CASE d.defaclobjtype
    WHEN 'r' THEN 'table'
    WHEN 'S' THEN 'sequence'
    WHEN 'f' THEN 'function'
    WHEN 'T' THEN 'type'
    WHEN 'n' THEN 'schema'
    ELSE d.defaclobjtype::text
  END AS object_type,
  CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
  a.privilege_type,
  a.is_grantable
FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) a
WHERE d.defaclnamespace = 0 OR n.nspname = 'public'
ORDER BY owner_role, schema_name, object_type, grantee, a.privilege_type;
```

Confirmar:

- o owner que cria as tabelas da migration;
- se `cardapio_test_app` recebe `TRUNCATE` em default ACL de tabelas;
- se `cardapio_dev_app` ou `cardapio_test_app` recebem qualquer privilégio em
  default ACL de tabelas;
- se há concessões para `PUBLIC`;
- se a default ACL é global ou específica do schema `public`.

### 1.4 ACLs de tabelas existentes, incluindo `PUBLIC`

Executar depois que `_prisma_migrations` existir.

```sql
SELECT
  c.relname,
  CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
  a.privilege_type,
  a.is_grantable
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
ORDER BY c.relname, grantee, a.privilege_type;
```

### 1.5 Privilégios efetivos das roles de aplicação

Executar depois que `_prisma_migrations` existir. `has_table_privilege` considera
concessões diretas, roles herdadas e `PUBLIC`.

```sql
WITH app_roles(rolname) AS (
  VALUES ('cardapio_dev_app'), ('cardapio_test_app')
),
privileges(priv) AS (
  VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
         ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
)
SELECT r.rolname,
       p.priv,
       has_table_privilege(r.rolname, 'public._prisma_migrations', p.priv) AS allowed
FROM app_roles r
CROSS JOIN privileges p
ORDER BY r.rolname, p.priv;
```

Resultado esperado após o hardening: todas as linhas com `allowed = false`.
Para localizar a origem de um `allowed = true`, usar a consulta 1.4 e a consulta
1.2 (membership).

### 1.6 Privilégios de schema e `PUBLIC`

```sql
SELECT r.rolname,
       has_schema_privilege(r.rolname, 'public', 'USAGE') AS usage,
       has_schema_privilege(r.rolname, 'public', 'CREATE') AS create
FROM (VALUES ('cardapio_dev_app'), ('cardapio_test_app')) r(rolname)
ORDER BY r.rolname;

SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type
FROM pg_namespace n
CROSS JOIN LATERAL aclexplode(n.nspacl) a
WHERE n.nspname = 'public'
ORDER BY grantee, a.privilege_type;
```

As roles de aplicação devem manter `USAGE` em `public`, mas não `CREATE`.

### 1.7 Owner de `_prisma_migrations`

```sql
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = '_prisma_migrations';
```

Esperado: owner `cardapio_migrator`. Não alterar ownership nesta fase.

## 2. Ajuste autorizado antes da primeira migration

### 2.1 Remover `TRUNCATE` das default ACLs de `cardapio_test_app`

Status: comando executado e confirmado na Fase 1B.3E; a default ACL de tabelas
de `cardapio_test_app` ficou com `DELETE`, `INSERT`, `SELECT` e `UPDATE`, sem
`TRUNCATE`. O bloco abaixo permanece como registro do procedimento.

Executar somente após a revisão da etapa 1 e com autorização. O executor precisa
ser membro de `cardapio_migrator` com `ADMIN OPTION` ou superuser, e o `FOR ROLE`
deve corresponder ao `owner_role` identificado em 1.3.

Default ACL específica do schema `public`:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE cardapio_migrator IN SCHEMA public
  REVOKE TRUNCATE ON TABLES FROM cardapio_test_app;
```

Se a inspeção mostrar uma default ACL global (`schema_name = '(global)'`), usar a
forma global correspondente:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE cardapio_migrator
  REVOKE TRUNCATE ON TABLES FROM cardapio_test_app;
```

Se a concessão estiver em uma role de grupo, repetir o `REVOKE` para o grantee
real. Não revogar privilégios de `cardapio_migrator` nem alterar ownership.

Se já existirem tabelas no schema (não esperado antes da primeira migration),
corrigir as tabelas existentes em janela autorizada:

```sql
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM cardapio_test_app;
```

### 2.2 Verificação do ajuste

Repetir as consultas 1.3 e 1.6. Critérios:

- nenhuma linha de `TRUNCATE` para `cardapio_test_app` em default ACL de tabelas;
- `cardapio_dev_app` inalterado (`arwd`), sem `TRUNCATE`;
- `PUBLIC` sem privilégios indevidos;
- roles de aplicação sem `CREATE` no schema `public`.

Depois da migration, repetir 1.4 e 1.5 para as novas tabelas.

## 3. Migration no banco de testes

Pré-condições:

- etapa 1 revisada;
- etapa 2 aplicada e verificada;
- aplicação e suíte de testes paradas;
- backup/restauração do banco de testes definidos e com restauração verificada
  conforme a seção 7;
- autorização específica para conectar e aplicar DDL.

Fluxo obrigatório:

1. O wrapper `backend/scripts/prisma-run.ts` já aceita `migrate status` e
   `migrate deploy` exclusivamente com o perfil `migrate-test`, banco
   `cardapio_digital_test` e finalidade `migration`. `validate` e `generate`
   permanecem disponíveis. `migrate dev`, `reset`, `resolve`, `db push` e seed
   continuam bloqueados.
2. Consultar o status antes do deploy:

   ```powershell
   npm run db:migrate:status:test
   ```

   Antes do deploy, o status pode retornar código diferente de zero por haver
   migration pendente; interpretar a saída, não tratar automaticamente como
   falha.

3. Executar `migrate deploy` exclusivamente pelo wrapper, sem passar URL na
   linha de comando e com confirmação explícita apenas no ambiente da execução:

   ```powershell
   $env:CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION = "APPLY_CARDAPIO_DIGITAL_TEST"
   npm run db:migrate:deploy:test
   ```

   O wrapper verifica a confirmação antes de carregar o arquivo de segredo. Sem
   a variável, o comando falha sem acessar credenciais e sem chamar o Prisma.

4. Não usar `npx prisma migrate deploy` diretamente, não usar credenciais de
   aplicação e não executar `migrate dev`, `migrate reset`, `migrate resolve`,
   `db push` ou seed.

Antes do deploy, confirmar a existência e o conteúdo de
`backend/prisma/migrations/migration_lock.toml` com
`provider = "postgresql"`, e confirmar que a migration está em
`20261023000000_initial_schema`.

## 4. Suspensão de `CONNECT` e proteção de `_prisma_migrations`

### 4.1 Suspensão temporária de `CONNECT`

Procedimento opcional, executado somente com autorização específica e com a
aplicação parada. O banco `cardapio_digital_test` pertence a
`cardapio_migrator`, que pode revogar e restaurar o `CONNECT` da aplicação sem
usar `postgres`.

Antes do deploy:

1. Identificar sessões ativas e confirmar que não há conexão de
   `cardapio_test_app`:

   ```sql
   SELECT pid, usename, datname, state
   FROM pg_stat_activity
   WHERE datname = 'cardapio_digital_test'
     AND usename = 'cardapio_test_app';
   ```

   Se houver sessão ativa, interromper a execução e encerrar a sessão somente
   com autorização específica.

2. Suspender o `CONNECT` da aplicação:

   ```sql
   REVOKE CONNECT ON DATABASE cardapio_digital_test FROM cardapio_test_app;
   ```

3. Confirmar que `PUBLIC` não concede `CONNECT` indiretamente e que
   `cardapio_migrator` continua podendo conectar.

Após o deploy, o `REVOKE` em `_prisma_migrations` e a validação final, restaurar
a concessão original identificada na auditoria. O comando abaixo assume
`CONNECT` direto para `cardapio_test_app`:

```sql
GRANT CONNECT ON DATABASE cardapio_digital_test TO cardapio_test_app;
```

Se o `CONNECT` vier de `PUBLIC` ou de grupo, restaurar a origem real, não criar
concessão direta divergente. Verificar com `has_database_privilege` que
`cardapio_test_app` voltou a ter `CONNECT` e que não recebeu `CREATE`. Se o
deploy falhar, restaurar o `CONNECT` apenas depois de definir o estado do banco.

### 4.2 Proteção de `_prisma_migrations`

Executar imediatamente após o `migrate deploy`, como owner da tabela/migrator ou
superuser, antes de iniciar a aplicação.

```sql
REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM cardapio_dev_app;
REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM cardapio_test_app;
REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM PUBLIC;
```

Se a consulta 1.4 identificar uma role de grupo como grantee, revogar também
dessa role:

```sql
-- Substituir <grupo_identificado> pelo grantee real retornado pela inspeção.
REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM <grupo_identificado>;
```

Não é necessário `REVOKE` em sequência para `_prisma_migrations`; a tabela não
possui coluna com sequência própria. Não alterar o owner da tabela.

Verificação obrigatória:

- consulta 1.7: owner `cardapio_migrator`;
- consulta 1.4: nenhuma linha para `cardapio_dev_app`, `cardapio_test_app` ou
  `PUBLIC` em `_prisma_migrations`;
- consulta 1.5: todas as combinações de privilégio com `allowed = false`;
- `cardapio_migrator` continua conseguindo ler/escrever a tabela (validar com
  `migrate status` autorizado).

## 5. Validação final no banco de testes

Executar somente leitura, com autorização:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'admins', 'categories', 'products', 'orders',
    'order_items', 'order_status_history'
  )
ORDER BY table_name;

SELECT migration_name, finished_at, rolled_back_at
FROM public._prisma_migrations
ORDER BY started_at;

SELECT conname, contype
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conname IN (
    'products_price_non_negative',
    'orders_total_amount_non_negative',
    'order_items_unit_price_snapshot_non_negative',
    'order_items_subtotal_non_negative',
    'order_items_quantity_positive'
  )
ORDER BY conname;

SELECT enumlabel
FROM pg_enum
WHERE enumtypid = 'public.order_status'::regtype
ORDER BY enumsortorder;

SELECT conname, contype, confdeltype, confupdtype
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND contype = 'f'
ORDER BY conname;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'admins', 'categories', 'products', 'orders',
    'order_items', 'order_status_history'
  )
ORDER BY indexname;

SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'S'
  AND c.relname = 'orders_order_number_seq';
```

Critérios de liberação:

- 6 tabelas de domínio presentes, além de `_prisma_migrations`;
- enum `order_status` com exatamente `RECEIVED`, `IN_PREPARATION`, `READY` e
  `DELIVERED`;
- 5 FKs com `confdeltype = 'r'` e `confupdtype = 'c'`, e 5 CHECK constraints
  nomeadas;
- 13 índices explícitos e 6 PKs;
- sequência `orders_order_number_seq` existente, com owner
  `cardapio_migrator`;
- `_prisma_migrations` com a migration `20261023000000_initial_schema`
  aplicada, `finished_at` preenchido e `rolled_back_at` nulo;
- `_prisma_migrations` inacessível às roles de aplicação, `PUBLIC` e grupos;
- `cardapio_test_app` sem `TRUNCATE` nas default ACLs e nas tabelas;
- `cardapio_test_app` com `SELECT`, `INSERT`, `UPDATE` e `DELETE` nas 6 tabelas
  de domínio, sem `REFERENCES` ou `TRIGGER`;
- `cardapio_test_app` com `SELECT` e `USAGE` na sequência, sem `UPDATE`;
- `cardapio_test_app` com `USAGE` e sem `CREATE` no schema `public`;
- `cardapio_test_app` com `CONNECT` restaurado após a validação;
- suíte de testes da aplicação aprovada usando `cardapio_test_app` (requer
  autorização de conexão).

### 5.1 Critérios de interrupção

Interromper imediatamente, manter a aplicação parada e não repetir comandos se:

- o hash de `migration.sql`, o lockfile ou `schema.prisma` divergirem dos
  valores registrados;
- houver sessão ativa de `cardapio_test_app` durante o deploy;
- `_prisma_migrations` já contiver registro da migration antes do deploy;
- o deploy falhar, parcial ou totalmente;
- qualquer objeto, constraint, índice, sequência ou ACL esperada estiver
  ausente ou divergente;
- `_prisma_migrations` continuar acessível a `cardapio_test_app`, `PUBLIC` ou
  grupo;
- a restauração de `CONNECT` ou a validação da aplicação falhar;
- não houver snapshot/restauração verificada disponível.

## 6. Etapas que exigem nova autorização

| Etapa | Autorização necessária |
| --- | --- |
| Consultas somente leitura da etapa 1 | Sim, conexão com banco real |
| `ALTER DEFAULT PRIVILEGES` / `REVOKE TRUNCATE` | Concluído na Fase 1B.3E; nova execução exige autorização |
| Alterar `prisma-run.ts` para permitir `migrate deploy`/`status` | Concluído na Fase 1B.3G; uso exige autorização |
| Criar/commitar `migration_lock.toml`, se necessário | Concluído; não recriar sem autorização |
| Backup e teste de restauração do banco de testes | Sim, infraestrutura e possível criação de banco temporário |
| `migrate deploy` no banco de testes | Sim, DDL em banco real |
| Suspender/restaurar `CONNECT` de `cardapio_test_app` | Sim, alteração de ACL de banco |
| `REVOKE` em `_prisma_migrations` | Sim, alteração de ACL |
| Iniciar aplicação/testes de integração | Sim, conexão com banco real |
| Repetir o fluxo em desenvolvimento/produção | Sim, autorização separada por ambiente |

## 7. Backup e recuperação do banco de teste

Nenhum backup, restauração, criação ou exclusão de banco foi executado nesta
fase. O deploy permanece bloqueado até existir um ponto de restauração
verificado.

### 7.1 Requisito de backup

`pg_dump` e `pg_restore` não estão disponíveis no ambiente atual. Portanto, o
backup deve usar uma destas opções aprovadas:

1. **Preferencial:** snapshot da instância/volume do PostgreSQL, tomado com a
   aplicação parada e sem sessões ativas de `cardapio_test_app`.
2. **Alternativa:** dump lógico em formato customizado, se `pg_dump` for
   disponibilizado e autorizado, gravado em local aprovado fora do workspace e
   do OneDrive.

Antes do snapshot/dump:

- parar backend, frontend e test runners;
- confirmar zero sessões de aplicação em `pg_stat_activity`;
- registrar versão do PostgreSQL, banco, owner, roles, schema `public`,
  default ACLs e ausência de tabelas de domínio e de `_prisma_migrations`;
- registrar os hashes da migration, do lockfile e do `schema.prisma`;
- registrar identificador, data/hora e responsável pelo backup.

### 7.2 Verificação da capacidade de restauração

O backup só é aceito após um teste de restauração em ambiente isolado, sem usar
`cardapio_digital_test` como destino. O teste deve confirmar:

- banco restaurado com owner `cardapio_migrator`;
- schema `public` com owner `pg_database_owner`;
- roles `cardapio_migrator`, `cardapio_test_app` e `cardapio_dev_app` presentes;
- `cardapio_test_app` com `CONNECT` e `USAGE`, sem `CREATE`;
- `cardapio_migrator` com `CONNECT`, `CREATE` e `TEMP`;
- default ACLs equivalentes ao estado imediatamente anterior ao deploy, sem
  `TRUNCATE` para `cardapio_test_app`;
- ausência das 6 tabelas de domínio e de `_prisma_migrations`;
- ausência de acesso de `cardapio_test_app` ao shadow.

Registrar a evidência do teste. Sem essa verificação, não executar o deploy.

### 7.3 Recuperação

- Não usar `migrate reset` como rollback.
- Não usar `migrate resolve` para marcar como aplicada uma migration que falhou
  ou deixou objetos parciais.
- Em falha, manter a aplicação parada, preservar logs redigidos, inspecionar
  `_prisma_migrations` e os objetos criados e não repetir o deploy às cegas.
- A migration SQL não deve ser assumida como atômica; pode haver aplicação
  parcial.
- Recuperar pelo snapshot/dump verificado ou por recriação controlada do banco,
  sempre com autorização específica.
- Após qualquer restauração, revalidar hashes, owner, schema, roles, default
  ACLs, ausência de tabelas e ausência de `_prisma_migrations` antes de solicitar
  nova autorização.
- Se o `REVOKE` de `_prisma_migrations` falhar, manter a aplicação parada e
  corrigir a ACL ou restaurar o backup.
- Se o `CONNECT` tiver sido suspenso, restaurá-lo somente depois de definir o
  estado do banco.

### 7.4 Limitações

- Não há backup automatizado nem verificação de restauração concluída.
- `pg_dump` e `pg_restore` não estão disponíveis (`PG_DUMP=False`,
  `PG_RESTORE=False`).
- Não há autorização para criar, excluir ou restaurar bancos nesta fase.
- Não registrar senhas, URLs reais, conteúdo de arquivos de credenciais ou
  dumps neste documento ou em logs.
