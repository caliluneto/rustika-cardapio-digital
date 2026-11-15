# Guia de execução local

## Pré-requisitos

- Node.js 20.19 ou superior, npm e PostgreSQL compatível com os perfis documentados.
- Segredos em pasta fora do repositório e do OneDrive. Use `backend/config/database.env.example`; nunca copie senha real
  para `.env`, Git, relatório, captura de tela ou vídeo.
- Banco, roles e migrations previamente provisionados por procedimento autorizado. Este guia não autoriza migrations.

## Instalação

```powershell
cd backend
npm install
cd ..\frontend
npm install
```

## Configuração

No backend, configure apenas valores não secretos em `.env` local e mantenha URLs/senhas no diretório apontado por
`CARDAPIO_SECRETS_DIR`. Para desenvolvimento, `CORS_ORIGIN` deve ser exatamente a origem do frontend. No frontend,
`VITE_API_URL` pode apontar para `http://localhost:4000/api`; `VITE_CATALOG_MODE=api` usa o backend e
`VITE_ORDER_SUBMISSION=enabled` habilita envio real somente em ambiente autorizado.

## Execução

```powershell
# Terminal 1
cd backend
npm run dev

# Terminal 2
cd frontend
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:4000/api`
- OpenAPI em desenvolvimento: `http://localhost:4000/api/docs` (Swagger UI com assets locais)
- Health check: `http://localhost:4000/api/health`

## Validação sem banco

```powershell
cd backend
npm run typecheck
npm run build
npm run test:ci
npm run secrets:audit

cd ..\frontend
npm run typecheck
npm test
npm run build
```

`secrets:audit` deve terminar sem `FAIL` antes de qualquer publicação. Integração e E2E escrevem no PostgreSQL e
só podem ser usados no banco de teste, com os gates e autorizações descritos em `backend/docs/e2e-real.md`.

## RF006: estado em 14/11/2026

O CRUD de produtos foi validado no Dev com PostgreSQL real:

1. Banco confirmado como `cardapio_digital_dev`, PostgreSQL 18.6, **9/9 migrations aplicadas**, incluindo
   `20261110000000_rf006_product_crud_privilege`.
2. Backup pré-RF006 verificado por SHA-256 e TOC, fora do repositório e do OneDrive; restauração integral não
   comprovada.
3. Produto fictício `test` (`publicKey` `rustika-TEST`) criado pelo painel, com persistência conferida no banco.
4. Preço editado de R$ 12,55 para R$ 15,50 e descrição para `Edicao RF006`, com novo `updated_at`.
5. Produto excluído; o banco ficou com 169 produtos (168 reais + `TESTE_RF004_PEDIDO`) e nenhum produto real foi
   alterado.
6. Exclusão de produto referenciado por pedido continua bloqueada por FK `RESTRICT`; `TESTE_RF004_PEDIDO`
   permanece `UNAVAILABLE` com 1 item vinculado.

Para repetir a validação, usar um produto fictício novo e repetir os passos 3–5 pelo painel, sem `db push`, reset
ou SQL avulso.

## Validação final em 14/11/2026

- **Serviços**: `/api/health`, `/api/ready`, `/api/products`, `/api/openapi.json`, `/api/docs` e o frontend
  responderam HTTP 200 no snapshot de publicação.
- **Testes**: backend **1.239 aprovados / 9 ignorados** (70 arquivos aprovados, 1 ignorado, exit 0); frontend
  **176/176**, exit 0. Typecheck e build aprovados em backend e frontend.
- **RF004**: pedido **#5** na comanda `000126`, cliente `Cliente RF008`, `TESTE_RF004_PEDIDO` ×1, total R$ 1,00,
  `DELIVERED`, quatro entradas de histórico. Os pedidos #1–#4 foram preservados.
- **RF007**: a lista administrativa atualizou sozinha, com carimbo de horário; o filtro por `ENTREGUE` foi capturado
  em `evidencias/rf007-01-filtro-entregue.png`. Em 15/11/2026 foi acrescentado alerta visual de novos pedidos,
  independente do filtro.
- **RF008**: as quatro transições foram observadas na janela do cliente, sem F5, com a URL fixa em
  `http://localhost:5173/`. A captura final e o registro de horários estão em
  `evidencias/rf008-01-tracking-final.png` e `evidencias/README-RF008.md`. As capturas intermediárias não
  enquadraram o componente e não são usadas como prova de estado.
- **Produto fictício**: `TESTE_RF004_PEDIDO` está `UNAVAILABLE`; o catálogo público não o exibe e o detalhe retorna
  `isAvailable: false`. Nome, preço, categoria, `sourceCode`/`publicKey` e vínculos foram preservados.
- **Segurança**: `secrets:audit` terminou em `POLICY_OK`, exit 0, 7 segredos conformes, fora do repositório e do
  OneDrive.
- **OpenAPI**: `/api/openapi.json` serve OpenAPI 3.1; `/api/docs` entrega **Swagger UI** com assets locais, sem CDN e
  sob CSP restritiva. As 18 operações foram validadas em navegador real, com “Try it out”/“Execute” e zero erros de CSP.
  Em produção o visualizador continua desmontado, preservando o comportamento anterior.
- **Não executados**: migrations, acesso ao Neon, deploy público e novo pedido para regravar o RF008.

Contrato REST mínimo:

| Operação | Rota | Resultado esperado |
| --- | --- | --- |
| Criar | `POST /api/admin/products` | 201 com `publicKey` `rustika-<sourceCode>` |
| Editar | `PATCH /api/admin/products/:publicKey` | 200 com os campos alterados |
| Excluir sem referências | `DELETE /api/admin/products/:publicKey` | 200 |
| Excluir referenciado | `DELETE /api/admin/products/:publicKey` | 409 `PRODUCT_REFERENCED` |
| Catálogo | `GET /api/products` | produto aparece após `AVAILABLE` |
