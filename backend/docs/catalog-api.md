# API pública de catálogo — Entrega 1A

Endpoints de leitura implementados com Express e Prisma Client 6.19.3. O frontend
ainda usa o catálogo local; esta entrega não altera telas nem envia pedidos.

## Publicação e ordenação

- Categorias: somente `isActive=true` com `publicKey` cadastrada. Ordenação por
  `displayOrder`, depois `publicKey`.
- Produtos: somente ativos, com `publicKey`, `sourceCode`, `sourceName` e
  `sourceGroup` cadastrados, vinculados a categoria ativa com chave pública.
  A identidade de origem precisa ser consistente com `rustika-<sourceCode>`.
  Esses campos representam a reconciliação/publicação no catálogo; a API não
  transforma automaticamente registros legados em produtos públicos.
- Produtos indisponíveis continuam visíveis, identificados como indisponíveis.
  Disponibilidade desconhecida também é exibida, sem afirmar que há estoque.
- Ordenação dos produtos: ordem da categoria, chave pública da categoria e chave
  pública do produto, todas crescentes. Códigos são texto, não números.
- IDs retornados são chaves públicas; UUIDs internos não fazem parte do contrato.

## GET /api/categories

Sem parâmetros de consulta. Retorna `200`:

```json
{
  "success": true,
  "data": [
    { "id": "drinks", "name": "Drinks", "description": "", "displayOrder": 3 }
  ]
}
```

Descrição ausente da categoria vira string vazia, conforme o modelo visual atual.
Nenhuma categoria pública resulta em `data: []`.

## GET /api/products

`/api/products/` também atende à listagem.

| Parâmetro opcional | Valores |
| --- | --- |
| `categoryId` | Slug público de 1–64 caracteres: letras minúsculas ASCII, números e hífens separando segmentos. Ex.: `sem-alcool`. |
| `availability` | `UNKNOWN`, `AVAILABLE` ou `UNAVAILABLE`. Ausente inclui os três estados. |
| `limit` | Inteiro decimal de 1 a 50, sem sinal ou zeros iniciais. Padrão: 30. |
| `cursor` | Chave pública do último produto da página anterior, recebida em `nextCursor`. |

Exemplo: `GET /api/products?categoryId=drinks&availability=AVAILABLE&limit=10`

Resposta `200` (valores ilustrativos, não evidência de estoque):

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "rustika-100",
        "sourceCode": "100",
        "sourceName": "NEGRONI",
        "sourceGroup": "DRINKS",
        "categoryId": "drinks",
        "name": "NEGRONI",
        "description": "Campari / gin / vermute / laranja.",
        "ingredients": "Campari / gin / vermute / laranja.",
        "priceInCents": 3000,
        "isAvailable": true
      }
    ],
    "nextCursor": null
  }
}
```

`nextCursor: null` indica o fim. Quando houver próxima página, reenviar o cursor
com os mesmos filtros. O cursor precisa continuar público e elegível para esses
filtros; caso contrário, a API retorna `400 INVALID_CURSOR` e o cliente deve
reiniciar a listagem. A paginação não é um snapshot: alterações concorrentes no
catálogo podem exigir recarga desde a primeira página.

Categoria válida sem resultados, inclusive inexistente/inativa, retorna
`{ "success": true, "data": { "items": [], "nextCursor": null } }`.

## GET /api/products/:productId

`productId` deve ser `rustika-` seguido de 1–64 dígitos, preservando zeros iniciais.
Não aceita query string. Exemplo: `GET /api/products/rustika-100`.

Retorna `200` com `{ "success": true, "data": <produto> }`, usando exatamente o
mesmo DTO da listagem. Produto inexistente, inativo, sem identidade pública ou
de categoria não pública retorna o mesmo `404 PRODUCT_NOT_FOUND`.

## Conteúdo e compatibilidade

- `priceInCents`: inteiro calculado com `Prisma.Decimal`, sem multiplicação em
  ponto flutuante nem arredondamento silencioso. Preço inválido no armazenamento
  gera erro interno genérico.
- `isAvailable`: `true` para `AVAILABLE`, `false` para `UNAVAILABLE` e `null` para
  `UNKNOWN`. O booleano legado `products.is_available` não decide esse campo.
- `description`, `descriptionSource`, `ingredients`, `imageUrl` e `imageAlt`:
  preservados quando não nulos e omitidos quando ausentes; não são inventados.
- `sourceCode`, `sourceName` e `sourceGroup`: preservados sem normalização.
- O frontend atual pode usar as mesmas chaves e valores em centavos. Na integração,
  deve adaptar `isAvailable: null` para `undefined` (ou ampliar seu tipo), acrescentar
  `ingredients` e consumir `data.items` com paginação. Os componentes atuais exigem
  imagem e texto alternativo para exibir a foto; cadastros sem `imageAlt` precisam
  de complementação de conteúdo.

## Erros

Sempre no formato:

```json
{
  "success": false,
  "error": { "code": "INVALID_INPUT", "message": "Parâmetros de catálogo inválidos." }
}
```

| HTTP | Código | Situação |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | ID, filtro ou limite inválido; parâmetros desconhecidos, repetidos ou estruturados; URL/JSON malformado. |
| 400 | `INVALID_CURSOR` | Cursor inexistente, não público ou incompatível com os filtros. |
| 404 | `PRODUCT_NOT_FOUND` | Detalhe de produto inexistente ou não público. |
| 500 | `INTERNAL_ERROR` | Erro do Prisma, dados inconsistentes ou outra falha interna. |
| 503 | `CATALOG_UNAVAILABLE` | Aplicação criada sem a dependência Prisma. |

Erros inesperados não incluem SQL, URLs de conexão, mensagens do driver ou stacks
na resposta nem no log do middleware HTTP.

## Verificação e limites

Testes HTTP e de serviços usam exclusivamente Prisma simulado; nenhum teste de
catálogo instancia `PrismaClient`, carrega perfis ou conecta ao PostgreSQL.

```powershell
# A partir de backend/
$env:NODE_ENV = 'test'
$env:DB_PROFILE = 'app-test'
npm test
npm run typecheck
npm run build
```

Não foi necessário modificar schema ou migrations. O client instalado estava
desatualizado e foi regenerado localmente com o schema existente, configuração
explícita que desabilita o carregamento automático de .env e URLs fictícias;
geração não aplica migrations nem comprova persistência.

A operação real depende de banco com schema compatível, permissões de leitura e
catálogo reconciliado/cadastrado. Nenhum desses estados foi consultado nesta
entrega. Sua verificação, carga de dados e quaisquer alterações de banco exigem
autorização específica. Não há fallback silencioso para o mock na API.
