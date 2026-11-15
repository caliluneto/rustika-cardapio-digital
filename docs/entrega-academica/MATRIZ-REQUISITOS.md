# Matriz de requisitos — RÚSTIKA

Auditoria de conformidade com a rubrica da **UNAERP — Prática Extensionista VII (Cardápio Digital)**.
Última verificação técnica: **15/11/2026**, no snapshot de publicação, com as correções locais desta rodada.
Pesos oficiais adotados: **RF001 10% · RF002 10% · RF003 10% · RF004 15% · RF005 10% · RF006 10% · RF007 15% · RF008 10% · RF009 10%**.

Legenda de status: ✅ conforme · 🟡 parcial · ❌ ausente. Níveis: Insatisfatório · Satisfatório · Excelente.

## Matriz de conformidade

| Requisito (peso) | Exigência oficial | Implementação | Evidência/teste | Status | Nível | Correções nesta rodada | Pendências |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **RF001 — cardápio dinâmico (10%)** | Catálogo completo por categorias; nome, descrição resumida, preço e imagem para cada produto; navegação sem reload; dados carregados pela API. | `backend/src/routes/catalog.routes.ts`, `catalog.service.ts`, `frontend/src/components/Catalog.tsx`, `ProductCard.tsx`, `services/api.ts` (paginação até `nextCursor`). | Consulta `SELECT` em transação `READ ONLY` no Dev em 15/11/2026: **144 produtos reais públicos**; 144 com nome e preço, **0 com descrição e 0 com imagem**. Testes `catalog-api`, `catalog-state`, `catalog-image-url`; troca de categoria é estado React, sem reload. | 🟡 Parcial | Insatisfatório | Nenhum produto foi alterado; as contagens reais foram atualizadas e a lacuna de conteúdo foi explicitada. | A API e a navegação funcionam, mas a exigência de descrição resumida e imagem para cada produto não é atendida pelos dados reais atuais. Complementar conteúdo exige autorização do estabelecimento. |
| **RF002 — detalhes do produto (10%)** | Nome, descrição, ingredientes, preço e imagem ampliada; adicionar produto diretamente pelo modal. | `frontend/src/components/ProductModal.tsx`, `contexts/CartContext.tsx`, `types/catalog.ts`. | O modal suporta todos os campos e adição ao carrinho, porém a leitura real encontrou **0/144** produtos públicos com descrição, ingredientes ou imagem; logo não há produto real suficiente para demonstrar o requisito completo. | 🟡 Parcial | Insatisfatório | Nenhuma informação comercial foi inventada e nenhum produto foi alterado. | Obter e cadastrar, com autorização, descrição resumida/detalhada, ingredientes, foto e texto alternativo de ao menos um produto real; depois gerar evidência do modal. O produto fictício indisponível não vale como prova real. |
| **RF003 — carrinho (10%)** | Quantidade múltipla; remoção; estado preservado entre categorias; contador e feedback visual. | `frontend/src/contexts/cart.ts`, `CartContext.tsx`, `components/CartDrawer.tsx`. | Ações `ADD_ITEM`, `INCREMENT`, `DECREMENT`, `REMOVE_ITEM` e `CLEAR_CART`; total e contador; limites de 99 unidades; testes `cart`, `catalog-state` e layout. | ✅ Conforme | Satisfatório | Nenhuma. | Demonstrar no vídeo a troca de categoria sem perder itens, o contador e a remoção. |
| **RF004 — envio de pedido (15%)** | Revisão com item, quantidade, preço e total; ajuste/remoção antes do envio; nome e identificação de comanda; `POST` ao backend; persistência e confirmação com número do pedido. | `components/OrderReview.tsx`, `pages/Checkout.tsx`, `services/orderSubmission.ts`, `backend/src/services/order.service.ts`, idempotência e snapshots. | **Pedido #5 real** (comanda `000126`) persistido e confirmado pelo servidor; revisão com itens, quantidades, subtotais e total; testes de checkout, submissão e recuperação; retry idempotente coberto por teste. | ✅ Conforme | Excelente | Nenhuma. | O retry idempotente não foi exercitado ao vivo; registrar como opcional. Gravar a confirmação com número no vídeo. |
| **RF005 — acesso administrativo (10%)** | Login com usuário/e-mail e senha; autenticação real via API; sessão mantida até logout/expiração; proteção contra acesso não autenticado. A rubrica cita JWT/OAuth2/Firebase. | `backend/src/routes/access.routes.ts`, `services/adminAuth.service.ts`, `security/adminSessions.ts`, `frontend/src/pages/Admin*.tsx`. | Sessão opaca de 256 bits, hash SHA-256 no servidor, cookie `HttpOnly` + `SameSite=strict` + `Path=/api/admin`, validade de 1 h, revogação no logout e invalidação por `updatedAt`; testes `access`, `admin-access`, CSRF e 401. | ✅ Conforme com adaptação | Satisfatório | Nenhuma; decisão de manter sessão opaca registrada. | Se a rubrica exigir literalmente JWT/OAuth2/Firebase, registrar a adaptação; a sessão opaca é funcionalmente equivalente e favorece revogação imediata. Sessão é process-local: reiniciar o processo exige novo login. Demonstrar logout e 401 no vídeo. |
| **RF006 — CRUD de produtos (10%)** | Cadastro com nome, descrição, preço, categoria e imagem; edição e exclusão permanente quando permitida; validação de campos obrigatórios; atualização do catálogo; upload de imagem em serviço distribuído para nível Excelente. | `backend/src/services/productCrud.service.ts`, `frontend/src/pages/AdminProducts.tsx`, `services/adminProducts.ts`. | Criar, editar e excluir produto fictício com PostgreSQL real (auditoria anterior); validação de nome/categoria/preço; exclusão bloqueada quando há itens de pedido; 77 testes direcionados; imagem por URL e texto alternativo. | 🟡 Parcial | Satisfatório | Nenhuma alteração de código; auditoria confirmou os campos e a exclusão condicionada. | **Upload de imagem em serviço distribuído não existe** (apenas URL); sem infraestrutura/credenciais não foi implementado. O botão “Atualizar catálogo” recarrega a lista administrativa; o catálogo público reflete a mudança na próxima carga. Confirmar o comportamento no vídeo. |
| **RF007 — gestão de pedidos (15%)** | Número, data/hora, itens, total, status e cliente; filtros por status; atualização automática; notificação visual ou sonora de novos pedidos, sem confundir com o carimbo de polling. | `frontend/src/pages/AdminOrders.tsx`, `services/adminOrders.ts`, `adminOrdersPolling.ts`, `backend/src/services/orderOperations.service.ts`. | Lista com todos os campos; filtro por status; polling de 10 s sem sobreposição; **alerta visual `role="alert"`** com contagem e ação “Ver novos pedidos”; primeira carga silenciosa; cada pedido avisado uma única vez; 21 testes no arquivo `admin-orders.test.mjs`. | ✅ Conforme | Satisfatório | **Implementada notificação visual independente do filtro**, com rastreador próprio (`createNewOrderTracker`), linha de base na primeira carga e sem reinício ao trocar de filtro. | Capturar/gravar um pedido novo real no vídeo; a demonstração exige criar pedido, o que não foi autorizado nesta rodada. |
| **RF008 — acompanhamento (10%)** | `RECEIVED`, `IN_PREPARATION`, `READY`, `DELIVERED`; persistência no servidor; atualização automática no cliente; histórico com data, hora e identificação do administrador responsável. | `backend/src/services/orderOperations.service.ts`, `mappers/order.mapper.ts`, `frontend/src/pages/OrderTracking.tsx`, `AdminOrders.tsx`. | Pedido #5 percorreu a cadeia completa sem F5; `GET /api/orders/:orderId` com polling; histórico persistido com `changedByAdminId`; resposta administrativa expõe `actorName` de `changedByAdmin.name`; teste novo confirma o nome do administrador na resposta. | ✅ Conforme | Excelente | **Cobertura adicionada** para `actorName` na resposta da API e alinhamento do dublê de teste ao administrador autenticado. | As capturas intermediárias não enquadraram o componente; o registro de DOM e os testes comprovam os horários. Reexecutar ao vivo exigiria novo pedido, não autorizado nesta rodada. |
| **RF009 — documentação da API (10%)** | Documentação com Swagger; endpoints, métodos, parâmetros e respostas; exemplos de requisição/resposta e códigos de erro; teste interativo para nível Excelente. | `backend/src/openapi/document.ts`, `backend/src/routes/docs.routes.ts`, `swagger-ui-dist@5.17.14`. | **Swagger UI em `/api/docs`** com OpenAPI 3.1, 18 operações, schemas, parâmetros, respostas de erro e exemplos; `/api/openapi.json` preservado; “Execute” em `GET /categories` retornou 200 no navegador; zero erros de console/CSP. | ✅ Conforme | Excelente | **Substituído o índice HTML por Swagger UI**, com assets locais (sem CDN), CSP restritiva e inicializador próprio; a versão fixada não possui dependências nem scripts de instalação. | Atualizar o vídeo para mostrar o Swagger UI; `rf009-01-docs.png` permanece como registro histórico do índice anterior. |

## Correções realizadas nesta rodada

1. **RF009 — Swagger UI:** `swagger-ui-dist@5.17.14` fixado no backend; `/api/docs` serve a UI, `/api/docs/swagger-ui-*.js|css` servem os assets e `/api/openapi.json` continua sendo a fonte do contrato. CSP sem script inline e sem CDN. A versão foi escolhida porque não traz dependências nem hooks de instalação; `npm ls` confirmou ausência de `@scarf/scarf`.
2. **RF007 — notificação de novos pedidos:** o painel mantém um segundo polling, independente do filtro, que consulta `GET /api/admin/orders?limit=20`, ignora a primeira carga e avisa cada pedido novo uma única vez. O aviso é visual (`role="alert"`) e oferece “Ver novos pedidos”.
3. **RF008 — identidade do administrador:** teste de contrato passou a exigir `actorName` na resposta após cada transição; o dublê de Prisma usa o nome do administrador autenticado.
4. **RF009 — exemplos:** exemplos explícitos de produto, criação de pedido, criação de produto e erro no contrato OpenAPI, sem credenciais ou dados reais.
5. **Evidência:** captura real `rf009-02-swagger-ui.png` gerada por navegador contra a aplicação em execução.

## RF001/RF002 — contagem dos dados reais

Leitura autorizada do banco Dev local, exclusivamente com `SELECT`, dentro de `BEGIN READ ONLY` e encerrada com
`ROLLBACK`. Foram considerados os produtos ativos, de categoria ativa, com identidade pública, excluindo o produto
fictício de teste. O modelo não possui um campo próprio de “descrição detalhada”; portanto esse item é contado como
ausente, sem reinterpretar `description_source` (proveniência) como conteúdo comercial.

| Campo exigido | Presente | Ausente | Observação |
| --- | ---: | ---: | --- |
| Nome | 144 | 0 | Nome comercial presente em todos os produtos públicos. |
| Descrição resumida | 0 | 144 | Campo `description` vazio/nulo em todos. |
| Descrição detalhada | 0 | 144 | Não há campo dedicado nem conteúdo equivalente comprovado. |
| Ingredientes | 0 | 144 | Campo `ingredients` vazio/nulo em todos. |
| Preço | 144 | 0 | Preço persistido em todos. |
| Imagem | 0 | 144 | Campo `image_url` vazio/nulo em todos. |
| Disponibilidade | 144 | 0 | 142 `AVAILABLE`, 2 `UNKNOWN`, 0 `UNAVAILABLE`. |

**Produto real para RF002:** nenhum dos 144 produtos públicos possui simultaneamente descrição, ingredientes e
imagem. Assim, não existe exemplo real suficiente para demonstrar RF002 sem complementar dados comerciais; essa ação
depende de autorização do estabelecimento e não foi executada.

## Verificação técnica desta rodada

| Verificação | Resultado |
| --- | --- |
| Backend `npm run test:ci` | **1.239 aprovados / 9 ignorados**, 71 arquivos (70 aprovados, 1 ignorado), exit 0 |
| Frontend `npm test` | **176/176**, exit 0 |
| Typecheck backend/frontend | Aprovado, exit 0 |
| Build backend/frontend | Aprovado, exit 0 |
| Testes direcionados RF007/RF008/RF009 | `admin-orders.test.mjs` 21/21; `order-admin.test.ts` e `openapi.test.ts` aprovados |
| Swagger UI em navegador real | 18 operações; `GET /categories` executado pela UI com HTTP 200; 0 erros de console/CSP |
| `secrets:audit` | `POLICY_OK`, exit 0, 7 segredos conformes; pasta fora do repositório e do OneDrive |

## Requisitos de entrega (FASE 3)

| Requisito | Situação | Evidência/pendência |
| --- | --- | --- |
| Repositório público com código completo | ❌ Não | Repositório privado; API do GitHub retorna 404 sem autenticação. A publicação depende de decisão humana e não foi feita. |
| Execução reproduzível em ambiente limpo | 🟡 Parcial | `README.md`, `GUIA-EXECUCAO.md`, scripts e `.env.example`; não houve execução em máquina limpa nesta rodada. |
| Arquivo com nomes, códigos acadêmicos e URL | ❌ Ausente | O pacote preliminar gerará um registro técnico de URL, branch e SHA, mas nomes e códigos acadêmicos reais continuam pendentes e não foram inventados. |
| Vídeo MP4 de até 5 minutos (aplicativo e código) | ❌ Ausente | Nenhum MP4 da RÚSTIKA localizado; nenhum vídeo fictício foi criado. |
| Contextualização com pelo menos 1.000 caracteres | ✅ Conforme | Seção 1 do relatório: 2.155 caracteres sem espaços. |
| Termo de consentimento assinado e digitalizado | ❌ Ausente | Minuta existe; assinatura e dados reais pendentes. |
| Foto autorizada do cardápio físico | ❌ Ausente | Campo reservado no relatório; foto não existe no material. |
| Questionário oficial de 8 perguntas respondido e assinado | ❌ Ausente | Minuta existe; respostas e assinatura pendentes. |
| Endereço do vídeo | ❌ Ausente | Link não informado; não foi inventado. |
| Relatório no formato da UNAERP | 🟡 Parcial | Estrutura e cabeçalho UNAERP presentes; identificação, docente e formato final de exportação pendentes. |
| Entrega individual de cada integrante | ❌ Pendente de definição | Depende da instrução da disciplina e dos nomes/códigos reais. |

## Pendências priorizadas

1. **Entrega humana:** nomes, códigos, docente, termo, questionário, foto autorizada, vídeo e decisão sobre acesso ao repositório privado.
2. **RF001/RF002:** obter autorização e conteúdo do estabelecimento para descrições, ingredientes e imagens; hoje os 144 produtos públicos não possuem esses campos.
3. **RF006:** definir se o nível Excelente exige upload distribuído; se sim, contratar/implementar serviço com credenciais e política de retenção.
4. **RF005:** decidir se a sessão opaca é aceita como equivalente ou se a rubrica exige JWT/OAuth2/Firebase literalmente.
5. **Vídeo:** regravar mostrando o novo Swagger UI, a notificação de novo pedido e o modal de produto real.

## Evidências visuais

- `docs/entrega-academica/evidencias/rf007-01-filtro-entregue.png` — filtro por `ENTREGUE` e lista de pedidos; não comprova, sozinha, a notificação de novo pedido.
- `docs/entrega-academica/evidencias/rf008-01-tracking-final.png` — acompanhamento do #5 com histórico completo.
- `docs/entrega-academica/evidencias/rf008-02-admin-delivered.png` — painel administrativo com o #5 entregue.
- `docs/entrega-academica/evidencias/rf009-01-docs.png` — registro histórico do índice próprio anterior.
- `docs/entrega-academica/evidencias/rf009-02-swagger-ui.png` — **Swagger UI real** servido em `/api/docs` (captura desta rodada).
- `docs/entrega-academica/evidencias/README-RF008.md` — horários e limitação de enquadramento.

## Preservação

Nenhum banco, migration, SQL de escrita, ação Neon, credencial, pedido histórico ou disponibilidade de produto foi alterado nesta rodada. A única conexão ao Dev usada nesta auditoria executou `SELECT` em transação `READ ONLY`, seguida de `ROLLBACK`. Os pedidos #1–#5 e o produto `TESTE_RF004_PEDIDO` (`UNAVAILABLE`) permanecem como estavam. Não houve commit, push ou publicação pública até este registro.
