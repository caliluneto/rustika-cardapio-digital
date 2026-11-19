# RELATÓRIO ENTREGA 3D.3.2

**Data:** 03/11/2026
**Status:** CONCLUÍDO COM PENDÊNCIAS
**Escopo:** diagnóstico e correção do registro das rotas HTTP do catálogo, validação real por GET e consolidação das evidências.

---

## 1. Causa efetiva do NOT_FOUND

O `backend/src/app.ts` do baseline montava apenas `/api/health`. O `createCatalogRouter` não era importado nem registrado, portanto:

- `GET /api/categories`
- `GET /api/products`
- `GET /api/products/:productId`

caíam no middleware `notFound` e retornavam `404 NOT_FOUND`. O `git diff` confirma que a correção no código é mínima: duas linhas em `backend/src/app.ts` (import do router e `app.use('/api', createCatalogRouter(dependencies.prisma))`).

Verificação dos sete pontos solicitados:

1. **Importação:** `createCatalogRouter` está importado em `backend/src/app.ts:8`.
2. **Registro:** montado em `/api` em `backend/src/app.ts:26`.
3. **Ordem:** o catálogo é montado antes de `notFound` e `errorHandler` (`app.ts:25-29`).
4. **Caminhos:** os caminhos registrados (`/categories`, `/products`, `/products/:productId`) correspondem aos caminhos públicos testados.
5. **Ambiente:** não há condição de ambiente que impeça o registro. O bootstrap real subiu com `NODE_ENV=development` e `DB_PROFILE=app-dev`.
6. **Instância na porta 4000:** confirmada como a instância atual do RÚSTIKA — PID 11196, comando `node dist/server.js`, única escuta na porta, log de inicialização `perfil=app-dev banco=cardapio_digital_dev role=cardapio_dev_app`. O processo foi encerrado ao final desta sessão.
7. **Dependências:** `backend/src/server.ts` cria o runtime Prisma e injeta `{ prisma }` em `createApp`. As consultas reais do catálogo executaram; sem Prisma, o router responde `503 CATALOG_UNAVAILABLE`, comportamento esperado.

**Correção secundária já presente:** o mapper passou a aceitar códigos alfanuméricos (`/^[0-9A-Z]{1,64}$/`), permitindo `PA062240`. A rota de detalhe usa `/^rustika-[0-9A-Z]{1,64}$/`. Essa correção evita erro de mapeamento; ela não era a causa do `NOT_FOUND`.

---

## 2. Correções existentes e alterações desta sessão

**Já existentes no ambiente (não commitadas):**

- `backend/src/app.ts`: import e montagem de `createCatalogRouter` em `/api`.
- `backend/src/mappers/catalog.mapper.ts`: regex de `sourceCode` ampliada para letras maiúsculas e dígitos.

**Nesta sessão:**

- Nenhuma alteração no código-fonte do backend ou do frontend.
- Apenas validação HTTP real, inspeção somente leitura do PostgreSQL Dev e atualização deste relatório.
- Nenhum arquivo do Git foi removido, resetado, limpo ou commitado.

**Arquivos relevantes não rastreados (permanecem como estavam):** rotas, serviços, mappers, testes, fixtures e documentação do catálogo, além dos relatórios anteriores. O único arquivo rastreado modificado no repositório é `backend/src/app.ts`.

---

## 3. Resultados reais HTTP

Servidor: `node dist/server.js` (build atual), porta 4000, perfil `app-dev`, banco `cardapio_digital_dev`, role `cardapio_dev_app`. Somente requisições GET foram executadas.

| Requisição | Status | Resultado |
| --- | --- | --- |
| `GET /api/health` | 200 | `success=true`, `status=ok`, `service=cardapio-digital-api`, timestamp e uptime válidos. |
| `GET /api/categories` | 200 | 2 categorias: `rustika-category-diversos` (DIVERSOS) e `rustika-category-insumo` (INSUMO), ambas com `displayOrder=0`. |
| `GET /api/products` | 200 | 3 produtos, `nextCursor=null` com o limite padrão 30. |
| `GET /api/products?limit=50` | 200 | Os mesmos 3 produtos. |
| `GET /api/products?limit=1` | 200 | 3 páginas, uma por produto, sem duplicidade: `rustika-47`, `rustika-44`, `rustika-PA062240`; cursores avançaram corretamente. |
| `GET /api/products?categoryId=rustika-category-diversos` | 200 | 1 produto (`rustika-47`). |
| `GET /api/products?categoryId=rustika-category-insumo` | 200 | 2 produtos (`rustika-44` e `rustika-PA062240`). |
| `GET /api/products?availability=UNKNOWN` | 200 | 2 produtos. |
| `GET /api/products?availability=AVAILABLE` | 200 | 1 produto (`PA062240`). |
| `GET /api/products?availability=UNAVAILABLE` | 200 | 0 produtos. |
| `GET /api/products/rustika-PA062240` | 200 | `id=rustika-PA062240`, `priceInCents=5000`, `isAvailable=true`, `categoryId=rustika-category-insumo`, nome `PANCETA (QUADRADA) SUINA- TORRESMO DE ROLO`. |
| `GET /api/products/rustika-999999` | 404 | `PRODUCT_NOT_FOUND` — "Produto não encontrado." |
| `GET /api/products?limit=51` | 400 | `INVALID_INPUT` — parâmetros de catálogo inválidos. |
| `GET /api/products/%E0%A4%A` | 500 | `INTERNAL_ERROR` — falha conhecida de URL malformada; o teste espera 400. |
| `GET /api/rota-inexistente` | 404 | `NOT_FOUND` com mensagem padronizada. |

**Produtos devolvidos (preço conferido contra o banco em modo somente leitura):**

| ID | Nome | Preço no banco | `priceInCents` | Disponibilidade |
| --- | --- | --- | --- | --- |
| `rustika-47` | GELO (BALDE) | 5.00 | 500 | UNKNOWN (`null`) |
| `rustika-44` | BALY 2L | 26.00 | 2600 | UNKNOWN (`null`) |
| `rustika-PA062240` | PANCETA (QUADRADA) SUINA- TORRESMO DE ROLO | 50.00 | 5000 | AVAILABLE (`true`) |

Os preços retornados coincidem exatamente com os valores do PostgreSQL. Não há produtos com preço inválido, ID fora do padrão, categoria desconhecida ou ID duplicado no conjunto retornado.

**Nomes acentuados:** os 3 produtos públicos não possuem acento no nome. Existem categorias acentuadas no banco (por exemplo, ENERGÉTICO, PORÇÕES, GELO CÔCO e ÁGUA), mas elas estão sem `publicKey` e por isso não são públicas. Não foi possível validar nome acentuado de produto pela API pública nesta amostra.

---

## 4. Quantidade de produtos públicos retornados

A API retornou **3 produtos** e **2 categorias**. Isso diverge dos totais do PostgreSQL, e a causa foi identificada por consulta somente leitura, sem alterar registros:

| Métrica no PostgreSQL Dev | Valor |
| --- | --- |
| Produtos totais | 168 |
| Produtos ativos | 168 |
| Produtos com `publicKey` | 144 |
| Produtos internos (`publicKey` nula) | 24 |
| Categorias totais | 12 |
| Categorias ativas | 12 |
| Categorias elegíveis (`publicKey` não nula) | 2 |
| Produtos elegíveis pelo contrato da API | 3 |

**Motivo da divergência:** o serviço exige categoria ativa e com `publicKey`. Dez das doze categorias estão sem `publicKey`, e 141 produtos pertencem a elas:

| Categoria sem `publicKey` | Produtos |
| --- | --- |
| ENERGÉTICO | 12 |
| REFRIGERANTE | 10 |
| PORÇÕES | 13 |
| DRINKS | 26 |
| GELO CÔCO | 3 |
| CERVEJA | 14 |
| DRINK PRONTO | 9 |
| SUCO | 8 |
| DESTILADO | 44 |
| ÁGUA | 2 |
| **Total** | **141** |

A soma fecha: 3 elegíveis + 141 em categorias sem `publicKey` + 24 internos = 168 produtos. Portanto, **o NOT_FOUND foi resolvido**, mas a exposição de 144 produtos não ocorre porque 141 deles dependem de categorias ainda não publicadas. Trata-se de pendência de reconciliação de dados, não de defeito de rota. Nenhum registro foi alterado.

---

## 5. Proteção dos produtos internos

O `catalog.service.ts` filtra explicitamente por:

- `product.isActive = true`
- `product.publicKey != null`
- `sourceCode`, `sourceName` e `sourceGroup` não nulos
- categoria ativa e com `publicKey`

Os 24 produtos internos possuem `publicKey` nula (e também `sourceCode` nulo nesta base), portanto não têm identificador público e não podem ser retornados pela listagem nem acessados por `/api/products/:productId`. A API retornou somente IDs `rustika-*` de produtos elegíveis; nenhum produto interno foi exposto. Uma requisição de detalhe para ID inexistente/interno retorna o mesmo `404 PRODUCT_NOT_FOUND`.

---

## 6. Resultado dos testes e falhas remanescentes

**Suíte completa**, com isolamento preservado (`NODE_ENV=test`, `DB_PROFILE=app-test`):

- 19 arquivos de teste.
- 14 aprovados, 5 com falha.
- 429 testes individuais: **370 aprovados, 59 falhos**.

**Testes diretamente relacionados ao catálogo** (`catalog.test.ts`, `catalog.service.test.ts`, `health.test.ts`):

- 3 arquivos: 2 aprovados, 1 com falha.
- 70 testes: **69 aprovados, 1 falho**.
- Falha: `GET /api/products/%E0%A4%A` retorna 500 em vez de 400 `INVALID_INPUT`. O Express falha ao decodificar o parâmetro antes da validação da rota e o `errorHandler` trata `URIError` como erro interno. Não foi corrigido nesta sessão para não ampliar o escopo.

**Demais falhas observadas:**

- `tests/access.test.ts`: `createApp` não monta `createAccessRouters` e não aceita `authClock`; os endpoints de autenticação retornam 404 em vez dos status esperados. Fora do escopo desta entrega.
- `tests/orders.test.ts`: `createApp` não monta `createOrderRouter`; `POST /api/orders` retorna 404. Fora do escopo.
- `tests/scripts/executor-seed-real.test.ts`: 5 falhas por mock incompleto (`prisma.product.findMany` ausente) e expectativa de role divergente da fixture (`cardapio_dev_app` versus `cardapio_migrator`).
- `tests/scripts/seed-dev.test.ts`: módulo `scripts/seed-dev` ausente.

A hipótese de que as suítes estariam bloqueadas por perfil de ambiente **não se confirmou** nesta execução: com `app-test`, o gate de ambiente passa e as falhas restantes são de código/teste, não de configuração de banco. Nenhum teste escreveu no banco Dev; os testes de catálogo usam Prisma simulado.

---

## 7. Build e Typecheck

- **Build:** `npm run build` (`tsc -p tsconfig.build.json`) concluído com **exit 0**. `dist/` regenerado com o router de catálogo montado.
- **Typecheck:** `npm run typecheck` (`tsc --noEmit`) falhou com **exit 2** e 11 diagnósticos, todos fora do código de produção do catálogo:
  - `scripts/analyze-excel.ts` — 2 erros de tipagem.
  - `scripts/analyze-excel2.ts` — 1 erro.
  - `scripts/executor-seed-real.ts` — 5 erros.
  - `scripts/validate-api.ts` — 1 import inválido (`./src/app`).
  - `tests/access.test.ts` — `authClock` não existe em `AppDependencies`.
  - `tests/scripts/seed-dev.test.ts` — módulo `../../scripts/seed-dev` ausente.

Não há erros de tipagem em `src/app.ts`, `src/routes/catalog.routes.ts`, `src/services/catalog.service.ts` ou `src/mappers/catalog.mapper.ts`.

---

## 8. Pendências para autenticação e pedidos

- `createAccessRouters` e `createOrderRouter` existem, mas não estão montados em `app.ts`. Por isso autenticação, convites e pedidos retornam 404 nos testes e não estão operacionais via HTTP.
- `createApp` não expõe `authClock`, exigido pelos testes de autenticação.
- Corrigir esses pontos exige ampliar o bootstrap e o contrato de dependências; não foi feito nesta entrega, conforme o escopo.
- As falhas de mock do executor de Seed e o typecheck geral também permanecem pendentes.

---

## 9. Situação do frontend

O frontend **não está pronto para consumir o catálogo real**:

- `frontend/src/services/api.ts` expõe apenas `getHealth`; não há `getCatalog`, `getCategories`, `getAllProducts` ou `getProduct`, apesar de `catalogSource.ts` importar `api.getCatalog`.
- `frontend/src/types/catalog.ts` não exporta `CatalogData`, usado por `catalogSource.ts` e `catalogStore.ts`.
- `frontend/src/services/catalogAdapter.ts` valida produto com `/^rustika-[0-9]{1,64}$/`, que rejeita `rustika-PA062240`; o backend já aceita códigos alfanuméricos.
- O tipo `Product` do frontend não inclui `ingredients`, e há incompatibilidade de `isAvailable` (`boolean | null` versus `boolean | undefined`).
- `npm run typecheck` do frontend falha com 6 erros; o build do frontend não foi declarado aprovado.

A URL padrão `http://localhost:4000/api` e o modo `VITE_CATALOG_MODE=api` estão previstos, mas a camada de serviço/tipos precisa ser concluída antes da integração. Nada foi alterado no frontend nesta sessão.

---

## 10. Parecer final da entrega

A causa do `NOT_FOUND` foi confirmada e a correção mínima já presente em `app.ts` é eficaz: com o build atual e o bootstrap real, os endpoints do catálogo respondem 200, respeitam o contrato JSON, paginam por cursor, aplicam filtros, calculam preços corretamente e retornam 404 padronizado para produto inexistente. A proteção dos 24 produtos internos está preservada.

Entretanto, a API expõe apenas **3 produtos e 2 categorias** porque 10 categorias estão sem `publicKey`, deixando 141 produtos inelegíveis. Isso é uma pendência de dados/reconciliação, não de registro de rota, e não foi corrigido para respeitar a restrição de não alterar o PostgreSQL. Também permanecem a falha de URL malformada no catálogo (500 em vez de 400), o typecheck geral, as rotas de autenticação/pedidos não montadas e a integração incompleta do frontend.

**Não iniciar a próxima fase automaticamente.**
