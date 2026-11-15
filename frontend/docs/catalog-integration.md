# Catálogo conectado — Entrega 1B

> **Documento histórico da Entrega 1B.** O envio de pedidos e o painel administrativo foram implementados nas
> entregas seguintes; para o estado atual, consulte `backend/docs/orders-api.md` e o `README.md` da raiz.

O frontend consome o contrato de `backend/docs/catalog-api.md` e mantém os
componentes visuais e o carrinho existentes. Não envia pedidos nesta entrega.

## Seleção explícita da fonte

No arquivo local `frontend/.env`, configure **uma** fonte:

```dotenv
# API: padrão também quando VITE_CATALOG_MODE não está definido
VITE_CATALOG_MODE=api
VITE_API_URL=http://localhost:4000/api
```

```dotenv
# Demonstração: usa exclusivamente os 138 produtos e dez categorias locais
VITE_CATALOG_MODE=demo
```

Reinicie o Vite após alterar a configuração. Em produção, gere um novo build:
variáveis `VITE_*` são incorporadas ao bundle e não devem conter segredos.
Valores diferentes de `api`/`demo`, inclusive vazio, geram erro visível de
configuração. Nenhum arquivo `.env` pessoal foi alterado nesta entrega.

O modo demo importa o catálogo local sob demanda e não faz chamadas HTTP de
catálogo ou health. O modo API nunca usa o mock como recuperação de erro.
Uma carga com falha não mistura nem exibe páginas parciais.

## Serviços e paginação

- `services/api.ts`: cliente HTTP injetável para testes; valida envelope
  `{ success, data }`, trata erros de rede/HTTP e limita cada requisição a 15 s.
- `getCategories()` e `getAllProducts()` são iniciados em paralelo. Cada página
  de produtos usa `limit=50`; a próxima usa o `nextCursor` anterior até receber
  `null`. Assim, 138 itens exigem três requisições de produtos e uma de categorias.
- Filtros opcionais `categoryId` e `availability` do serviço são preservados em
  todas as páginas. Na tela, as categorias filtram o catálogo já completo em
  memória: navegar, abrir detalhes ou usar o carrinho não repete consultas.
- `getProduct(id)` também está disponível para `/products/:productId`. O modal
  reutiliza o DTO completo da listagem, evitando uma chamada redundante.
- Cursor sem avanço, IDs duplicados, envelope incorreto ou produto sem categoria
  correspondente geram erro visível; uma nova tentativa reinicia a carga inteira.
- `catalogStore.ts` compartilha a carga em andamento, inclusive na repetição dos
  efeitos do React StrictMode. O resultado é mantido durante a vida da página.
  Não há polling, atualização automática de preços nem cache persistente.
- Uma desmontagem não inicia outra carga nem cancela a carga compartilhada;
  assinaturas são removidas e novas montagens reutilizam o resultado. Cada
  requisição continua sujeita ao timeout. Uma carga malsucedida exige tentativa
  explícita, sem loop automático.

## Adaptação e interface

- Identificadores e códigos são preservados como texto, inclusive zeros iniciais.
- `priceInCents` deve ser inteiro seguro não negativo. O adaptador não multiplica,
  arredonda nem reconverte valores monetários.
- `isAvailable` mantém `true`, `false` ou `null`. A ausência no mock antigo e
  `null` da API significam disponibilidade não confirmada. Produtos indisponíveis
  não entram no carrinho; os desconhecidos podem compor a seleção local, sem
  confirmar estoque ou autorizar envio.
- Descrição, ingredientes, origem e imagens cadastrados são preservados.
  Imagens relativas são resolvidas contra a URL da API. URLs HTTP(S) sem
  credenciais são aceitas; esquemas inadequados são omitidos.
- Sem foto, com URL rejeitada ou falha de imagem, o cartão/modal usa apresentação
  textual. Sem `imageAlt`, utiliza o nome do produto como texto alternativo.
- `CatalogStatus` exibe carregamento, falha com tentativa manual e catálogo vazio.
  O `CartProvider` permanece montado independentemente do estado do catálogo.
- A verificação de health foi preservada como ação manual no modo API. Não é
  pré-condição para carregar catálogo nem prova de acesso ao PostgreSQL.
- Revisão, comanda local e cálculos anteriores foram preservados. Seus avisos de
  ausência de envio continuam válidos: esta entrega não persiste pedidos.

## Verificações locais

Na pasta `frontend`:

```powershell
npm test
npm run typecheck
npm run build
```

Os testes usam `node:test`, o compilador TypeScript já instalado, `Response`
simulado e renderização React para HTML. O loader em `tests/` resolve TS/TSX
somente no processo de teste; não altera a aplicação nem instala dependências.

Cobertura: adaptador, três estados de disponibilidade, todas as páginas de 138
produtos, filtros, detalhes, erros HTTP/rede, timeout, paginação inconsistente,
modo demo/API, carga compartilhada, tentativa manual, markup dos componentes,
cálculos e revisão do carrinho. A renderização estática não comprova interação
em navegador real nem leitura do PostgreSQL.

## Dependências externas ainda não verificadas

O modo API requer backend acessível, CORS adequado, banco com schema compatível,
permissões de leitura e catálogo público cadastrado. Nenhum banco foi acessado,
nenhuma migration executada e nenhuma integração real com PostgreSQL foi
declarada. Fotos dependem de URLs acessíveis informadas pelo cadastro.
