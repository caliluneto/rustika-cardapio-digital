# Gestão administrativa da disponibilidade de produtos

Escopo: o estabelecimento decide, produto a produto, se um item pode ser pedido. **Estado:** implementado, testado e
validado no PostgreSQL Dev em 14/11/2026 (9/9 migrations), inclusive a mudança real do produto
`TESTE_RF004_PEDIDO` para `UNAVAILABLE`. Os testes de integração e a jornada E2E são opt-in no CI; nada aqui afirma
prontidão para produção.

## Política (fonte única: `Product.availabilityState`)

| Estado | Catálogo público (`isAvailable`) | Pedido |
| --- | --- | --- |
| `AVAILABLE` | `true` | aceito, se todas as demais regras passarem |
| `UNAVAILABLE` | `false` (marcado, não adicionável) | recusado: `409 PRODUCT_UNAVAILABLE` |
| `UNKNOWN` | `null` ("Disponibilidade não confirmada") | recusado: `409 PRODUCT_UNAVAILABLE` |

- `availabilityState` é a única fonte de verdade; o catálogo público e a criação de pedido já a usavam. A coluna legada
  `products.is_available` **não é lida nem escrita** por esta operação e **não recebe privilégio**.
- Sem enum novo, sem campo novo, sem migração de dados. **Nada** converte `UNKNOWN` em `AVAILABLE` automaticamente e
  **não** há atualização em massa dos 174 produtos ativos: só o operador, produto a produto, com confirmação.
- Disponibilidade **não** concede vendabilidade. Só é gerenciável o que o catálogo público pode publicar
  (`publicProductWhere`, mesmo predicado de `catalog.service.ts`): produto ativo, `publicKey`, `sourceCode`,
  `sourceName`, `sourceGroup` e categoria ativa com `publicKey`. Produto inativo, insumo interno (sem `publicKey`) ou de
  categoria não pública: `422 PRODUCT_NOT_MANAGEABLE` e nada é gravado. Preço, categoria, chaves, `isActive`, estoque,
  importação, pedidos antigos e snapshots de preço nunca são tocados.
- Transições: de qualquer estado para `AVAILABLE` ou `UNAVAILABLE`, desde que diferente do atual. `UNKNOWN` nunca é alvo
  (só a importação o produz). Não há histórico de pedidos para disponibilidade.

## `GET /api/admin/products`

Sessão administrativa; sem parâmetros (o roteador administrativo recusa query string → `400`). Devolve **todos** os
produtos gerenciáveis (no máximo **500**, `truncated` quando há mais), ordenados por categoria (`displayOrder`,
`publicKey`) e `publicKey`. Busca (nome/código, sem acento), filtro por categoria e por disponibilidade são aplicados
no **cliente**. Campos: `id` (chave pública), `sourceCode`, `name`, `categoryId`, `categoryName`, `priceInCents`,
`availabilityState`, `updatedAt`. Sem descrição, imagem, estoque nem `isAvailable`. `Cache-Control: no-store`; 120 req/min.

## `PATCH /api/admin/products/:productId/availability`

Corpo estrito `{ "expectedState": "UNKNOWN|AVAILABLE|UNAVAILABLE", "toState": "AVAILABLE|UNAVAILABLE" }` (campo extra →
`400`). Mesma proteção de escrita das demais rotas (Origin exato, `X-Rustika-Request: 1`, JSON), 60 req/min. A
autenticação vem antes da validação de entrada.

| Resultado | Código |
| --- | --- |
| sem/expirada sessão | `401` |
| id (`rustika-<código>`) ou corpo inválidos | `400 INVALID_PRODUCT_ID` / `INVALID_AVAILABILITY` / `INVALID_INPUT` |
| produto inexistente | `404 PRODUCT_NOT_FOUND` |
| não gerenciável | `422 PRODUCT_NOT_MANAGEABLE` |
| `expectedState` diverge do atual | `409 AVAILABILITY_CONFLICT` |
| alvo `UNKNOWN` ou igual ao atual | `422 INVALID_TRANSITION` |
| conflito de serialização persistente | `409 PRODUCT_CONFLICT` |
| falha interna | `500 INTERNAL_ERROR` (genérico) |

Implementação (`productAvailability.service.ts`): transação **Serializable**, reautenticação dentro da transação, leitura,
validações, **compare-and-set** (`updateMany where publicKey + availabilityState = expectedState`, uma coluna escrita),
releitura; `P2034` repetido até 2 vezes, depois `409`. `updatedAt` (gerenciado pelo Prisma) serve de carimbo.
Duas requisições do mesmo estado: exatamente uma vence.

## Pedido, concorrência e catálogo

O pedido continua validando `AVAILABLE` **dentro da sua transação Serializable** (`order.service.ts`; inalterado). Uma
indisponibilização confirmada antes do commit do pedido faz o pedido falhar (`409 PRODUCT_UNAVAILABLE`, sem pedido
parcial) ou ser retentado e falhar; uma indisponibilização concorrente que perca a corrida simplesmente é posterior ao
pedido. O frontend público não limpa o carrinho: a limpeza só ocorre após pedido confirmado, e `PRODUCT_UNAVAILABLE`
mostra "Algum item não está mais disponível. Revise o carrinho.". Produto `false` não entra no carrinho; `null` (não
confirmado) é rotulado e o servidor decide.

## Migration `20261106000000_product_availability_update_privilege` (aplicada no Dev; pendente no Test local)

`GRANT UPDATE (availability_state, updated_at) ON public.products TO <role de runtime>`, nada mais: sem `UPDATE` de
tabela, sem `DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER`, sem `GRANT OPTION`, sem outra coluna (preço, `is_active`,
`category_id`, chaves, `is_available`…) nem tabela. Guardas: banco (`cardapio_digital_test|dev`), identidade
`cardapio_migrator`, PG ≥ 17, atributos/membros das roles, colunas existentes, e estado anterior exato (a única ACL de coluna
em `public` é a da migration 6). A pós-condição, na mesma transação, aborta qualquer desvio. Checksum fixado em
`EXPECTED_MIGRATIONS` (8 entradas); `PERMISSIONS_SQL` tolera somente essas duas ACLs de coluna. Aplicação:
exclusivamente pelo wrapper autorizado; aplicada no Dev e pendente no Test local.

## Testes

- Backend (`tests/product-admin.test.ts`, 30): lista, auth, validação, transições, não gerenciáveis, concorrência, falhas.
- Frontend (`tests/admin-products.test.mjs`, 19): cliente HTTP, filtros, confirmação, erros, layout, regressão do cliente.
- Preflight/migration/CI: `integration-db-support`, `order-status-privilege-migration`, `least-privilege-migration`, `ci-config`.
- PostgreSQL real, **só no CI**: `tests/integration-db/product-availability.integration.ts`.
- Playwright opt-in (`run_product_availability`): jornada em `frontend/tests/e2e.spec.ts`, verificada por `verifyAvailability`.
