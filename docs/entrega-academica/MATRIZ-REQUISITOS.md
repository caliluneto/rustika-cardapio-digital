# Matriz de requisitos — RÚSTIKA

Validação funcional local concluída em **14/11/2026**, no ambiente Dev (`cardapio_digital_dev`, PostgreSQL 18.6,
**9/9 migrations aplicadas**). A rodada final do RF008 foi executada no snapshot de publicação, com o pedido **#5**
na comanda `000126`. O peso de cada requisito continua **PENDENTE**: copiar da rubrica oficial, sem estimativa.

Legenda: ✅ validado · 🟡 parcial (parte real comprovada, parte pendente) · ⏳ pendente.

| Requisito | Peso | Evidência técnica | Status real | Testes/evidências | Pendência |
| --- | --- | --- | --- | --- | --- |
| RF001 — cardápio dinâmico | PENDENTE: rubrica | `catalog.routes.ts`, `catalog.service.ts`, `Catalog.tsx` | ✅ Catálogo real carregado pela API, com paginação e categorias; 168 produtos reais ativos e o fictício excluído por indisponibilidade | `catalog-api`, `catalog-state`, `catalog-image-url`; `GET /api/products` 200, primeira página com 30 itens e `nextCursor` | Nenhuma; demonstrar a navegação no vídeo |
| RF002 — detalhes do produto | PENDENTE: rubrica | modal do catálogo, imagem, descrição, ingredientes e inclusão no carrinho | ✅ Modal do produto fictício aberto e usado na jornada real do pedido #5; título, descrição e ingredientes conferidos no modal; preço e total conferidos no carrinho e na revisão | Testes de estado/layout do catálogo; produto com `imageUrl` e `imageAlt` configurados | Não há captura dedicada do modal; o produto está `UNAVAILABLE` desde o encerramento |
| RF003 — carrinho | PENDENTE: rubrica | `CartContext.tsx`, `CartDrawer.tsx` | ✅ Item fictício adicionado, quantidade e total R$ 1,00 revisados antes do envio | Testes de adicionar, remover, quantidade, total e limites | Nenhuma; estado em memória é decisão documentada |
| RF004 — envio de pedido | PENDENTE: rubrica | `Checkout.tsx`, `order.service.ts`, idempotência e snapshots | ✅ **Pedido #5 real**: convite da comanda `000126` resgatado, sessão ativa, total R$ 1,00 confirmado pelo servidor, item e snapshots persistidos | Testes de pedidos, checkout, recuperação e submissão; histórico do #5 no banco | Idempotência/retry não exercitada ao vivo (opcional) |
| RF005 — acesso administrativo | PENDENTE: rubrica | login/sessão/logout com cookie HttpOnly; rotas protegidas | ✅ Login e rotas protegidas usados na emissão do convite, nas transições e na mudança de disponibilidade | Testes `access`, `admin-access`, CSRF e rate limit | Logout e negativos 401/429 no navegador, se a rubrica exigir |
| RF006 — CRUD de produtos | PENDENTE: rubrica | `productCrud.service.ts`, rotas e `AdminProducts.tsx` | ✅ **Criar, editar e excluir** produto fictício `test` com PostgreSQL real; persistência confirmada nas três etapas | 77 testes direcionados (`product-crud`, `product-admin`); `db:validate` e typecheck aprovados | **Nenhuma** |
| RF007 — gestão de pedidos | PENDENTE: rubrica | todos os estados, filtro, itens, histórico, paginação, polling e carimbo de atualização | ✅ Lista atualizada sozinha (pedido #5 apareceu sem refresh), filtro por `ENTREGUE` aplicado com captura, itens e histórico visíveis | `order-admin.test.ts`, `admin-orders.test.mjs`; `rf007-01-filtro-entregue.png`; carimbo “Atualizado às 20:43:43” | O painel não tem alerta destacado de “novo pedido”; tem polling de 10 s e carimbo. Se a rubrica exigir toast, registrar adaptação |
| RF008 — acompanhamento | PENDENTE: rubrica | `GET /api/orders/:orderId`, `OrderTracking.tsx`, cookie de comanda | ✅ **Pedido #5** percorreu `RECEIVED → IN_PREPARATION → READY → DELIVERED` na janela do cliente, sem F5 e com a URL fixa em `http://localhost:5173/` | `README-RF008.md`, `rf008-01-tracking-final.png`, `rf008-02-admin-delivered.png`; testes de isolamento 401/404, histórico e polling | Capturas intermediárias não enquadraram o componente; o registro de DOM comprova os horários. Reexecutar exige novo pedido, não autorizado nesta etapa |
| RF009 — OpenAPI | PENDENTE: rubrica | `/api/openapi.json` e `/api/docs`, somente fora de produção | ✅ `GET /api/openapi.json` 200 (OpenAPI 3.1) e `GET /api/docs` 200 com índice de operações | 4 testes de operações, refs, cookies, segredos e CSP; `rf009-01-docs.png` | `/api/docs` é um índice HTML próprio, **não o Swagger UI clássico**; se a rubrica exigir Swagger UI, registrar adaptação |

## Evidência consolidada

- **Banco Dev**: 9/9 migrations aplicadas; PostgreSQL 18.6; role de runtime `cardapio_dev_app`.
- **Pedidos preservados**: #1 `CANCELLED`; #2 `DELIVERED` (comanda `000123`); #3 `DELIVERED` (comanda `000124`);
  #4 `DELIVERED` (comanda `000125`); #5 `DELIVERED` (comanda `000126`, cliente `Cliente RF008`).
- **Pedido #5**: `TESTE_RF004_PEDIDO` ×1, total `1.00`, criado em `2026-11-14T23:38:03.427Z`; transições em
  `23:38:54.243Z`, `23:38:59.398Z` e `23:39:04.491Z`; histórico com quatro entradas.
- **Comanda `000126`**: `OPEN`, criada em `23:37:19.842Z`; um convite consumido e uma sessão ativa até
  `2026-11-15T07:37:21.012Z`.
- **Produto fictício**: `TESTE_RF004_PEDIDO` marcado `UNAVAILABLE` pelo painel; permanece com nome, preço R$ 1,00,
  categoria DRINKS, `sourceCode`/`publicKey` e vínculo com pedidos. O catálogo público não o exibe; o detalhe retorna
  `isAvailable: false`.
- **Produtos**: 169 registros no banco (168 reais + 1 fictício); nenhum produto real alterado. O catálogo público é
  paginado e a primeira página traz 30 itens.
- **Backup pré-RF006**: `cardapio_digital_dev_pre-rf006_20261114-021344Z.dump`, 47.535 bytes, SHA-256
  `12b97471552173e3bd6291585dd93d497393c700e63c2ef5222cb4ef75c8ee96`; TOC com 7.220 bytes. Checksum e TOC
  verificados; **restauração integral não comprovada**.
- **Automatizados**: backend **1.237 aprovados / 9 ignorados** (70 arquivos aprovados, 1 ignorado, exit 0); frontend
  **174/174**; typecheck e build aprovados em backend e frontend. Em 14/11/2026 foram executados 77 testes
  direcionados de RF006.
- **Segurança**: `secrets:audit` = `POLICY_OK`, exit 0, 7 segredos conformes, fora do repositório e do OneDrive.
  Nenhuma credencial real em arquivo rastreado ou no histórico de `main`.
- **Não executados nesta etapa**: migrations, acesso ao Neon, deploy público ou gravação de novo pedido para o vídeo.

## Evidências visuais

- `docs/entrega-academica/evidencias/rf007-01-filtro-entregue.png` — filtro por `ENTREGUE` e lista de pedidos.
- `docs/entrega-academica/evidencias/rf008-01-tracking-final.png` — acompanhamento do #5 com histórico completo.
- `docs/entrega-academica/evidencias/rf008-02-admin-delivered.png` — painel administrativo com o #5 entregue.
- `docs/entrega-academica/evidencias/rf009-01-docs.png` — índice de documentação `/api/docs`.
- `docs/entrega-academica/evidencias/README-RF008.md` — registro dos horários e da limitação de enquadramento.
