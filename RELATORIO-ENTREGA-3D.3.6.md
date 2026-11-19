# RELATÓRIO DE ENTREGA 3D.3.6

## Auditoria e estabilização do backend de pedidos

Data: 03/11/2026  
Projeto: Cardápio Digital  
Escopo: backend, testes isolados e mapeamento de segurança  
Ambiente de teste: `NODE_ENV=test`, `DB_PROFILE=app-test`

---

## 1. Resumo executivo

A auditoria identificou que o fluxo de autenticação, comanda e pedido existia em código, mas não estava ligado ao `createApp`. O roteador de catálogo era o único router funcional além do health check. Também foram encontrados três bloqueios adicionais:

1. CORS sem `credentials` e sem os headers exigidos pelo fluxo.
2. Parser JSON global anulando os limites específicos de 4 KiB e 16 KiB e impedindo respostas corretas para JSON inválido/corpo grande.
3. Rejeição de IDs públicos alfanuméricos no pedido, embora o catálogo real contenha `rustika-PA062240`.

Esses problemas foram corrigidos sem alterar schema, dados, Seed, migrations, permissões, credenciais ou frontend.

Resultado dos testes após as correções:

- Suíte completa: **431/436 testes aprovados**.
- Testes focados no fluxo: **169/169 aprovados**.
- Build: **sucesso**.
- Typecheck: **10 erros legados** em scripts/testes, nenhum novo em `src/app`, rotas, serviços ou domínio.
- Nenhuma escrita no banco de Desenvolvimento nesta entrega.
- Banco de teste possui **3 migrations pendentes**, portanto o fluxo real de pedidos ainda não pode ser validado contra o schema de teste completo.

O backend está estabilizado no código e coberto por testes com doubles, mas **não está liberado para uso real** enquanto o schema de teste, as permissões e a integração de frontend não forem tratados em etapas aprovadas.

---

## 2. Escopo e restrições

### 2.1 Incluído

- Auditoria de `backend/src/app.ts`, routers, serviços, segurança, domínio, mappers e testes.
- Verificação do fluxo Administrador → Comanda → Convite → Sessão → Pedido.
- Execução de testes exclusivamente com `NODE_ENV=test` e `DB_PROFILE=app-test`.
- Correções mínimas de integração, CORS, parsing e contrato de IDs.
- Mapeamento de permissões reais em leitura e plano de menor privilégio com rollback.
- Criação deste relatório.

### 2.2 Não incluído e não executado

- Alteração de schema, migrations, Seed, tabelas, dados ou sequences.
- Alteração de roles, permissões, ACLs, credenciais ou `.env`.
- Escrita ou `POST` no banco de Desenvolvimento.
- Aplicação das migrations pendentes no banco de teste.
- Alteração do frontend ou integração visual do checkout.
- Commit, reset, clean ou remoção de arquivos.
- Início da próxima fase de entrega.

### 2.3 Regras de segurança respeitadas

- Nenhuma senha, token, hash ou URL de conexão foi impressa.
- Consultas de ACL e IDs usaram transação `READ ONLY` e `statement_timeout`.
- Testes de pedido usam Prisma simulado; não houve criação real de pedido.
- O banco de teste foi apenas consultado para status de migrations e leitura de catálogo/permissões.

---

## 3. Arquitetura e fluxo real de pedidos

### 3.1 Componentes

```text
Frontend/API client
      |
      v
Express createApp
  ├── /api/health
  ├── /api/categories, /api/products
  ├── /api/admin/auth/*
  ├── /api/admin/comanda-invitations
  ├── /api/comanda-sessions
  └── /api/orders
      |
      v
Routers -> Services -> Prisma -> PostgreSQL
```

### 3.2 Fluxo backend implementado

1. **Login administrativo** em `POST /api/admin/auth/login`.
   - Valida e-mail/senha com scrypt.
   - Exige conta ativa.
   - Emite token aleatório de 32 bytes em cookie `rustika_admin` (`HttpOnly`, `SameSite=Strict`, `Path=/api/admin`, 1 hora).
   - Sessão administrativa é mantida em memória no processo.

2. **Emissão de convite** em `POST /api/admin/comanda-invitations`.
   - Exige cookie administrativo.
   - Valida comanda de 1 a 6 dígitos.
   - Executa `upsert` da comanda e criação do convite em transação `Serializable`.
   - Comanda precisa estar `OPEN` e sem fechamento.
   - Convite tem token aleatório de 32 bytes; somente SHA-256 é persistido.
   - Validade padrão de 10 minutos, configurável entre 1 e 30.

3. **Resgate do convite** em `POST /api/comanda-sessions`.
   - Valida token, expiração, consumo, revogação, emissor ativo e comanda aberta.
   - Consome o convite com `updateMany` condicional dentro de transação `Serializable`.
   - Só cria sessão quando `count=1`.
   - Emite cookie `rustika_session` (`HttpOnly`, `SameSite=Lax`, `Path=/api`, 8 horas).
   - O segredo do cliente não é retornado no JSON.

4. **Consulta da sessão** em `GET /api/comanda-sessions/current`.
   - Valida hash da credencial e estado da comanda.

5. **Envio do pedido** em `POST /api/orders`.
   - Exige `Origin` exato, cookie de sessão, `Content-Type: application/json` e `Idempotency-Key` UUID v4.
   - Limita corpo a 16 KiB, no máximo 30 produtos distintos e 200 unidades.
   - Autentica a sessão dentro da transação `Serializable`.
   - Recusa sessão expirada, revogada ou de comanda fechada/cancelada.
   - Consulta somente produtos ativos, públicos, de categoria pública.
   - Exige `availabilityState=AVAILABLE`.
   - Ignora preço do cliente como autoridade; converte o `Decimal` do banco para centavos.
   - Compara o preço esperado e retorna `409 PRICE_CHANGED` quando divergente.
   - Cria `Order` com status `RECEIVED`, snapshots dos itens e histórico inicial `null → RECEIVED`.
   - Replay idempotente retorna `200` com o mesmo pedido; criação nova retorna `201`.

### 3.3 Lacuna anterior e correção

Antes desta entrega, `createApp` montava somente:

- `/api/health`
- `/api` com o router de catálogo

Os routers de acesso e pedido existiam, mas não eram registrados. O teste de acesso também injetava `authClock`, que não existia em `AppDependencies`. Isso causava 404 nos endpoints e um erro de typecheck.

Após a correção, `createApp` monta os routers e aceita o relógio injetável para testes.

---

## 4. Inventário de arquivos e endpoints

### 4.1 Arquivos principais auditados

| Arquivo | Responsabilidade |
| --- | --- |
| `backend/src/app.ts` | Composição do Express, CORS, parsers e montagem dos routers. |
| `backend/src/routes/health.routes.ts` | Health check. |
| `backend/src/routes/catalog.routes.ts` | Categorias, produtos e filtros públicos. |
| `backend/src/routes/access.routes.ts` | Login, sessão administrativa, convites e sessão de comanda. |
| `backend/src/routes/order.routes.ts` | Recebimento do pedido e validação de borda. |
| `backend/src/services/adminAuth.service.ts` | Autenticação e sessão administrativa. |
| `backend/src/services/comandaAccess.service.ts` | Emissão e resgate de convites. |
| `backend/src/services/orderSession.ts` | Cookie, hash e validação de sessão de comanda. |
| `backend/src/services/order.service.ts` | Criação transacional e idempotente do pedido. |
| `backend/src/security/adminSessions.ts` | Store em memória e cookies administrativos. |
| `backend/src/security/accessLimits.ts` | Limites por IP e janela fixa. |
| `backend/src/security/password.ts` | Hash/verificação scrypt. |
| `backend/src/domain/orderInput.ts` | Validação e normalização do corpo do pedido. |
| `backend/src/domain/rules.ts` | Limites, transições e precificação. |
| `backend/src/mappers/order.mapper.ts` | DTO público do pedido. |
| `backend/src/mappers/catalog.mapper.ts` | DTO público do catálogo e conversão de preço. |
| `backend/src/middleware/errorHandler.ts` | Envelope de erro e tradução de erros de parser. |
| `backend/src/middleware/notFound.ts` | Resposta 404. |
| `backend/tests/access.test.ts` | Fluxo HTTP de autenticação/convite/sessão. |
| `backend/tests/orders.test.ts` | Contrato HTTP de pedidos. |
| `backend/tests/services/order.service.test.ts` | Regras transacionais e idempotência. |
| `backend/tests/services/access.service.test.ts` | Serviços de autenticação e convite. |
| `backend/tests/catalog.test.ts` | Contrato público do catálogo. |
| `backend/tests/health.test.ts` | Bootstrap, health e erro de parsing. |
| `backend/tests/domain/rules.test.ts` | Regras puras de pedido. |
| `backend/docs/access-api.md` | Contrato de autenticação e convite. |
| `backend/docs/orders-api.md` | Contrato de pedido, idempotência e erros. |
| `backend/docs/admin-provisioning.md` | Procedimento de criação do primeiro admin. |
| `backend/prisma/schema.prisma` | Modelo de dados. |
| `backend/prisma/migrations/20261031000000_rf004_fix_permissions/` | Grants da correção de permissões. |

### 4.2 Endpoints funcionais

| Método | Endpoint | Observação |
| --- | --- | --- |
| GET | `/api/health` | Público, sem banco. |
| GET | `/api/categories` | Público; somente categorias ativas com chave pública. |
| GET | `/api/products` | Público; filtros, paginação por cursor. |
| GET | `/api/products/:productId` | Público; produto ativo e público. |
| POST | `/api/admin/auth/login` | Origin + JSON + `X-Rustika-Request`. |
| GET | `/api/admin/auth/session` | Cookie administrativo. |
| POST | `/api/admin/auth/logout` | Origin + JSON + header; limpa cookie. |
| POST | `/api/admin/comanda-invitations` | Administrador autenticado; emite convite. |
| POST | `/api/comanda-sessions` | Resgate público de convite; emite cookie de cliente. |
| GET | `/api/comanda-sessions/current` | Cookie de cliente. |
| POST | `/api/orders` | Cookie de cliente + Idempotency-Key + Origin. |

Não existe endpoint de consulta, listagem ou alteração de status de pedido nesta entrega.

---

## 5. Autenticação, sessão e segurança

### 5.1 Administrador

- Senha com scrypt (`N=32768`, `r=8`, `p=3`), sal aleatório e `timingSafeEqual`.
- Conta inexistente ou hash inválido executa verificação de custo equivalente.
- Sessão administrativa em memória, token de 32 bytes, hash SHA-256 na store.
- Expiração de 1 hora, limite de 1.000 sessões, logout e troca de versão invalidam.
- Store é local ao processo; reinício ou múltiplas instâncias exigem novo login.
- Nenhuma conta padrão, Seed automático ou senha fixa.

### 5.2 Cliente/comanda

- Convite de uso único com token de 32 bytes.
- Persistência somente do hash SHA-256.
- Consumo atômico e criação de sessão na mesma transação.
- Sessão de cliente com expiração de 8 horas.
- Cookie `rustika_session` não aparece no JSON.
- Sessão validada novamente antes de criar o pedido e antes de aceitar replay.

### 5.3 CSRF, CORS e cookies

- Origem validada de forma exata contra `CORS_ORIGIN`.
- CORS configurado com `credentials: true` e headers `Content-Type`, `X-Rustika-Request` e `Idempotency-Key`.
- Cookies de escrita são `HttpOnly`; `Secure` é ativado em produção ou origem HTTPS.
- Cookie administrativo usa `SameSite=Strict`; cookie do cliente usa `SameSite=Lax`.
- `X-Rustika-Request: 1` é exigido nas rotas administrativas e no resgate de comanda.
- **Divergência registrada:** `POST /api/orders` aceita Origin exato e JSON, mas não exige `X-Rustika-Request`, embora o comentário do router e a documentação mencionem o header. O risco é mitigado pela origem exata e pelo cookie SameSite, mas a implementação e o contrato devem ser reconciliados antes da integração do frontend.

### 5.4 Limites

- Login: 10 tentativas/IP/15 minutos e até 4 verificações scrypt simultâneas.
- Emissão de convite: 60/IP/5 minutos.
- Resgate: 30/IP/5 minutos.
- Corpo de acesso: 4 KiB.
- Corpo de pedido: 16 KiB.
- Limites são por processo; não substituem proteção de infraestrutura.

### 5.5 Erros

- Envelope preservado: `{ success: false, error: { code, message } }`.
- JSON inválido agora retorna `400 INVALID_INPUT`.
- Corpo acima do limite retorna `413 BODY_TOO_LARGE`.
- URI malformada retorna `400 INVALID_INPUT` em vez de 500.
- Erros inesperados não expõem detalhes ao cliente.
- O log de erro inesperado foi reduzido para classe genérica, sem mensagem interna.
- Testes verificam que respostas não contêm token, hash, digest, sessão, chave de idempotência ou URL de conexão.

---

## 6. Contratos e validações

### 6.1 Identificadores públicos

- Categoria: `^[a-z0-9]+(-[a-z0-9]+)*$`, até 64 caracteres.
- Produto: `^rustika-[0-9A-Z]{1,64}$`.
- O código real `PA062240` exige letras maiúsculas.
- **Correção aplicada:** `orderInput.ts` e `rules.ts` agora aceitam `A-Z` e `0-9`, alinhados ao catálogo.
- Sem essa correção, o produto `rustika-PA062240` aparecia no catálogo, mas não podia ser pedido.

### 6.2 Pedido

| Campo | Regra |
| --- | --- |
| `customerName` | Obrigatório; 2–120 caracteres após trim. |
| `customerPhone` | Opcional; 7–25 caracteres; números e `+ ( ) . -`/espaços. |
| `tableOrReference` | Opcional; 1–80 caracteres. |
| `notes` | Opcional; 1–500 caracteres. |
| `items` | 1–30 produtos distintos; máximo 200 unidades. |
| `items[].productId` | `rustika-` + 1–64 caracteres `A-Z`/`0-9`. |
| `items[].quantity` | Inteiro de 1 a 99. |
| `items[].expectedUnitPriceInCents` | Inteiro positivo, até 999.999. |
| `items[].notes` | Opcional; 1–200 caracteres. |
| Corpo | Máximo 16 KiB; sem query string. |
| `Idempotency-Key` | UUID v4 válido. |

Textos rejeitam caracteres de controle e `<`/`>`. Campos desconhecidos são recusados. Totais, status, IDs de sessão/comanda e preços não podem ser definidos pelo cliente.

### 6.3 Preço e idempotência

- Preço vem do catálogo do servidor em `Decimal`.
- Conversão exata para centavos; preço fracionário ou negativo é rejeitado.
- Preço esperado divergente retorna `409 PRICE_CHANGED`.
- Chave de idempotência é vinculada a `[comandaId, sessionId, chave]`.
- Replay só é aceito para a mesma sessão e o mesmo corpo normalizado.
- Corpo diferente com a mesma chave retorna `409 IDEMPOTENCY_CONFLICT`.
- Conflitos `P2034`/unicidade têm até três tentativas; falhas genéricas não são repetidas cegamente.

### 6.4 Status HTTP principais

| HTTP | Código |
| --- | --- |
| 400 | `INVALID_INPUT`, `INVALID_IDEMPOTENCY_KEY` |
| 401 | `INVALID_CREDENTIALS`, `ADMIN_UNAUTHENTICATED`, `INVALID_INVITATION`, `INVALID_SESSION` |
| 403 | `ORIGIN_NOT_ALLOWED` |
| 404 | `PRODUCT_NOT_FOUND`, `NOT_FOUND` |
| 409 | `COMANDA_CLOSED`, `ACCESS_CONFLICT`, `PRODUCT_UNAVAILABLE`, `PRICE_CHANGED`, `IDEMPOTENCY_CONFLICT`, `ORDER_CONFLICT` |
| 413 | `BODY_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 422 | `LIMIT_EXCEEDED` |
| 429 | `TOO_MANY_REQUESTS` |
| 500 | `INTERNAL_ERROR` |
| 503 | `CATALOG_UNAVAILABLE`, `ACCESS_UNAVAILABLE`, `AUTH_UNAVAILABLE`, `ORDERS_UNAVAILABLE` |

---

## 7. Testes e resultados

### 7.1 Ambiente

```powershell
$env:NODE_ENV = 'test'
$env:DB_PROFILE = 'app-test'
```

Todos os testes foram executados nesse perfil. Os testes de fluxo usam Prisma simulado e não escrevem no banco.

### 7.2 Resultado focado no fluxo

Comando:

```powershell
npx vitest run tests/access.test.ts tests/orders.test.ts tests/catalog.test.ts tests/health.test.ts tests/services/access.service.test.ts tests/services/order.service.test.ts tests/domain/rules.test.ts
```

Resultado:

- **7 arquivos aprovados**
- **169/169 testes aprovados**

Esse conjunto cobre:

- Login, logout, expiração e limite administrativo.
- CORS/preflight e proteção de origem.
- Emissão/resgate de convite e cookie.
- Criação de pedido, replay e conflitos de idempotência.
- Sessão expirada/revogada/comanda fechada.
- Produto ausente, inativo, privado ou indisponível.
- Preço divergente e limites.
- JSON inválido, corpo grande, query e formulário.
- PA062240 e IDs alfanuméricos.

### 7.3 Resultado da suíte completa

Comando:

```powershell
npm test
```

Resultado após as correções:

- **436 testes encontrados**
- **431 aprovados**
- **5 falhas**
- **20 arquivos executados; 18 aprovados, 2 com falha**
- Uma suíte (`tests/scripts/seed-dev.test.ts`) não carregou por módulo ausente.

### 7.4 Falhas remanescentes classificadas

Todas são de testes legados de scripts de Seed, não do fluxo de pedidos:

1. `tests/scripts/seed-dev.test.ts`
   - Falha de importação: `../../scripts/seed-dev` não existe.
   - Nenhum teste dessa suíte executou.

2. `tests/scripts/executor-seed-real.test.ts`
   - `mockPrisma.product.findMany` não foi definido no mock.
   - O teste “aceita banco correto e role cardapio_dev_app” espera aceitar `cardapio_dev_app`, mas o executor exige `cardapio_migrator`.
   - Esses testes já falhavam antes das alterações desta entrega.

### 7.5 Typecheck

Comando:

```powershell
npm run typecheck
```

Resultado:

- **10 erros legados** em `scripts/analyze-excel.ts`, `scripts/analyze-excel2.ts`, `scripts/executor-seed-real.ts`, `scripts/validate-api.ts` e `tests/scripts/seed-dev.test.ts`.
- O erro de `authClock` em `tests/access.test.ts` foi resolvido.
- Nenhum erro novo em `src/app.ts`, routers, serviços, segurança, domínio ou mappers.

### 7.6 Build

Comando:

```powershell
npm run build
```

Resultado: **sucesso**, sem erros.

### 7.7 Status do banco de teste

Comando:

```powershell
npm run db:migrate:status:test
```

Resultado:

- 4 migrations encontradas.
- A migration inicial está aplicada.
- Pendentes:
  - `20261027000000_rf004_comandas_catalogo_pedidos`
  - `20261031000000_rf004_fix_permissions`
  - `20261102000000_update_products_source_identity_constraint`

Consequência: o banco `cardapio_digital_test` não possui as tabelas de comandas/convites/sessões e não está apto a validar o fluxo real. Nenhuma migration foi aplicada nesta entrega.

### 7.8 Evidência de dados reais

Consulta somente leitura em `cardapio_digital_dev`:

- 168 produtos no total.
- 1 produto com código não numérico: `PA062240`.
- 0 chaves públicas divergentes de `rustika-<source_code>`.
- 0 produtos públicos com identidade incompleta.

Esse dado comprovou o bug de contrato corrigido no pedido.

---

## 8. Erros corrigidos, arquivos alterados e justificativas

### 8.1 Integração dos routers

**Arquivo:** `backend/src/app.ts`

Antes:

- Apenas health e catálogo eram montados.
- `AppDependencies` não tinha `authClock`.
- Testes de acesso/pedido recebiam 404.

Depois:

- `access.adminRouter` em `/api/admin`.
- `access.sessionRouter` em `/api/comanda-sessions`.
- `createOrderRouter` em `/api/orders`.
- `authClock` opcional para testes.
- `secureCookies` derivado de produção/origem HTTPS.

### 8.2 CORS e credenciais

**Arquivo:** `backend/src/app.ts`

Antes:

- Sem `credentials`.
- Sem `allowedHeaders` explícitos.
- Preflight não permitia cookie/header customizado.

Depois:

- `credentials: true`.
- Headers permitidos: `Content-Type`, `X-Rustika-Request`, `Idempotency-Key`.
- Origem continua exata.

### 8.3 Parser JSON e limites

**Arquivo:** `backend/src/app.ts`

Antes:

- `express.json()` global sem limite específico.
- O parser global consumia o corpo antes dos parsers de acesso/pedido.
- O limite de 16 KiB não era aplicado como projetado.
- JSON inválido em fluxo de pedido podia virar 500.

Depois:

- Parser global removido.
- Cada router usa seu parser: 4 KiB para acesso, 16 KiB para pedido.
- O limite e os erros de parsing passam a ser corretos.

### 8.4 Erros de parsing e URI

**Arquivo:** `backend/src/middleware/errorHandler.ts`

Antes:

- JSON malformado e URI inválida podiam retornar 500.
- Corpo grande não era classificado como 413.

Depois:

- `entity.parse.failed` → `400 INVALID_INPUT`.
- `entity.too.large` → `413 BODY_TOO_LARGE`.
- `URIError` → `400 INVALID_INPUT`.
- Log de erro inesperado sem mensagem interna.

### 8.5 ID público alfanumérico

**Arquivos:** `backend/src/domain/orderInput.ts`, `backend/src/domain/rules.ts`, `backend/docs/orders-api.md`

Antes:

- Catálogo aceitava `[0-9A-Z]`.
- Pedido aceitava somente `[0-9]`.
- `rustika-PA062240` era exibido, mas recusado no checkout.

Depois:

- Pedido e regras aceitam `[0-9A-Z]{1,64}`.
- Documentação atualizada.
- Testes adicionados para `PA062240`.

### 8.6 Ajuste de teste legado

**Arquivo:** `backend/tests/health.test.ts`

O teste de JSON inválido usava `POST /api/health`, rota que não existe, e esperava 500. Foi ajustado para exercitar o parser real em `POST /api/admin/auth/login`, esperando `400 INVALID_INPUT`. Isso alinha o teste ao contrato atual.

### 8.7 Arquivos alterados nesta entrega

- `backend/src/app.ts`
- `backend/src/middleware/errorHandler.ts`
- `backend/src/domain/orderInput.ts`
- `backend/src/domain/rules.ts`
- `backend/tests/health.test.ts`
- `backend/tests/domain/rules.test.ts`
- `backend/tests/services/order.service.test.ts`
- `backend/docs/orders-api.md`

Nenhum schema, migration, Seed, dado, permissão ou credencial foi alterado.

### 8.8 Estado do worktree

O `git status` ainda mostra alterações de frontend e diversos arquivos não rastreados de entregas anteriores. Elas **não foram produzidas nem modificadas por esta entrega** e foram preservadas. Também existe um arquivo não rastreado pré-existente chamado `$testRunner` (7 bytes, criado em 30/10/2026), que não pertence a esta entrega e não foi removido.

Esta entrega alterou somente os oito arquivos backend listados na seção 8.7 e criou este relatório.

---

## 9. Permissões reais e plano de menor privilégio

### 9.1 Identidade auditada

Consulta somente leitura:

- Banco: `cardapio_digital_dev`
- Role: `cardapio_dev_app`
- Owner das tabelas: `cardapio_migrator`

Atributos da role:

- `rolsuper=false`
- `rolbypassrls=false`
- `rolcreatedb=false`
- `rolcreaterole=false`
- `rolcanlogin=true`
- `rolinherit=true`
- Sem memberships adicionais.

Schema `public`: `USAGE=true`, `CREATE=false`.

### 9.2 Matriz real de `cardapio_dev_app`

S = SELECT, I = INSERT, U = UPDATE, D = DELETE.

| Tabela | S | I | U | D | TRUNCATE |
| --- | --- | --- | --- | --- | --- |
| `admins` | sim | sim | sim | sim | não |
| `categories` | sim | sim | sim | sim | não |
| `products` | sim | sim | sim | sim | não |
| `comandas` | sim | sim | sim | não | não |
| `comanda_invitations` | sim | sim | sim | não | não |
| `comanda_sessions` | sim | sim | não | não | não |
| `orders` | sim | sim | não | não | não |
| `order_items` | sim | sim | não | não | não |
| `order_status_history` | sim | sim | não | não | não |
| `_prisma_migrations` | não | não | não | não | não |

Sequence `orders_order_number_seq`: `USAGE=true`, `SELECT=true`, `UPDATE=false`.

### 9.3 Origem do excesso

O `cardapio_migrator` possui default ACL concedendo `arwd` em novas tabelas para `cardapio_dev_app` e `rU` em sequences. As tabelas `admins`, `categories` e `products` herdaram DML completo. A migration `20261031000000_rf004_fix_permissions` concede SELECT, mas não revoga esses grants antigos.

O banco de teste também apresenta default ACL semelhante, mas está com 3 migrations pendentes; portanto sua matriz não representa o fluxo completo.

### 9.4 Permissões mínimas necessárias

| Objeto | Permissões necessárias |
| --- | --- |
| `admins` | SELECT |
| `categories` | SELECT |
| `products` | SELECT |
| `comandas` | SELECT, INSERT, UPDATE |
| `comanda_invitations` | SELECT, INSERT, UPDATE |
| `comanda_sessions` | SELECT, INSERT |
| `orders` | SELECT, INSERT |
| `order_items` | SELECT, INSERT |
| `order_status_history` | SELECT, INSERT |
| `orders_order_number_seq` | USAGE, SELECT |
| Schema `public` | USAGE |
| `_prisma_migrations` | nenhum |

### 9.5 Plano proposto — não executado

```sql
-- Executar somente após aprovação específica, backup e janela controlada.
BEGIN;

REVOKE INSERT, UPDATE, DELETE
  ON TABLE "admins", "categories", "products"
  FROM cardapio_dev_app;

ALTER DEFAULT PRIVILEGES FOR ROLE cardapio_migrator
  REVOKE ALL ON TABLES FROM cardapio_dev_app;

ALTER DEFAULT PRIVILEGES FOR ROLE cardapio_migrator
  REVOKE ALL ON SEQUENCES FROM cardapio_dev_app;

GRANT SELECT
  ON TABLE "admins", "categories", "products"
  TO cardapio_dev_app;

GRANT SELECT, INSERT, UPDATE
  ON TABLE "comandas", "comanda_invitations"
  TO cardapio_dev_app;

GRANT SELECT, INSERT
  ON TABLE "comanda_sessions", "orders", "order_items", "order_status_history"
  TO cardapio_dev_app;

GRANT USAGE, SELECT
  ON SEQUENCE "orders_order_number_seq"
  TO cardapio_dev_app;

COMMIT;
```

Para o banco de teste, repetir com `cardapio_test_app`, somente depois de aplicar as migrations pendentes e com aprovação própria.

### 9.6 Rollback proposto — não executado

```sql
BEGIN;

GRANT INSERT, UPDATE, DELETE
  ON TABLE "admins", "categories", "products"
  TO cardapio_dev_app;

ALTER DEFAULT PRIVILEGES FOR ROLE cardapio_migrator
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cardapio_dev_app;

ALTER DEFAULT PRIVILEGES FOR ROLE cardapio_migrator
  GRANT USAGE, SELECT ON SEQUENCES TO cardapio_dev_app;

COMMIT;
```

### 9.7 Verificação pós-plano

Executar leitura com `has_table_privilege`, `has_sequence_privilege` e `has_schema_privilege`, comparando a matriz com a seção 9.4. Também verificar que `cardapio_dev_app` continua sem `CREATE` no schema e sem acesso a `_prisma_migrations`.

### 9.8 Pré-condições

- Aprovação humana específica para alteração de ACL.
- Backup recuperável aprovado; o item `rf004-2-2a-backup` continua sem backup criado.
- Aplicação controlada das migrations pendentes no teste antes de testar o fluxo real.
- Nenhuma alteração de permissão deve ser feita junto com a entrega de código sem janela e rollback definidos.

---

## 10. Riscos, bloqueios e pendências

### 10.1 Bloqueios atuais

1. **Banco de teste desatualizado**
   - 3 migrations pendentes.
   - Tabelas de comanda/convite/sessão ausentes.
   - Não é possível validar o fluxo real de pedido no `cardapio_digital_test` sem aplicar migrations, o que está fora do escopo autorizado.

2. **Permissões excessivas em Desenvolvimento**
   - `cardapio_dev_app` pode INSERT/UPDATE/DELETE em `admins`, `categories` e `products`.
   - Plano e rollback documentados, mas não executados.

3. **Backup pendente**
   - `rf004-2-2a-backup` segue bloqueado aguardando procedimento interativo local autorizado.
   - Nenhum backup foi criado nesta entrega.

4. **Fluxo ponta a ponta incompleto**
   - O backend possui os endpoints, mas o frontend atual só consome GETs de catálogo; não há tela/fluxo de login administrativo, resgate de convite, carrinho autenticado e envio de pedido.
   - Não há endpoint de consulta/acompanhamento de pedido.

### 10.2 Riscos e pendências técnicas

| Risco/pendência | Impacto | Observação |
| --- | --- | --- |
| `POST /api/orders` não exige `X-Rustika-Request` | Defesa CSRF menor que a documentada | Origem exata e SameSite ainda protegem; reconciliar antes do frontend. |
| CORS com credenciais aplicado globalmente | Superfície maior que o necessário | Catálogo não usa cookie; restringir por router é melhoria. |
| Sessão administrativa em memória | Logout em reinício e múltiplas instâncias | Documentado; exige store compartilhado para escala horizontal. |
| `notFound` reflete a URL original | Pode expor token se usado em URL | Evitar tokens/URLs; revisar mensagem em etapa de hardening. |
| Testes de seed quebrados | Suíte completa não fica 100% verde | Falhas legadas de mock/módulo, sem relação com pedidos. |
| Typecheck com 10 erros legados | Pipeline de typecheck não fica limpo | Erros em scripts/testes antigos; build de `src` passa. |
| Migrations de teste pendentes | Fluxo real não validado | Requer autorização e backup. |
| ACLs excessivas | Aplicação comprometida poderia alterar catálogo/admin | Plano de menor privilégio pronto, não executado. |

### 10.3 O que não foi feito

- Nenhum `POST` no banco de Desenvolvimento.
- Nenhum pedido real criado.
- Nenhuma migration aplicada.
- Nenhuma permissão alterada.
- Nenhum Seed executado.
- Nenhuma credencial lida, alterada ou impressa.
- Nenhum commit.

---

## 11. Conclusão e próximo passo controlado

**Parecer:** **CONCLUÍDA COM RESTRIÇÕES**.

A entrega cumpriu o objetivo de auditar e estabilizar o backend:

- Os routers de autenticação, comanda e pedido estão integrados ao app.
- CORS, cookies, parsers, limites e respostas de erro estão coerentes com o contrato.
- O bug que impedia pedir `rustika-PA062240` foi corrigido e coberto por testes.
- O fluxo de pedido está coberto por **169/169 testes focados**.
- Build passa.
- O banco de Desenvolvimento não foi alterado.
- O plano de menor privilégio e rollback está documentado, sem execução.

O fluxo real ainda **não está liberado** porque:

- O banco de teste tem 3 migrations pendentes.
- O banco de Desenvolvimento mantém ACLs excessivas.
- A integração de frontend para o checkout autenticado não foi feita.
- Há riscos operacionais pendentes (backup, sessão administrativa single-instance e divergência do header customizado em pedidos).

**Próximo passo controlado, sem executar agora:** obter aprovação específica para (1) criar backup recuperável, (2) aplicar as migrations pendentes no banco de teste isolado, (3) executar um teste de integração real de ponta a ponta com dados controlados e (4) tratar as ACLs em migration separada com o rollback documentado. Nenhuma dessas etapas foi iniciada nesta entrega.
