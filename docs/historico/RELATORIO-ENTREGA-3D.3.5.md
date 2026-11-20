# Relatório da Entrega 3D.3.5

## Integração do frontend React com a API real do catálogo Rústika

**Data:** 03/11/2026  
**Ambiente:** Windows, Node.js v24.20.0  
**Frontend:** `http://localhost:5173/`  
**API:** `http://localhost:4000/api`  
**Resultado:** integração real validada; **43/43 testes aprovados**; typecheck e build aprovados.

---

## 1. Estado do frontend

- O frontend existente foi preservado, sem reconstrução visual.
- O `App` deixou de importar o catálogo demonstrativo e passou a usar `useCatalog()`.
- O catálogo real é carregado pela API pública; os modos `api` e `demo` continuam disponíveis, sendo `api` o padrão.
- A página abriu em navegador headless e exibiu:
  - **144 cards de produtos**;
  - **12 categorias** (13 botões incluindo “Todos”);
  - tag “**144 itens · 12 categorias**”;
  - preços formatados em reais;
  - fallback textual para produtos sem fotografia;
  - aviso “Disponibilidade não confirmada” nos 2 produtos com `isAvailable: null`.
- Nenhum produto interno foi exibido.

## 2. Estado do backend

O backend foi iniciado pelo comando já existente `node dist/server.js`, na porta 4000, sem duplicação de instância.

| Item | Resultado |
|---|---|
| Processo | `node dist/server.js` |
| Porta | 4000 |
| `GET /api/health` | HTTP 200 |
| `status` | `ok` |
| `service` | `cardapio-digital-api` |
| Perfil | `app-dev` |
| Banco | `cardapio_digital_dev` |
| Role de runtime | `cardapio_dev_app` |

Os processos iniciados para esta validação foram encerrados ao final. Não foi executado `POST`, `PUT`, `PATCH`, `DELETE`, Seed, migration ou alteração de dados/permissões.

## 3. Resultados reais dos métodos HTTP do frontend

Validação executada com o código real de `frontend/src/services/api.ts`, usando `fetch` real e instrumentação somente para registrar URLs/métodos. Nenhum mock foi usado.

| Método | Chamadas reais | Resultado |
|---|---:|---|
| `getCategories()` | 1 | 12 categorias |
| `getAllProducts()` | 3 | 144 produtos em 3 páginas |
| `getCatalog()` | 4 | 12 categorias + 144 produtos |
| `getProduct('rustika-PA062240')` | 1 | produto correto |
| **Total** | **9** | todas `GET` |

- Todas as chamadas foram HTTP `GET`.
- Todas as respostas foram processadas com sucesso.
- Nenhuma chamada de escrita foi realizada.

## 4. Categorias e produtos carregados

| Indicador | Resultado |
|---|---:|
| Categorias | 12 |
| Produtos públicos retornados | 144 |
| IDs de produto únicos | 144 |
| Produtos duplicados | 0 |
| Produtos órfãos (categoria inexistente) | 0 |
| Categorias distintas nos produtos | 12 |
| Produtos com `isAvailable: true` | 142 |
| Produtos com `isAvailable: false` | 0 |
| Produtos com `isAvailable: null` | 2 |
| Produtos com imagem cadastrada | 0 |
| Produtos com ingredientes cadastrados | 0 |
| Produtos com descrição cadastrada | 0 |

A API não possui, neste ambiente, imagens, descrições ou ingredientes preenchidos para os produtos públicos. A interface usa o fallback textual já previsto e não inventa conteúdo.

## 5. Paginação

A paginação real foi confirmada em três páginas de 50 produtos:

```text
50 + 50 + 44 = 144
```

URLs observadas:

```text
GET /api/products?limit=50
GET /api/products?limit=50&cursor=rustika-63
GET /api/products?limit=50&cursor=rustika-110
```

`getCatalog()` também percorreu exatamente as mesmas 3 páginas e combinou categorias e produtos sem duplicação.

## 6. Compatibilidade com PA062240

- Listagem: `rustika-PA062240` presente.
- Detalhe: `GET /api/products/rustika-PA062240` retornou o produto correto.
- Nome: `PANCETA (QUADRADA) SUINA- TORRESMO DE ROLO`.
- Categoria: `rustika-category-insumo`.
- Preço: `priceInCents=5000`.
- Preço exibido no modal e no carrinho: **R$ 50,00**.
- Disponibilidade: `true`.
- O modal abriu, o produto foi adicionado ao carrinho local e o total permaneceu em R$ 50,00.

## 7. Proteção dos 24 produtos internos

- O estado persistido validado na Entrega 3D.3.4 permanece: **168 produtos**, sendo **144 públicos** e **24 internos**.
- A API retornou somente **144 produtos públicos**.
- O filtro `INSUMO` exibiu apenas **2 produtos públicos**; os 24 produtos internos não apareceram.
- Todos os IDs retornados seguem o padrão público `rustika-<sourceCode>`.
- Nenhum produto órfão, UUID interno ou chave interna foi exposto.

## 8. Validação da interface no navegador

Foi usada uma sessão real de Chrome headless, com interação automatizada via DevTools Protocol e captura de tela. Não houve validação manual humana de todos os estados, mas a renderização e as interações abaixo foram executadas no navegador.

| Validação | Resultado |
|---|---|
| Carga inicial | 144 cards, 12 categorias, tag 144/12 |
| Filtro `CERVEJA` | 14 cards, contador “CERVEJA: 14 opções” |
| Filtro `INSUMO` | 2 cards |
| Modal de PA062240 | abriu com nome e preço corretos |
| Adição ao carrinho | aceita; contador “Carrinho 1” |
| Carrinho local | item, unitário e total R$ 50,00; campo de comanda presente |
| Produto com disponibilidade desconhecida | “Disponibilidade não confirmada” |
| Viewport móvel 390 × 844 | `scrollWidth=390`, sem overflow horizontal |
| Erro de API bloqueada | estado de erro exibido |
| Retry após desbloqueio | 144 produtos restaurados |

Capturas geradas durante a validação:

- `C:\Users\u1n3c\AppData\Local\Temp\rustika-3d35-desktop.png`
- `C:\Users\u1n3c\AppData\Local\Temp\rustika-3d35-mobile.png` (captura inicial)
- `C:\Users\u1n3c\AppData\Local\Temp\opencode\rustika-3d35-mobile-cdp.png` (viewport móvel real via DevTools)

### Console e rede

- Requisições de API na carga normal: todas `GET`, sem falhas.
- Console: 2 registros 404 de `/favicon.ico` (o `index.html` não declara favicon). Não houve erro funcional no catálogo.
- As falhas de rede observadas no teste de erro foram bloqueios intencionais de `/api/*` e o reload associado.
- Nenhuma imagem de produto foi renderizada porque a API não retornou `imageUrl`; o fallback textual está funcionando.
- Não foi possível validar ingredientes no navegador porque a API não retornou `ingredients`; o componente e o teste de fixture cobrem esse estado.

## 9. Arquivos efetivamente alterados

### Código do frontend

| Arquivo | Alteração |
|---|---|
| `frontend/src/services/api.ts` | Cliente HTTP real com categorias, paginação, detalhe, catálogo combinado, timeout/abort, validação de envelope e métodos de apoio existentes |
| `frontend/src/services/catalogAdapter.ts` | Suporte a `ingredients`, `isAvailable: boolean \| null`, IDs públicos alfanuméricos e validações |
| `frontend/src/types/catalog.ts` | `CatalogData`, `ingredients` e disponibilidade `boolean \| null` |
| `frontend/src/App.tsx` | Remoção dos mocks; uso de `useCatalog`, estados de loading/erro e aviso de fonte do catálogo |
| `frontend/src/components/ProductCard.tsx` | Fallback de `alt` para o nome e aviso de disponibilidade desconhecida |
| `frontend/src/components/ProductModal.tsx` | Fallback de imagem, ingredientes e aviso de disponibilidade desconhecida |
| `frontend/src/components/Catalog.tsx` | Texto do catálogo sem referência à planilha/mock |
| `frontend/src/components/ConnectionIndicator.tsx` | Modo manual (`autoCheck`) e textos de verificação de conexão |
| `frontend/package.json` | Script `test` usando `node:test`, sem novas dependências |

### Documentação

| Arquivo | Alteração |
|---|---|
| `RELATORIO-ENTREGA-3D.3.5.md` | Este relatório |

`backend/src/app.ts` aparece como modificado no Git, mas a alteração é anterior a esta entrega e não foi tocada. `frontend/src/services/catalogSource.ts`, `catalogStore.ts` e `hooks/useCatalog.ts` foram utilizados, mas não alterados nesta entrega.

## 10. Testes, typecheck e build

| Validação | Comando | Resultado |
|---|---|---|
| Testes do frontend | `npm test` | **43/43 aprovados** |
| Typecheck | `npm run typecheck` | exit 0 |
| Build | `npm run build` | exit 0; Vite gerou os assets |

O script de teste não adiciona Vitest ou outra dependência: usa `node:test` e o loader TypeScript já presente no projeto. Nenhum teste foi alterado nesta entrega.

## 11. Erros encontrados e corrigidos

1. `api.ts` não exportava `api` e não possuía `getCategories`, `getAllProducts`, `getProduct` ou `getCatalog`.
2. `catalogSource.ts` e `catalogStore.ts` não conseguiam importar `CatalogData`.
3. `Product` não aceitava `isAvailable: null` nem `ingredients`.
4. A disponibilidade desconhecida não era exibida em cards/modais.
5. O fallback de texto alternativo da fotografia não usava o nome do produto.
6. O modal não exibia ingredientes.
7. O `App` ainda usava o catálogo demonstrativo.
8. O bloco de conexão não tinha modo manual e usava textos diferentes dos esperados.
9. O merge de cabeçalhos convertia `Idempotency-Key` para minúsculas, quebrando o teste de contrato do fluxo existente.
10. O catálogo continha texto de “planilha”, incompatível com o modo API.

Nenhum desses problemas permanece nos fluxos cobertos pelos testes. O 404 de `/favicon.ico` não foi alterado por ser cosmético e fora do escopo funcional.

## 12. Pendências e limitações

- **Segurança:** `cardapio_dev_app` possui privilégios de `INSERT`, `SELECT`, `UPDATE` e `DELETE` em `categories` e `products`; a pendência permanece registrada e não foi alterada.
- **Favicon:** `/favicon.ico` retorna 404 e gera dois registros no console em duas cargas da página. Não afeta o catálogo.
- **Conteúdo:** a base atual não possui imagens, descrições ou ingredientes públicos; a interface exibe fallback e os testes de componente cobrem os campos quando presentes.
- **Documentação:** `backend/docs/catalog-api.md` ainda descreve o frontend usando catálogo local; atualização documental não foi feita por não ser necessária à integração.
- **Escopo não funcional:** autenticação, comandas e pedidos reais não foram implementados, alterados ou validados, conforme restrição da entrega.
- **Validação visual:** foi feita por Chrome headless com capturas e interações automatizadas; não houve inspeção manual completa em todos os tamanhos de tela.

## 13. Estado do Git

- Nenhum commit, `git reset` ou `git clean` foi executado.
- Arquivos modificados nesta entrega no frontend: os nove listados na seção 9.
- `backend/src/app.ts` continua com modificação anterior, não relacionada a esta entrega.
- Permanecem artefatos não rastreados de entregas anteriores, incluindo relatórios, scripts, fixtures e arquivos de análise; eles não foram apagados nem alterados.
- `RELATORIO-ENTREGA-3D.3.5.md` foi criado e permanece não rastreado.
- Nenhum arquivo `.env` foi lido, criado ou modificado.

## Parecer final

**CONCLUÍDA.** O frontend React está integrado à API real do catálogo, carrega 12 categorias e 144 produtos, pagina corretamente em 50+50+44, preserva a proteção dos 24 produtos internos, reconhece `PA062240` a R$ 50,00 e mantém carrinho, filtros, modais, estados de erro e layout responsivo. As ressalvas registradas são de conteúdo, favicon e segurança de role, sem bloquear a integração desta entrega.
