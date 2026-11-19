# OpenAPI local (RF009)

O contrato OpenAPI 3.1 é mantido em `src/openapi/document.ts` e descreve somente rotas implementadas.
Em ambiente diferente de `production`:

- `GET /api/openapi.json` entrega o documento JSON com `Cache-Control: no-store`;
- `GET /api/docs` entrega um visualizador autônomo, sem CDN, serviço externo ou envio de dados.

Em produção essas duas rotas não são montadas. O visualizador é somente de referência e não executa chamadas
administrativas. O documento registra cookies HttpOnly, cabeçalho anti-CSRF, idempotência, schemas e erros, mas não
contém valores de tokens, senhas, hashes ou connection strings.

Validação: `tests/openapi.test.ts` e `tests/services/product-crud-unit.test.ts` conferem todas as operações (incluindo
`/health`, `/ready`, `AdminProductList` em `GET /admin/products` e o envelope `{ product }` em
`PATCH /admin/products/{productId}/availability`), referências internas, nomes reais dos cookies, ausência de
segredos e os cabeçalhos do visualizador.
