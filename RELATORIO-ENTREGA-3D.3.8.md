# RELATÓRIO DA ENTREGA 3D.3.8

Aceleração do desenvolvimento: segurança, integração e preparação para pedidos reais

Data: 03/11/2026 (America/Sao_Paulo)
Executor: Claude Code, nativo no Windows 11 (Node v24.20.0, PostgreSQL 18.6)
Base: `RELATORIO-ENTREGA-3D.3.7.md`, Partes II e III

**Classificação: CONCLUÍDA** (com as ressalvas da seção 14).

Classes de evidência: **[EXEC]** executado nesta entrega · **[INSP]** inspeção de código/arquivo · **[HERD]** herdado.

---

## 1. Estado inicial

| Item | Valor | Classe |
|---|---|---|
| Branch / commit | `main` / `1e80bdb` (único), sem remote | [EXEC] |
| `git status --short` | 118 entradas: 13 ` M`, 105 `??` | [EXEC] |
| Baseline SHA-256 | 193 arquivos (rastreados + não rastreados não ignorados), gravado fora do repositório antes de editar | [EXEC] |
| `RELATORIO-ENTREGA-3D.3.7.md` | presente (121 194 bytes) | [EXEC] |
| `core.autocrlf` | `true` (gitconfig do sistema) | [EXEC] |
| `.gitattributes` | não existia | [EXEC] |
| Backend / frontend | 440/440 e 43/43 | [HERD, reconfirmado indiretamente: as suítes completas passaram, seção 9 e 10] |

Arquivos envolvidos identificados antes de editar: `order.routes.ts`, `access.routes.ts`, `accessLimits.ts`, `app.ts`, testes de pedidos/acesso, `api.ts`, páginas `AdminLogin`/`AdminDashboard`/`Checkout`, `ComandaRedeem`, `AppWrapper`, `main.tsx`, `App.tsx`, `CartDrawer`, `OrderReview`, `CartContext`, docs `orders-api.md` e `access-api.md`.

### 1.1 Proteção de fim de linha das migrations (Etapa 1)

1. **Prova antes de aplicar** [EXEC]: num repositório descartável no scratchpad, com o mesmo `autocrlf=true`, copiei as 4 migrations, criei `.gitattributes` com `backend/prisma/migrations/** -text`, fiz `add`/`commit` **no repositório descartável** e clonei. Resultado: SHA-256 no clone **idênticos** aos originais; `git ls-files --eol` mostrou `i/lf` nas antigas e `i/crlf` nas novas, todas `attr/-text`. Controle sem a regra: as duas antigas mudaram no clone (`fd781a6b…`, `0f5e3ac1…`), confirmando o risco.
2. **Aplicação no projeto** [EXEC]: criado `.gitattributes` na raiz com exatamente uma linha: `backend/prisma/migrations/** -text`.
3. **Verificação depois** [EXEC]: SHA-256 das 4 migrations e do `migration_lock.toml` iguais aos de antes; `git check-attr` = `text: unset` nas 4; `git hash-object --no-filters` igual a `git hash-object --path` nas 4 (nenhuma conversão ao adicionar).
4. Nenhum `git add`, `commit`, `reset`, `clean` ou `--renormalize` no repositório do projeto. Nenhuma migration convertida ou editada.

| Migration | SHA-256 (antes = depois) |
|---|---|
| `20261023000000_initial_schema` | `1a9cd08b9d49fa9f70eabcceaa4a696f5aee07555f6a88562ec789340f0d3983` |
| `20261027000000_rf004_comandas_catalogo_pedidos` | `05f583e854a87b77612c2f7d10a0a178ef45ea099d3237808b5bf0bd7c698122` |
| `20261031000000_rf004_fix_permissions` | `960766a8fb1576e6094622f112e1a3a9cd7455f56907a3405a8fbb183959e10b` |
| `20261102000000_update_products_source_identity_constraint` | `885b8de5dcc0cf5e7618d574ba5c013ae8b60c9b983260706c5819422564454f` |
| `migration_lock.toml` | `99836963713b4f5b269ad49af0ed3d7b0b2e336115c2f92dc9ac683d139d0900` |

---

## 2. Arquivos alterados

Backend (código):

| Arquivo | Estado Git | Mudança |
|---|---|---|
| `backend/src/security/writeGuard.ts` | novo | Guarda CSRF única: Origin exata + `X-Rustika-Request: 1` (403), JSON (415) |
| `backend/src/security/accessLimits.ts` | não rastreado, alterado | `createFixedWindowLimiter` (hit/peek, expiração em ordem, despejo do mais antigo), `tooManyRequests`, `clientAddress`; `accessLimit` reescrito sobre ele |
| `backend/src/routes/order.routes.ts` | não rastreado, alterado | Header obrigatório via `writeGuard`; 3 camadas de limite; `ORDER_RATE_LIMITS` |
| `backend/src/routes/access.routes.ts` | não rastreado, alterado | `writeGuard` local passou a usar `assertWriteRequest` (mesmo comportamento) |
| `backend/src/app.ts` | modificado | Passa relógio e `orderLimits` (só para teste) ao router de pedidos |

Backend (testes e docs): `tests/orders-csrf.test.ts` (novo), `tests/orders-rate-limit.test.ts` (novo), `tests/security/accessLimits.test.ts` (novo), `tests/orders.test.ts` (header no helper, no teste 503 e no preflight), `tests/access.test.ts` (header no pedido do fluxo completo), `tests/fixtures/orders.ts` (`addCredential` para várias sessões válidas), `docs/orders-api.md`, `docs/access-api.md`.

Frontend:

| Arquivo | Estado Git | Mudança |
|---|---|---|
| `src/services/api.ts` | modificado | `ApiError` (status, código, `retryAfterSeconds`, `retryable`); chamadas autenticadas com `credentials: 'include'`; `post` sempre com `X-Rustika-Request: 1` e `Content-Type` fixo; 204 tratado; `getWithAuth` sem `Authorization`/`localStorage`; `createOrder` com validação de UUID v4 |
| `src/services/orderSubmission.ts` | novo | Montagem do corpo a partir do carrinho, controle de `Idempotency-Key`, bloqueio de envio duplo, mensagens por erro, chave de ativação `VITE_ORDER_SUBMISSION` |
| `src/contexts/CartContext.tsx` | modificado | `comandaSession` validada pelo backend, separada do número digitado |
| `src/components/ComandaRedeem.tsx` | não rastreado, reescrito | Usa o contexto, valida formato do convite, mensagens por status, cancela requisição ao desmontar |
| `src/pages/AdminLogin.tsx`, `AdminDashboard.tsx` | não rastreados, reescritos | Tipos, mensagens por status, limpeza da senha, logout tolerante a falha, 401 no convite volta ao login |
| `src/pages/Checkout.tsx` | não rastreado; era um arquivo **vazio (0 bytes)** | Etapa de envio: dados do cliente, envio idempotente, confirmação |
| `src/AppWrapper.tsx` | não rastreado | Tipagem (`AdminSession`) |
| `src/main.tsx` | modificado | Entrada passa a ser `AppWrapper` (catálogo por padrão, `#admin`) |
| `src/App.tsx` | modificado | Diálogo `checkout` |
| `src/components/CartDrawer.tsx` | modificado | Renderiza `ComandaRedeem` acima do número de comanda |
| `src/components/OrderReview.tsx` | modificado | Botão "Prosseguir para envio" só com sessão validada |
| `package.json` | modificado | Dois arquivos de teste novos no script `test` |
| `tests/http-client.test.mjs`, `tests/order-submission.test.mjs` | novos | Seção 8 |

Raiz: `.gitattributes` (novo) e este relatório.

Não alterados, de propósito: `catalogSource.ts`, `catalogStore.ts` e `types/catalog.ts`. Eles só usam `api.getCatalog` (GET público, sem cookie) [INSP]; mexer neles não era necessário para corrigir o cliente. Nenhuma migration, `schema.prisma`, `.env`, config de perfis ou serviço de domínio foi alterado.

---

## 3. Correção do header CSRF

- `POST /api/orders` exige agora `X-Rustika-Request: 1`, com o **mesmo código** das rotas de acesso (`assertWriteRequest`). Erro: `403 ORIGIN_NOT_ALLOWED`, mensagem "Origem ou proteção da requisição inválida." [EXEC]
- Ordem preservada: limite de IP → Origin + header (403) → JSON (415) → query (400) → cookie (401) → `Idempotency-Key` (400) → corpo → serviço. Tudo antes de qualquer acesso ao banco.
- Sessão, cookies (`HttpOnly`, `SameSite=Lax`, path `/api`) e regras de comanda: **inalterados**.
- Prova no servidor real (backend compilado, em execução local): `POST /api/orders` com Origin correta e sem o header → **HTTP 403**, recusado antes de qualquer acesso ao banco. [EXEC]

---

## 4. Rate limiting implementado

### 4.1 Mecanismo (`accessLimits.ts`)

| Requisito | Solução |
|---|---|
| Expiração e limpeza | Janela fixa. Como todas as entradas de um limitador têm a mesma janela, a ordem de inserção do `Map` é a ordem de expiração: os vencidos são removidos do início a cada acesso, em O(vencidos), sem varrer o mapa inteiro (antes era O(n) por requisição) |
| Limite de memória | Até 10 000 chaves por limitador (configurável) |
| Capacidade cheia | **Corrigido**: antes, com 10 000 chaves vivas, toda chave nova recebia 429 (bloqueio de clientes legítimos). Agora a entrada mais antiga é descartada e o cliente novo é atendido. Custo aceito e documentado: sob inundação com mais de 10 000 chaves distintas, contadores antigos podem ser reiniciados |
| 429 padronizado | `{ success: false, error: { code: 'TOO_MANY_REQUESTS', message } }` + `Retry-After` em segundos, para pedidos e rotas de acesso |
| IP | `request.ip`, sem `trust proxy`; `X-Forwarded-For` ignorado (testado) |

### 4.2 Política de pedidos (`ORDER_RATE_LIMITS`)

| Camada | Chave | Limite | Justificativa |
|---|---|---|---|
| Teto por IP | IP | 300 / 5 min | Primeira verificação (429 antes de 403/413). Alto porque as mesas compartilham o IP do Wi-Fi. Teste: 20 sessões no mesmo IP × 10 pedidos = 200 pedidos sem nenhum 429 |
| Falhas de sessão | IP | 30 / 5 min | Conta cookie ausente/malformado e sessão inexistente/expirada. Ao estourar, só sessões **ainda não confirmadas** recebem 429; sessões que já tiveram pedido aceito (ou recusado por regra de negócio, o que exige sessão válida) continuam funcionando |
| Por sessão | SHA-256 do cookie | 10 / 5 min | Um dispositivo de uma comanda; replays com a mesma chave também contam |
| Sessões confirmadas | SHA-256 do cookie | 8 h (igual à sessão) | Conjunto limitado e com expiração |

Valores são hipóteses de uso, sem medição de tráfego real. Sem Redis, sem dependência nova.

---

## 5. Correção do cliente HTTP

| Requisito | Situação | Prova |
|---|---|---|
| `credentials: 'include'` nas operações com cookie | `post`, `getWithAuth`, `createOrder` | teste [EXEC] |
| `X-Rustika-Request: 1` | Em todo `post`; o chamador não consegue remover nem trocar `Content-Type` | teste [EXEC] |
| `Content-Type: application/json` | Fixo em `post` | teste [EXEC] |
| `Idempotency-Key` | `createOrder` exige UUID v4 e envia o header | teste [EXEC] |
| 401, 403, 409, 429 | `ApiError` com status, código do backend, mensagem do servidor ou padrão por status; 429 com `Retry-After` | teste [EXEC] |
| Falha de rede / timeout | `ApiError` status 0, `NETWORK`/`TIMEOUT`, `retryable` | teste [EXEC] |
| Duplicação de pedidos | `createOrderSubmitter`: um envio por vez; mesma carga mantém a mesma chave até o sucesso (reenvio vira replay 200 no backend); carga diferente recebe chave nova; após sucesso, chave descartada | teste [EXEC] |
| Sem tokens em `localStorage` | `getWithAuth` não lê mais `localStorage.adminToken` nem envia `Authorization` (que o backend nunca emitiu) | teste [EXEC] |
| Catálogo público | GETs do catálogo continuam sem credenciais e sem header de escrita | teste [EXEC] + navegador (seção 6) |

---

## 6. Integração das telas existentes

Fluxo ligado na aplicação (sem segunda implementação de autenticação, sem login fictício):

1. **Login administrativo**: `main.tsx` agora renderiza `AppWrapper`; `#admin` abre `AdminLogin`, que consulta `/admin/auth/session` e faz `POST /admin/auth/login`. O cookie `rustika_admin` é do backend.
2. **Emissão de convite**: `AdminDashboard` → `POST /admin/comanda-invitations`; mostra convite, comanda e validade; 401 volta ao login.
3. **Resgate**: `ComandaRedeem` dentro do carrinho → `POST /comanda-sessions`; o cookie `rustika_session` fica no navegador, HttpOnly.
4. **Validação de sessão**: `GET /comanda-sessions/current` na abertura do carrinho.
5. **Associação à comanda**: `CartContext.comandaSession` guarda número e expiração validados; o número digitado da demonstração continua existindo, mas não habilita envio.
6. **Preparação do checkout**: `OrderReview` mostra "Prosseguir para envio" só com sessão validada igual à comanda do carrinho; `Checkout` coleta nome, mesa e observações e usa o envio idempotente.

**O envio real está desligado por padrão.** O botão só fica habilitado com `VITE_ORDER_SUBMISSION=enabled` no build. Nesta entrega não foi enviado nenhum pedido, em nenhum banco.

Verificação no navegador do app [EXEC], com backend compilado contra o Dev só para leitura e frontend em `vite` dev:

- Catálogo: 144 cartões de produto renderizados, navegação de categorias presente, nenhum erro de carregamento.
- Carrinho: bloco "Vincular comanda" visível acima do número de comanda.
- `GET /comanda-sessions/current` e `GET /admin/auth/session` → 401 (esperado sem sessão). Os 401 aparecem no console como "Failed to load resource" (comportamento do navegador). Os `ERR_ABORTED` duplicados vêm da montagem dupla do StrictMode em desenvolvimento, já que o componente cancela a requisição ao desmontar.
- `#admin`: formulário "Acesso Administrativo" renderizado.
- Não fiz login, não emiti convite e não enviei pedido (todos gravariam no Dev). Os servidores temporários foram encerrados.

Limitação explícita: o fluxo ponta a ponta login → convite → resgate → pedido foi exercitado **só com `fetch` simulado** nos testes do frontend e com **Prisma simulado** nos testes do backend. Validação real depende das migrations em Test (seção 12).

---

## 7. Contratos atualizados

| Contrato | Antes | Agora | Documento |
|---|---|---|---|
| K1 Header de escrita | Só rotas de acesso | Todas as escritas por cookie, inclusive pedidos | `orders-api.md` (requisição, proteção CSRF, tabela de erros), `access-api.md` |
| K2 429 em pedidos | Inexistente | `TOO_MANY_REQUESTS` + `Retry-After`, 3 camadas | `orders-api.md` "Limites de requisição" |
| K3 CORS | Doc dizia "credenciais só em pedidos" | Doc descreve o real: credenciais para a única origem configurada em toda a API, sem curinga; código **inalterado** | `orders-api.md` "CORS" |
| K4 Cliente | `post` sem cookie/header; `Bearer` inexistente | Cookie + header; sem `Authorization` | `api.ts` |
| Capacidade dos limites | 429 para todo novo cliente com a tabela cheia | Despejo do mais antigo | `access-api.md`, `orders-api.md` |

CORS (Etapa 6): sem mudança de código, porque não há risco concreto (origem única e exata; `*` com credenciais falha fechado). Preflights cobertos: `orders.test.ts` (agora também verifica `X-Rustika-Request` em `allow-headers`) e `access.test.ts`.

---

## 8. Testes criados

Backend (+36):

| Arquivo | Testes | Cobre |
|---|---|---|
| `tests/orders-csrf.test.ts` | 13 | válido 201; header ausente; 7 valores inválidos (`0`, `true`, vazio, `01`, `11`, `yes`, `1,1`); Origin inválida com header; JSON e chave ainda exigidos; sessão inválida 401; header verificado antes da sessão |
| `tests/orders-rate-limit.test.ts` | 11 | valores padrão; rajada com `Retry-After` sem chegar ao serviço; expiração da janela; várias sessões no mesmo IP; 20 mesas × 10 pedidos sem 429; falhas de sessão bloqueiam só sessões não confirmadas; cookie malformado conta; expiração do bloqueio; teto de IP antes de 403/413; replays contam; saturação da memória não bloqueia cliente novo |
| `tests/security/accessLimits.test.ts` | 12 | rajada; `peek`; expiração e limpeza; `Retry-After`; despejo do mais antigo; 25 000 chaves ficam em 10 000; configurações inválidas (4); 429 padronizado; `X-Forwarded-For` ignorado |

Frontend (+23): `tests/http-client.test.mjs` (15) e `tests/order-submission.test.mjs` (8): credenciais, header, `Content-Type`, sem `Authorization`/`localStorage`, catálogo sem credenciais, 204, 401/403/409/429, rede, timeout, AbortError, envelope inválido, `createOrder`, mensagens das telas, montagem do corpo, mesma chave no reenvio, chave nova para carga alterada, chave nova após sucesso, clique duplo, mensagens de erro, envio desligado por padrão.

Ajustes em testes existentes, sem enfraquecer nada: os helpers de `orders.test.ts` e o pedido do fluxo completo em `access.test.ts` passaram a enviar o header (exigência do contrato novo); o preflight ganhou uma asserção a mais. Um caso que eu tinha escrito (`" 1"`) foi trocado por `"01"`: o parser HTTP do Node remove espaços nas pontas do valor, então `" 1"` chega como `"1"`. É comportamento do protocolo, não brecha.

---

## 9. Resultado completo dos testes backend [EXEC]

`NODE_ENV=test`, `DB_PROFILE=app-test`, `npm test`:

```
Test Files  23 passed (23)
     Tests  476 passed (476)
```

440 anteriores + 36 novos. Nenhum teste removido ou pulado. Suíte só com Prisma simulado; nenhuma conexão a banco.

## 10. Resultado completo dos testes frontend [EXEC]

`npm test` (node:test):

```
tests 66 · pass 66 · fail 0 · cancelled 0 · skipped 0
```

43 anteriores + 23 novos.

## 11. Typecheck e Build [EXEC]

| Projeto | `npm run typecheck` | `npm run build` |
|---|---|---|
| Backend | exit 0, 0 erros | exit 0 (`tsc -p tsconfig.build.json`) |
| Frontend | exit 0, 0 erros | exit 0 (Vite: 55 módulos; JS 274,14 kB, gzip 84,48 kB) |

Smoke test de leitura [EXEC], com o backend compilado em execução local apontando para o Dev só para GET: `/api/health` ok; **12 categorias**; **144 produtos** (paginação completa); `rustika-PA062240` = **5000 centavos**.

---

## 12. Estado PostgreSQL Test [EXEC]

Acesso: script descartável fora do repositório, usando o resolvedor de segredos do próprio projeto (`loadDatabaseProfile('migrate-test')`). A senha só foi passada no ambiente dos processos `psql`/`pg_dump`, nunca impressa. Todas as sessões rodaram com `default_transaction_read_only=on` (confirmado: `somente_leitura = on`).

| Verificação | Resultado |
|---|---|
| Identidade | `cardapio_digital_test`, `current_user = cardapio_migrator`, `127.0.0.1:5432` |
| Versão | **18.6**, `server_version_num = 180006` (≥ 170000, compatível com `MAINTAIN`) |
| `_prisma_migrations` | 1 linha: `20261023000000_initial_schema`, concluída, não revertida, 1 passo, sem log |
| Checksum gravado | `1a9cd08b…0d3983`, **igual** ao arquivo no disco |
| Migrations pendentes | `20261027`, `20261031`, `20261102`; os objetos delas estão ausentes (`comandas`, `comanda_invitations`, `comanda_sessions`, `product_availability`, `comanda_status` = nulos) |
| Tabelas | `admins`, `categories`, `products`, `orders`, `order_items`, `order_status_history`: **0 linhas** cada; `_prisma_migrations`: 1 |
| Roles | `cardapio_dev_app`, `cardapio_test_app`, `cardapio_migrator`: todas login, nenhuma superuser, createrole, createdb ou bypassrls |
| Sessões concorrentes | **0** (além da própria consulta) |

Nenhum `migrate deploy`, Seed, fixture, `GRANT`/`REVOKE` ou escrita.

## 13. Backup gerado e validação de integridade [EXEC]

| Item | Valor |
|---|---|
| Comando | `pg_dump 18.6 -Fc --create` (perfil `migrate-test`, sessão read-only) |
| Arquivo | `C:\Users\u1n3c\AppData\Local\RustikaBackups\cardapio_digital_test_pre3d38_20261104-012137.dump` (fora do OneDrive e do repositório; o nome usa hora UTC) |
| Tamanho | 20 928 bytes |
| SHA-256 | `1be946052157a2c54b7af979c9c174e0d41d70cfaab9abc9b5de90663f925265` |
| Assinatura | `PGDMP` |
| `pg_restore --list` | exit 0; formato CUSTOM, gzip, dump version 1.16-0, origem e `pg_dump` 18.6, `dbname: cardapio_digital_test`; 59 entradas no cabeçalho, 54 listadas |
| Conteúdo listado | 7 TABLE e 7 TABLE DATA (as 7 tabelas, incluindo `_prisma_migrations`), 7 CONSTRAINT, 5 FK, 13 INDEX, 1 TYPE, sequência (3 entradas), 8 ACL, 2 DEFAULT ACL |

Observação honesta: com `--create` era esperada uma entrada `DATABASE`. Ela não aparece no `--list`, e as 5 entradas do cabeçalho que não foram listadas devem ser as especiais (ENCODING, STDSTRINGS, SEARCHPATH, DATABASE e propriedades), mas não confirmei isso. Só o teste de restauração em banco temporário (não autorizado nesta entrega) prova que o arquivo é restaurável. **Restore não executado.**

---

## 14. Pendências

Ressalvas desta entrega:

1. O fluxo real login → convite → resgate → pedido **não foi executado contra banco**. Exige migrations em Test, fixtures (admin, categorias, produtos) e autorização.
2. Teste de restauração do backup em banco temporário: pendente de autorização.
3. Envio real desligado por padrão (`VITE_ORDER_SUBMISSION`); ligar só depois da integração em Test.
4. Validação visual parcial: catálogo, carrinho e `#admin` renderizados no navegador; login, convite, resgate e checkout não exercitados na interface.

Próximos passos que dependem de decisão:

5. Autorizar `npm run db:migrate:deploy:test` (pré-condições da 3D.3.7 agora atendidas: versão 18.6, `orders` vazia, roles presentes, nenhuma sessão concorrente, checksum da inicial conferido, backup B0 gerado). Falta o teste de restauração, se for exigido.
6. Role e carga de fixtures para Test (3D.3.7, seção 22).
7. Checkpoint Git: commits por grupo (3D.3.7, seção 31). Agora o `.gitattributes` já está no lugar, mas também não está versionado.
8. Produção: `trust proxy` com saltos explícitos, store compartilhado de limites e sessões admin, validação de `CORS_ORIGIN` na inicialização, CORS com credenciais restrito às rotas autenticadas, recalibrar os limites com tráfego real.
9. Estado de `_prisma_migrations` e ACL do Dev (R5, R7) antes de ligar o checkout contra o Dev.
10. Cosmético: as telas novas usam estilos inline herdados dos componentes originais; os 401 de "sem sessão" aparecem no console do navegador.

## 15. Estado do Git [EXEC]

```
branch: main · commit: 1e80bdb (único) · remote: nenhum · commits criados: 0
git status --short: 129 entradas (17 " M", 112 "??")
```

- Diferença em relação ao início: +4 modificados (`CartDrawer.tsx`, `OrderReview.tsx`, `CartContext.tsx`, `main.tsx`); +7 entradas não rastreadas (`.gitattributes`, `orders-csrf.test.ts`, `orders-rate-limit.test.ts`, `tests/security/`, `orderSubmission.ts`, `http-client.test.mjs`, `order-submission.test.mjs`) e este relatório.
- Baseline SHA-256: 21 arquivos com conteúdo alterado, todos listados na seção 2; os demais 172 idênticos. As 4 migrations e o `migration_lock.toml` idênticos.
- Nenhum `git add`, `commit`, `reset`, `clean`, `restore`, `checkout` ou `--renormalize` no repositório do projeto. O `add`/`commit` da seção 1.1 ocorreu só no repositório descartável do scratchpad.
- Arquivos ignorados regenerados pelos builds: `backend/dist/`, `frontend/dist/`.

## 16. Parecer final

**CONCLUÍDA.**

Critérios de aceite:

| Critério | Situação |
|---|---|
| Endpoint de pedidos valida o header obrigatório | sim; testes e servidor real (403) |
| Rate limiting implementado e testado | sim; 3 camadas + correção da saturação, 23 testes dedicados (11 de rota + 12 do limitador) |
| Cliente HTTP envia credenciais e headers | sim; 15 testes |
| Fluxo de autenticação/comanda conectado à aplicação | sim; `main.tsx` → `AppWrapper`, telas renderizadas no navegador; exercício completo só com mocks |
| Testes backend | 476/476 |
| Testes frontend | 66/66 |
| Typecheck e build | aprovados nos dois projetos |
| Catálogo público | 12 categorias, 144 produtos, PA062240 a R$ 50,00 (API e navegador) |
| Sem alteração indevida no PostgreSQL | sim; só leituras em transação read-only no Test e GETs no Dev |
| Pendências documentadas | seção 14 |

Nenhuma fase seguinte foi iniciada. Aguardo a auditoria do ChatGPT.
