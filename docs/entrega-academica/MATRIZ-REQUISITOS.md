# Matriz de requisitos — RÚSTIKA

Validação funcional local concluída em **14/11/2026**, no ambiente Dev (`cardapio_digital_dev`, PostgreSQL 18.6,
**9/9 migrations aplicadas**). O peso de cada requisito continua **PENDENTE**: copiar da rubrica oficial, sem estimativa.

Legenda: ✅ validado · 🟡 parcial (parte real comprovada, parte pendente) · ⏳ pendente.

| Requisito | Peso | Evidência técnica | Status real | Testes/evidências | Pendência |
| --- | --- | --- | --- | --- | --- |
| RF001 — cardápio dinâmico | PENDENTE: rubrica | `catalog.routes.ts`, `catalog.service.ts`, `Catalog.tsx` | ✅ Catálogo real carregado no navegador e consumido pela API | `catalog-api`, `catalog-state`, `catalog-image-url`; catálogo com 168 produtos reais + fictício | Validação visual final no ambiente de apresentação |
| RF002 — detalhes do produto | PENDENTE: rubrica | modal do catálogo, ingredientes, imagem e inclusão no carrinho | 🟡 Produto fictício exibido e adicionado pela UI; modal não conferido nesta rodada | testes de estado/layout do catálogo | Conferir modal e fotos reais antes do vídeo |
| RF003 — carrinho | PENDENTE: rubrica | `CartContext.tsx`, `CartDrawer.tsx` | ✅ Item fictício adicionado, quantidade e total R$ 1,00 revisados | testes de adicionar, remover, quantidade, total e limites | Nenhuma; estado em memória é decisão documentada |
| RF004 — envio de pedido | PENDENTE: rubrica | `Checkout.tsx`, `order.service.ts`, idempotência e snapshots | ✅ **Pedido #2 real**: comanda `000123`, total R$ 1,00 confirmado pelo servidor, item e snapshots persistidos | testes de pedidos, checkout, recuperação e submissão; evidência em `RELATORIO-FINAL.md` | Idempotência/retry não exercitada ao vivo (opcional) |
| RF005 — acesso administrativo | PENDENTE: rubrica | login/sessão/logout com cookie HttpOnly; rotas protegidas | ✅ Login e rotas protegidas usados em todas as escritas reais (CRUD e status) | testes `access`, `admin-access`, CSRF e rate limit | Logout e negativos 401/429 no navegador, se a rubrica exigir |
| RF006 — CRUD de produtos | PENDENTE: rubrica | `productCrud.service.ts`, rotas e `AdminProducts.tsx` | ✅ **Criar, editar e excluir** produto fictício `test` com PostgreSQL real; persistência confirmada nas três etapas | 77 testes direcionados (`product-crud`, `product-admin`); `db:validate` e typecheck aprovados | **Nenhuma** |
| RF007 — gestão de pedidos | PENDENTE: rubrica | todos os estados, filtro, itens, histórico, paginação, polling e aviso | 🟡 Gestão real: pedido #2 percorreu `RECEIVED → IN_PREPARATION → READY → DELIVERED` com histórico atômico | `order-admin.test.ts`, `admin-orders.test.mjs`; 4 entradas de histórico no banco | Filtro por status e aviso de novo pedido precisam de evidência visual |
| RF008 — acompanhamento | PENDENTE: rubrica | `GET /api/orders/:orderId`, `OrderTracking.tsx`, cookie de comanda | 🟡 Sequência de 4 estados confirmada no banco; atualização automática no navegador ainda não confirmada pelo usuário | testes de isolamento 401/404, histórico e polling | Confirmar observação sem recarregar a página e demonstrar em duas telas no vídeo |
| RF009 — OpenAPI | PENDENTE: rubrica | `/api/openapi.json` e `/api/docs`, somente fora de produção | ✅ `GET /api/openapi.json` 200 (25.920 bytes) e `GET /api/docs` 200 | 4 testes de operações, refs, cookies, segredos e CSP | Abrir o visualizador durante a gravação |

## Evidência consolidada

- **Banco Dev**: 9/9 migrations aplicadas; PostgreSQL 18.6; role de runtime `cardapio_dev_app`.
- **Pedido #2** (`DELIVERED`): comanda `000123`, cliente `Cliente RF004`, item `TESTE_RF004_PEDIDO` ×1, total `1.00`,
  4 entradas de histórico.
- **Pedido #1** (`CANCELLED`): cancelado acidentalmente durante a validação; estado e histórico preservados, sem
  restauração. Incidente registrado em `backend/docs/incidente-pedido-1-dev.md`.
- **Produtos**: 169 no total (168 reais + 1 fictício); nenhum produto real alterado. `TESTE_RF004_PEDIDO` está
  `UNAVAILABLE` e possui 1 item de pedido vinculado (exclusão bloqueada por FK `RESTRICT`).
- **Backup pré-RF006**: `cardapio_digital_dev_pre-rf006_20261114-021344Z.dump`, 47.535 bytes, SHA-256
  `12b97471552173e3bd6291585dd93d497393c700e63c2ef5222cb4ef75c8ee96`; TOC com 7.220 bytes. Checksum e TOC
  verificados; **restauração integral não comprovada**.
- **Automatizados**: backend 1.241 testes aprovados e 9 ignorados; frontend 174 aprovados; typechecks e builds
  aprovados na validação local mais recente. Em 14/11/2026 foram executados 77 testes direcionados de RF006.
- **Segurança**: `secrets:audit` permanece com `FAIL` (senhas locais fracas/reutilizadas); rotação pendente e
  obrigatória antes de publicação. Nenhuma credencial real em arquivo rastreado ou no histórico de `main`.
- **Não executados nesta etapa**: migrations, novas escritas de teste, commit, push ou deploy.
