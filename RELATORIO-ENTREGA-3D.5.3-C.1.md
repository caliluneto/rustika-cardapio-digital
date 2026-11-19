# RELATÓRIO DE ENTREGA — 3D.5.3-C.1
## Diagnóstico de compatibilidade Neon Free — somente leitura

Data: 2026-11-06. Nenhum comando de escrita foi executado: sem `neon init/deploy`, sem migrations, sem criar/renomear/excluir bancos ou roles, sem Render, sem alterar `.env*`/segredos, sem commit/push. Apenas leitura de scripts locais e de documentação pública do Neon.

## 1. Identificação do projeto descartável

| Item | Valor informado pelo proprietário |
|---|---|
| Projeto | `rustika-homolog-test` |
| Project ID | `aged-scene-47291697` |
| Branch | `production` |
| Região | AWS US East 2 (Ohio) |
| Plano | Free |

Não verifiquei esses dados no Neon (ver seção 3). Observação: no Neon, "cluster" = projeto + branch; roles e bancos pertencem à **branch**.

## 2. PostgreSQL detectado

**Não detectado.** Sem conexão, a versão não foi lida. A documentação consultada (planos, roles, bancos, segurança, pooling) **não informa a versão padrão do Postgres nem se a 17 está disponível** no Free. As migrations/scripts exigem PostgreSQL ≥ 17 (`01-cluster-roles.sql`, `serverIdentity.ts`). Verificar no console (Project settings) ou com `SHOW server_version_num` é a primeira checagem obrigatória.

## 3. Resultado da conexão segura

**Não realizada, por falta de acesso configurado**: não há variáveis de ambiente de Neon/DATABASE_URL nesta sessão, nem `psql` nem `neon`/`neonctl` instalados. Não procurei segredos em arquivos locais nem pedi connection strings.

Como o proprietário pode fornecer o diagnóstico sem expor segredos: abrir o **SQL Editor do console do Neon** (ou `psql` local, digitando a senha só no terminal) e rodar apenas o bloco de leitura abaixo; colar no chat **somente o resultado** (sem senha/host completo/connection string).

```sql
-- SOMENTE LEITURA
SELECT version(), current_setting('server_version_num') AS ver, current_database() AS db, current_user AS usr, session_user AS sess;
SELECT ssl, version AS tls_version FROM pg_stat_ssl WHERE pid = pg_backend_pid();
SELECT datname, pg_get_userbyid(datdba) AS owner, datistemplate, datallowconn FROM pg_database ORDER BY 1;
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls, rolconnlimit FROM pg_roles WHERE rolname NOT LIKE 'pg\_%' ORDER BY 1;
SELECT pg_get_userbyid(roleid) AS role, pg_get_userbyid(member) AS member, admin_option, inherit_option, set_option FROM pg_auth_members WHERE pg_get_userbyid(roleid) NOT LIKE 'pg\_%';
SELECT shobj_description(oid,'pg_authid') FROM pg_roles WHERE rolname = 'rustika_homolog_marker';   -- esperado: nenhuma linha
SELECT name, setting FROM pg_settings WHERE name IN ('ssl','max_connections','password_encryption','server_version');
```
(`inherit_option`/`set_option` existem a partir do PG16.) O host deve ser o endpoint **direto** (sem `-pooler`).

## 4. Permissões identificadas (documentação; não equivale a garantia)

- `neon_superuser` **não é superuser**. Roles criadas por console/API/CLI e a role inicial (ex.: `neondb_owner`) são membros dele e têm CREATEDB, CREATEROLE (pode alterar/excluir roles), BYPASSRLS, REPLICATION e `pg_read/write_all_data`.
- Roles criadas por SQL `CREATE ROLE` **não** recebem `neon_superuser`; ficam só com privilégios básicos no schema `public`.
- `ALTER DATABASE … RENAME` **é documentado** (conectar antes a outro banco; `pg_terminate_backend` para conexões). `CREATE DATABASE` via SQL funciona, exceto `TABLESPACE`. Bancos criados por SQL não recebem o vínculo com `neon_superuser`.
- Proibido: criar banco com a role `neon_superuser`, definir seu dono como `neon_superuser`, alterar a role `neon_superuser`.
- Nomes reservados de role: prefixo `pg_`, `neon_superuser`, `cloud_admin`, `zenith_admin`, `public`, `none`, `web_access`, `token_roles`. Nomes de banco reservados: `postgres`, `template0`, `template1`. Limites: 500 roles e 500 bancos por branch; nomes ≤ 63 bytes.
- Senhas: ≥ 60 bits de entropia; hash pré-computado não suportado.
- TLS sempre exigido; `verify-full` recomendado (raiz ISRG Root X1); `channel_binding=require` disponível. Endpoint pooled (`-pooler`, PgBouncer em modo transação) **não** suporta `SET`/`RESET`, `LISTEN/NOTIFY`, `PREPARE` SQL, tabelas temporárias, `LOAD` nem advisory locks de sessão; migrations e administração devem usar o endpoint **direto**.
- Free: 100 CU-h/projeto/mês, 1 GB, scale-to-zero após 5 min (não desligável), 10 branches, janela de histórico 6 h.

## 5. Incompatibilidades documentadas

Confirmadas pela documentação:
1. **Banco `postgres` é reservado/gerenciado.** `04-finalize-rename.sql` exige estar conectado ao banco `postgres` (`current_database() <> 'postgres'` aborta). Se a role administrativa do Neon não puder conectar a `postgres`, o script precisa ser adaptado (o próprio Neon manda conectar a outro banco, p. ex. `neondb`) — **mudar a guarda enfraquece uma validação existente; só com decisão do proprietário**.
2. **Modelo de "cluster dedicado".** O Neon tem bancos/roles próprios (`neondb`, `neondb_owner`, `cloud_admin`, `neon_superuser`). Os scripts não os proíbem, mas a premissa "cluster vazio e dedicado" vira "branch dedicada".
3. **Branches herdam roles.** Uma branch filha copia a role `rustika_homolog_marker`; a marca de identidade deixa de distinguir branch pai e filha. A identidade só é confiável se for usada uma única branch por ambiente.

Prováveis, **não confirmadas** (derivam do comportamento do PostgreSQL ≥ 16, não de página do Neon):
4. `CREATE DATABASE … OWNER cardapio_migrator` (script 02) e `ALTER DATABASE … RENAME` / `ALTER ROLE … RENAME` (script 04) exigem que a role administrativa seja membro da role-alvo com `SET`/`INHERIT`/`ADMIN`; no PG16+ um `CREATEROLE` não superuser recebe `ADMIN` mas **sem** `INHERIT`/`SET` por padrão. Pode falhar sem `GRANT … TO admin WITH SET TRUE, INHERIT TRUE` (privilégio adicional, a ser avaliado).
5. `COMMENT ON ROLE` na role-marca e `shobj_description` por role não proprietária: não documentados pelo Neon.
6. `psql` meta-comandos (`\gset`, `\if`, `\password`) dependem de um cliente `psql` — não instalado nesta máquina; o SQL Editor do Neon não os executa.
7. `pg_stat_ssl` e `pg_stat_activity`: não documentados; a verificação de identidade do app (`readServerFacts`) usa `pg_stat_ssl` do próprio PID — provável OK, não comprovado.

## 6. Operações ainda não testadas

Versão ≥ 17; `pg_stat_ssl` ativo; `CREATE ROLE` com `NOINHERIT`/`CONNECTION LIMIT`; `COMMENT ON ROLE` e leitura da marca; `CREATE DATABASE OWNER/TEMPLATE template0/CONNECTION LIMIT 40`; `REVOKE/GRANT ON DATABASE`; replay das 7 migrations pelo Prisma no endpoint direto; checksums; `ALTER ROLE RENAME` (com sessão do admin fora dos papéis); `ALTER DATABASE RENAME`; `09-verify-acl.sql`; `schema-fingerprint`; wake-up após scale-to-zero; `sslmode=verify-full`/`sslaccept=strict` com Prisma; `channel_binding`; consumo de CU-h.

## 7. Riscos

- **R-N1** Versão do PostgreSQL no Free pode ser < 17 (bloqueante).
- **R-N2** Guarda `postgres` e privilégios de membership podem exigir alterar scripts de segurança (nenhuma alteração será feita sem autorização).
- **R-N3** Marca de identidade copiada por branches; usar uma só branch e não criar filhas.
- **R-N4** Scale-to-zero (5 min) provoca cold start e falha de primeira conexão; `/api/ready` repetido consome CU-h (por isso o portão protege `/api/ready`).
- **R-N5** Tráfego de teste/CI e replays consomem os 100 CU-h; 1 GB de armazenamento.
- **R-N6** Pooled vs direto: usar apenas o direto para migrations, admin e runtime desta homologação (Prisma + `SET`).
- **R-N7** Credenciais: a role inicial `neondb_owner` é poderosa (BYPASSRLS, CREATEROLE); não pode virar a role de runtime.
- **R-N8** Descartável: a estratégia só vale na homologação; não replicar em produção sem novo estudo.

## 8. Plano para testes reversíveis na próxima subetapa (3D.5.3-C.2)

Todos executados pelo proprietário, na branch `production` do projeto descartável (ou numa branch de teste que será apagada), mediante autorização expressa por etapa:
1. Rodar o bloco de leitura da seção 3 e anexar o resultado (sem segredos). Decide R-N1.
2. Teste mínimo de privilégios com objetos temporários de nome claramente de teste (`zz_probe_*`): `CREATE ROLE zz_probe_a LOGIN NOINHERIT CONNECTION LIMIT 2`; `COMMENT ON ROLE`; `CREATE DATABASE zz_probe_db OWNER zz_probe_a`; `ALTER DATABASE zz_probe_db RENAME TO zz_probe_db2`; `ALTER ROLE zz_probe_a RENAME TO zz_probe_b`; `pg_stat_ssl`; por fim `DROP DATABASE`/`DROP ROLE` dos próprios objetos de teste. Cada passo registra sucesso/erro.
3. Se o passo 2 falhar por membership (item 4), propor — sem aplicar — `GRANT` explícito com `SET/INHERIT` e reavaliar.
4. Só então decidir sobre os scripts 01–05 e o replay completo (C.3), em branch descartável, apagada ao final.
Nada disso é feito antes da avaliação deste relatório.

## 9. Decisão recomendada

**Continuar para a C.2 apenas com o diagnóstico de leitura (passo 1) e, se a versão for ≥ 17, com o teste reversível `zz_probe_*`.** Não executar ainda os scripts 01–05 do RÚSTIKA, não copiar a connection string para o Render e não alterar as guardas de segurança. Se o PostgreSQL for < 17 ou se o teste de privilégios falhar, interromper e reavaliar alternativas de custo zero (outro provedor, ou mudar a exigência de versão com justificativa), sem enfraquecer TLS, host e identidade do cluster.
