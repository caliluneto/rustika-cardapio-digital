# RELATORIO-RUSTIKA-ENTREGA-FINAL.md

## 1. Estado real do Neon

- **Projeto**: `rustika-homolog-test` (Project ID: `aged-scene-47291697`)
- **Endpoint direto**: `ep-sweet-king-bd7i7ypb`
- **Banco administrativo**: `neondb` (role `neondb_owner`)
- **Banco de replay**: `cardapio_digital_test` (owner: `cardapio_migrator`)
- **Banco final planejado**: `cardapio_digital_homolog` (ainda não criado)
- **Estado da C.6**: PARCIAL — executada até a etapa [5/8], falhou em [6/8]
- **Causa da falha**: `REVOKE`/`GRANT` no banco de replay foram executados pela role administrativa `neondb_owner`, que não é dona do banco e não herda privilégios da migradora (membership temporária com `SET TRUE, INHERIT FALSE`). O PostgreSQL apenas emitiu WARNING e a ACL não mudou.
- **Estado atual do banco de replay**:
  - 5 roles criadas: `cardapio_migrator`, `cardapio_test_app`, `cardapio_dev_app`, `cardapio_homolog_bootstrap`, `rustika_homolog_marker`
  - Membership temporária `cardapio_migrator -> neondb_owner` com `SET TRUE, INHERIT FALSE` (já revogada)
  - PUBLIC ainda tem CONNECT e TEMPORARY no banco (não revogada corretamente)
  - Banco vazio (nenhuma tabela/sequência/view/no schema public)
  - ACL parcial: migrator, app e bootstrap têm CONNECT; PUBLIC tem CONNECT/TEMPORARY

## 2. Correção C.6

- **Correção de menor escopo**: `REVOKE CONNECT, TEMPORARY ON DATABASE cardapio_digital_test FROM PUBLIC;`
- **Como aplicar**: Em conexão própria autenticada como `cardapio_migrator` (owner do banco), NÃO via role administrativa `neondb_owner`
- **Script de recuperação**: `backend/ops/homolog/recover-neon-c6-acl.ts`
  - Modo `--check` (somente leitura): valida identidade, owner, banco vazio, roles, memberships e ACL antes de escrever
  - Modo `--apply`: após digitar token `C.6-RECOVER-ACL`, executa `REVOKE CONNECT, TEMPORARY ON DATABASE cardapio_digital_test FROM PUBLIC;` e `GRANT CONNECT ON DATABASE cardapio_digital_test TO cardapio_migrator, cardapio_test_app, cardapio_homolog_bootstrap;` em transação, conferindo o resultado antes do COMMIT
  - Não cria role, não cria banco, não renomeia, não executa migrations, não faz DROP/CASCADE/FORCE/RESET, não altera senhas
- **Script de provisionamento corrigido**: `backend/ops/homolog/provision-neon-c6.ts`
  - ACL agora aplicada por conexão do owner (`applyReplayDatabaseAclAsOwner`), não pela role administrativa
  - Removidos `REVOKE ALL`/`GRANT` executados pela role administrativa
- **Arquivos transferidos para o snapshot**:
  - `backend/ops/homolog/provision-neon-c6.ts`
  - `backend/ops/homolog/recover-neon-c6-acl.ts`
  - `backend/ops/homolog/recover-neon-c6-acl.ps1`
  - `backend/ops/homolog/provision-neon-c6.ps1`
  - `backend/tests/scripts/neon-c6-recovery.test.ts`

## 3. Status das migrations

- **Total de migrations**: 7 históricas, em ordem cronológica. Inventário aprovado em `backend/scripts/bootstrap/expectedMigrations.ts`, conferido com `backend/prisma/migrations`:
  1. `20261023000000_initial_schema`
  2. `20261027000000_rf004_comandas_catalogo_pedidos`
  3. `20261031000000_rf004_fix_permissions`
  4. `20261102000000_update_products_source_identity_constraint`
  5. `20261104000000_runtime_least_privilege`
  6. `20261105000000_order_status_update_privilege`
  7. `20261106000000_product_availability_update_privilege`
- **Checksums**: Validados em `backend/scripts/bootstrap/expectedMigrations.ts`; migrations idênticas no snapshot
- **Estado**: Não aplicadas ainda no banco de replay
- **Comandos de deployment**:
  - `npm run homolog:replay:deploy` — exige `CARDAPIO_MIGRATE_HOMOLOG_REPLAY_CONFIRMATION=REPLAY_HISTORICAL_MIGRATIONS_RUSTIKA_HOMOLOG`
  - `npm run homolog:migrate:deploy` — exige `CARDAPIO_MIGRATE_HOMOLOG_CONFIRMATION=APPLY_RUSTIKA_HOMOLOG_MIGRATIONS`
- **Restrição**: Nunca usar `prisma migrate reset`/`db push`; não alterar migrations históricas; aplicar somente após aprovação específica

## 4. Estado do banco de homologação

- **Não ainda implantado** — depende de autorização para deploy no Render Free
- **Configuração necessária**: `render.yaml` com nome `rustika-homolog`, plano Free, Node.js 22, health check `/api/health`, variáveis `SERVE_FRONTEND=on`, `HOMOLOG_GATE=on`, perfil `app-homolog-neon`
- **Auto-Deploy**: OFF

## 5. Estado do GitHub

- **Repositório privado**: `caliluneto/rustika-cardapio-digital`
- **Snapshots**: 
  - Snapshot atual em `main` = commit `8585c70`, limpo, contém migrations idênticas e funcionalidades principais
  - Snapshot **não contém** os arquivos do perfil `app-homolog-neon` (C.5)
  - Snapshot **não contém** `render.yaml` (configuração Render ainda precisa ser criada)
- **Arquivos transferidos para o snapshot** (por manifesto explícito):
  - `backend/ops/homolog/provision-neon-c6.ts`
  - `backend/ops/homolog/recover-neon-c6-acl.ts`
  - `backend/ops/homolog/recover-neon-c6-acl.ps1`
  - `backend/ops/homolog/provision-neon-c6.ps1`
  - `backend/tests/scripts/neon-c6-recovery.test.ts`
- **Restrições**: Não copiar histórico Git original, `.env`, connection strings, senhas, logs sensíveis, relatórios com credenciais ou scripts temporários de recuperação
- **Git**: Não usar `git add .` nem force push; pedir autorização específica antes do push

## 6. Estado do Render

- **Web Service Free planejado**: `rustika-homolog`
- **Runtime**: Node.js 22
- **Root Directory**: vazio, na raiz do monorepo
- **Build**:
  ```
  NODE_OPTIONS=--max-old-space-size=400 npm --prefix frontend ci --include=dev --no-audit --no-fund
  && NODE_OPTIONS=--max-old-space-size=400 npm --prefix frontend run build
  && cd backend && npm ci --include=dev --no-audit --no-fund
  && npx prisma generate
  && NODE_OPTIONS=--max-old-space-size=400 npm run build
  ```
- **Start**: `cd backend && node dist/server.js`
- **Health check**: `/api/health`
- **Variáveis de ambiente obrigatórias**:
  - `NODE_VERSION=22`
  - `NODE_ENV=production`
  - `DB_PROFILE=app-homolog-neon`
  - `CORS_ORIGIN=https://<URL>.onrender.com`
  - `SERVE_FRONTEND=on`
  - `HOMOLOG_GATE=on`
  - `HOMOLOG_GATE_USER`
  - `HOMOLOG_GATE_PASSWORD`
  - `CARDAPIO_SECRETS_SOURCE=env`
  - `RUSTIKA_HOMOLOG_DATABASE_URL`
  - `RUSTIKA_HOMOLOG_EXPECTED_DATABASE_HOST`
  - `RUSTIKA_HOMOLOG_EXPECTED_CLUSTER_ID`
  - `RUSTIKA_HOMOLOG_EXPECTED_PROJECT_ID`
  - `RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK=accept-proxy-terminated-tls-pg-stat-ssl-false`
  - `VITE_CATALOG_MODE=api`
  - `VITE_API_URL=/api`
  - `TRUST_PROXY_HOPS=0` (inicial, seguro até medir proxy real)
- **Não definir**: `VITE_ORDER_SUBMISSION`
- **Não inverter**: runtime com credenciais administrativas
- **Auto-Deploy**: OFF

## 7. URL funcional

- **Status**: NÃO DISPONÍVEL
- **URL esperada**: `https://rustika-homolog.<sufix>.onrender.com` (após deploy)
- **Dependências**: Autorização do proprietário para criação do serviço Free e cliques de confirmação
- **Se exigir login/cliques do proprietário**: fornecer instruções objetivas e prosseguir com o restante do trabalho

## 8. Testes online

- **Status**: N/A — ambiente não implantado ainda
- **Quando houver URL funcional**:
  - Testar frontend (catálogo, categorias, preços, imagens, disponibilidade, carrinho, comandas/pedidos)
  - Testar `/api/health`
  - Testar catálogo público e API
  - Testar login/logout administrativo
  - Verificar permissões e responsividade
  - Verificar logs e erros
- **Restrições**: Testes somente com dados demonstrativos; não aceitar pedidos reais; não desativar o gate de homologação

## 9. Bloqueios restantes

1. **Execução real do REVOKE no Neon**: Bloqueada por falta de credenciais e por autorização explícita pendente do proprietário sobre a operação `REVOKE CONNECT, TEMPORARY ON DATABASE cardapio_digital_test FROM PUBLIC;`
2. **Deploy no Render Free**: Bloqueado por login/cliques do proprietário; requer configuração de `render.yaml` com variáveis específicas e livre de custo obrigatório
3. **Push no GitHub do snapshot**: Bloqueado por autorização explícita pendente; não usar `git add .` nem force push
4. **Migrations/seed/rename**: Bloqueados pela recuperação Neon e por autorizações específicas

## 10. Operações pendentes de autorização

- (a) **Execução do pré-voo/REVOKE no Neon**: Autorização para executar `npx tsx ops/homolog/recover-neon-c6-acl.ts --check` e, posteriormente, `npx tsx ops/homolog/recover-neon-c6-acl.ts --apply` (digitando token `C.6-RECOVER-ACL`)
- (b) **Migrations, seed e rename**: Autorização para executar as 7 migrations históricas no banco de homologação, seed sanitizado e renomeação para `cardapio_digital_homolog`
- (c) **Push no GitHub**: Autorização para fazer commit e push na branch `main` do snapshot sanitizado, transferindo os arquivos do manifesto explícito
- (d) **Criação/deploy no Render**: Autorização para criar o Web Service Free `rustika-homolog` e confirmar cliques necessários

## 11. Resultado final: BLOQUEADO

- **Critério de sucesso**: Aplicação RÚSTIKA acessível por URL HTTPS, frontend e API funcionando, banco de homologação validado e testes demonstrativos aprovados
- **Status atual**: **BLOQUEADO** — awaiting explicit authorizations for (a) Neon REVOKE execution, (c) GitHub push, and (d) Render Free deployment
- **Próximos marcos**:
  1. Obter autorização para execução do pré-voo/REVOKE no Neon
  2. Aplicar a correção C.6 no banco de replay
  3. Obter autorização para push no GitHub do snapshot
  4. Criar configurar e deploy no Render Free
  5. Validar banco de homologação e executar migrations autorizadas
  6. Gerar URL HTTPS funcional e testar online com dados demonstrativos

---

**Geração**: Sun Nov 08 2026 — engenheiro full-stack sênior responsável técnico pela entrega do RÚSTIKA

**Metadados**:
- Projeto: RÚSTIKA — Cardápio Digital
- Versão de entrega: Final (após ensaios C.5.3 e C.6 parcial)
- Pendências: 4 autorizações explícitas necessárias (Neon REVOKE, GitHub push, Render deploy, migrations)
