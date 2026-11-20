# RELATÓRIO — 3D.5.3-C.6 — AUDITORIA, BLOQUEIO E PREPARAÇÃO

**Data:** 2026-11-08
**Status:** C.6 **NÃO EXECUTADA**. Nenhuma conexão com o Neon, nenhuma escrita, nenhuma credencial solicitada ou recebida na conversa.

## 1. Resultado da auditoria de controles

O script autorizado (`backend/ops/homolog/provision-neon.ts`) **não passou** no controle nº 2 da autorização: o manifesto inclui uma etapa de `prisma migrate deploy`, expressamente excluída pela C.6.

Evidências no arquivo original:

| Passo | Operação | Situação |
|---|---|---|
| `[1/8]` | Validação TLS externa | Permitido (somente leitura) |
| `[2/8]` | `SHOW server_version`, `SHOW neon.project_id`, inventário e guarda de ambiente limpo | Permitido (somente leitura) |
| `[3/8]` | Criação das roles legadas, bootstrap e marca | Permitido (provisionamento) |
| `[4/8]` | `GRANT ... SET TRUE`, `CREATE DATABASE cardapio_digital_test`, `REVOKE PUBLIC`, `GRANT CONNECT` | Permitido (provisionamento) |
| `[5/8]` | `spawnSync('npx', ['prisma', 'migrate', 'deploy'])` (linhas 98–107) | **BLOQUEADO — fora da autorização** |
| `[6/8]` | Leitura de `_prisma_migrations` (linhas 113–116) | **BLOQUEADO — depende das migrations** |
| `[7/8]` | `GRANT ... INHERIT TRUE`, `ALTER DATABASE ... RENAME`, `ALTER ROLE ... RENAME` (linhas 120–126) | **BLOQUEADO — finalização pós-migrations** |
| `[8/8]` | `REVOKE` da membership e checagem da role final | Parcial: o `REVOKE` é permitido; a checagem da role final não se aplica antes do rename |

Além da etapa de migrations, a auditoria encontrou lacunas que impediriam uma execução C.6 correta:

- A role de marca é criada sem `COMMENT ON ROLE`; a verificação de identidade do servidor exige o comentário `rustika-homolog-cluster:<UUID>`.
- As senhas de `cardapio_test_app` e `cardapio_homolog_bootstrap` não são definidas; o preflight exige três senhas distintas e com pelo menos 24 caracteres.
- Não há validação do endpoint (`ep-sweet-king-bd7i7ypb`), do banco administrativo (`neondb`) nem recusa explícita de host `-pooler`.
- Não há verificação pós-escrita de ownership, atributos das roles e ACLs do banco de replay.
- Em falha parcial, o script não inventaria os objetos já criados.
- O script não tem interlock contra execução acidental do fluxo completo.

## 2. Ação de bloqueio aplicada

Foi adicionado um interlock no início de `provision-neon.ts`:

```text
BLOQUEADO: provision-neon.ts inclui prisma migrate deploy/rename, fora do escopo da C.6.
Use ops/homolog/provision-neon-c6.ts (somente banco e roles, sem migrations).
```

O script completo só prossegue com `RUSTIKA_C6_FULL_REPLAY_ACK=I_ACKNOWLEDGE_PRISMA_MIGRATE_DEPLOY`. Essa variável **não foi definida** e não deve ser definida nesta etapa.

## 3. Artefatos preparados

### 3.1 `backend/ops/homolog/provision-neon-c6.ts`

Script interativo, somente provisionamento. Manifesto exato:

1. Confirmação digitada `C.6-PROVISION`.
2. Leitura oculta da Connection String administrativa.
3. Leitura oculta de três senhas distintas (mínimo 24 caracteres):
   - `cardapio_migrator`;
   - `cardapio_test_app`;
   - `cardapio_homolog_bootstrap`.
4. Validação da URL: `postgres://`/`postgresql://`, hostname `*.aws.neon.tech`, endpoint `ep-sweet-king-bd7i7ypb`, ausência de `-pooler`, porta 5432, banco `neondb`, role `neondb_owner`, senha presente e `sslmode` seguro.
5. Prova de TLS externo com `node:tls` e a CA do sistema.
6. Conexão ao banco administrativo com `rejectUnauthorized: true`.
7. Leitura de `server_version` (18.x), `neon.project_id`, `neon.endpoint_id` (se exposto), `current_database`, `current_user`, `session_user`, `pg_stat_ssl` e atributos da role administrativa.
8. Inventário de bancos, roles do projeto e memberships.
9. Recusa se existir qualquer banco `cardapio_digital_*`, qualquer role `cardapio_*`/`rustika_homolog_marker`, o banco definitivo ou as roles definitivas.
10. Criação de:
    - `cardapio_migrator` (LOGIN, senha própria, connection limit 5);
    - `cardapio_test_app` (LOGIN, senha própria, connection limit 20);
    - `cardapio_dev_app` (NOLOGIN);
    - `cardapio_homolog_bootstrap` (NOLOGIN, senha própria, connection limit 2);
    - `rustika_homolog_marker` (NOLOGIN) com comentário `rustika-homolog-cluster:<UUID>`.
11. `GRANT cardapio_migrator TO CURRENT_USER WITH SET TRUE, INHERIT FALSE` apenas para criar o banco com owner correto.
12. `CREATE DATABASE cardapio_digital_test OWNER cardapio_migrator ENCODING 'UTF8' TEMPLATE template0 CONNECTION LIMIT 40`.
13. `REVOKE ALL ON DATABASE cardapio_digital_test FROM PUBLIC`.
14. `GRANT CONNECT` somente para `cardapio_migrator`, `cardapio_test_app` e `cardapio_homolog_bootstrap`.
15. `REVOKE cardapio_migrator FROM CURRENT_USER` e verificação de que não restou membership com `SET`/`INHERIT`; a linha `ADMIN`-only automática do PostgreSQL 16+ é registrada e tolerada.
16. Verificação de ownership, atributos, ACLs, `CONNECT/CREATE/TEMPORARY`, marca e ausência de memberships inesperadas.
17. Conexão real ao banco de replay como `cardapio_migrator` e como `cardapio_test_app` para provar login, ownership, isolamento e banco vazio.
18. Gravação de `RELATORIO-PROVISIONAMENTO-C.6.md` sanitizado.
19. Em falha, gravação de `RELATORIO-PROVISIONAMENTO-C.6-FALHA.md` com inventário parcial. **Nenhum DROP automático.**

O script **não** executa `prisma migrate deploy`, não renomeia banco/roles, não faz bootstrap, não importa dados e não cria `.env`.

### 3.2 `backend/ops/homolog/provision-neon-c6.ps1`

Wrapper PowerShell 5.1+ que:

- localiza o backend;
- confirma a existência do script TypeScript;
- avisa se o stdin parece redirecionado;
- executa `npx tsx ops/homolog/provision-neon-c6.ts` no diretório do backend;
- propaga o código de saída;
- não recebe, não grava e não repassa credenciais.

A entrada oculta é feita pelo `readHiddenLine` do próprio script TypeScript, que exige TTY. Sem TTY, o script aborta antes de qualquer escrita.

## 4. Estado esperado ao final da C.6

Se a execução for aprovada no terminal local:

- Banco `cardapio_digital_test` criado, vazio, owner `cardapio_migrator`, connection limit 40, sem acesso de `PUBLIC`.
- Roles `cardapio_migrator`, `cardapio_test_app`, `cardapio_dev_app`, `cardapio_homolog_bootstrap` e `rustika_homolog_marker` criadas.
- Banco definitivo `cardapio_digital_homolog`: **ausente**.
- Roles definitivas `cardapio_homolog_migrator`, `cardapio_homolog_app` e `cardapio_homolog_placeholder`: **ausentes**.
- Membership temporária de `neondb_owner` sobre `cardapio_migrator`: **revogada** (SET/INHERIT). A linha `ADMIN`-only criada automaticamente pelo PostgreSQL 16+ permanece, sem `SET`/`INHERIT` e sem conceder `SET ROLE`/herança; ela não pode ser removida por quem tem apenas `CREATEROLE`.
- Nenhuma migration, tabela, sequência, view ou dado.
- UUID da marca impresso no relatório sanitizado para uso como `EXPECTED_CLUSTER_ID`.

O banco definitivo só passa a existir depois das migrations e do rename, que **não** fazem parte desta autorização.

## 5. Como executar localmente

No terminal interativo do Windows:

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
powershell -ExecutionPolicy Bypass -File .\ops\homolog\provision-neon-c6.ps1
```

Ou diretamente:

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
npx tsx ops/homolog/provision-neon-c6.ts
```

Entradas solicitadas, todas com eco oculto:

1. `C.6-PROVISION`;
2. Connection String do `neondb_owner`;
3. senha de `cardapio_migrator`;
4. senha de `cardapio_test_app`;
5. senha de `cardapio_homolog_bootstrap`.

As três senhas devem ser distintas e ter no mínimo 24 caracteres. Nenhuma delas deve ser enviada pela conversa.

## 6. O que NÃO foi executado

- Nenhuma conexão com `ep-sweet-king-bd7i7ypb`.
- Nenhum comando no Neon.
- Nenhuma criação de banco ou role.
- Nenhum `prisma migrate deploy`.
- Nenhuma alteração nas sete migrations históricas.
- Nenhuma alteração em banco local.
- Nenhum arquivo `.env`.
- Nenhum commit, push, deploy no Render ou alteração na PLATAFORMA_SITES_IA.
- Nenhum recurso pago.

## 7. Próximo passo após a C.6

1. Revisar o relatório gerado pelo script.
2. Autorizar, em etapa separada, a aplicação das sete migrations no banco de replay com o wrapper `npm run homolog:replay:deploy` e a confirmação própria.
3. Rodar `03-verify-replay.sql` (ele tolera a linha `ADMIN`-only automática e continua recusando `SET`/`INHERIT`).
4. Reexecutar `neon/01-grant-set-true-migrator.sql`, porque a C.6 revogou a membership temporária; sem isso, `01b` abortará.
5. Autorizar a finalização (`neon/01b-elevate-inherit-for-rename.sql`, rename para `cardapio_digital_homolog`/`cardapio_homolog_*`, `neon/02-revoke-set-true-migrator.sql` e `05`..`09`).

A C.6 termina antes de qualquer migration.
