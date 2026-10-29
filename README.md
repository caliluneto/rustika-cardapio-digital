# Cardápio Digital

Projeto acadêmico da Prática Extensionista VII da UNAERP.

Aplicação web distribuída com frontend em React + Vite + TypeScript e backend em
Node.js + Express + TypeScript. As entregas concluídas correspondem às **Fases
1A, 1A.1, 1B.1, 1B.2C e 1B.3G**: comunicação frontend/backend, correção de
dependências, preparação do Prisma, configuração segura de conexão com o
PostgreSQL local e preparação controlada da primeira migration.

## Escopo atual

- Frontend com página inicial provisória e indicador de conexão com a API.
- Backend com `GET /api/health`, CORS restrito, rota 404 e tratamento de erros.
- Testes automatizados mínimos do backend.
- Prisma configurado com as seis entidades do domínio e client reutilizável.
- Credenciais de banco fora do OneDrive, com carregamento e validação por perfil.
- Wrapper do Prisma CLI com `validate`, `generate` e, restrito ao perfil
  `migrate-test`, `migrate status` e `migrate deploy`.
- Migration inicial preparada em
  `backend/prisma/migrations/20261023000000_initial_schema`, ainda não aplicada.
- Typecheck e build de ambos os projetos.

Ainda não fazem parte: migrations executadas, aplicação completa de permissões
no PostgreSQL, seeds, autenticação, CRUD de produtos, carrinho, pedidos,
Socket.IO, upload de imagens e hospedagem. A remoção de `TRUNCATE` da default
ACL de teste foi aplicada na Fase 1B.3E.

## Estrutura

```text
Cardapio_Digital/
├── backend/
│   ├── config/
│   │   ├── database-profiles.json
│   │   └── database.env.example
│   ├── docs/sql/
│   │   └── inspect-permissions.sql
│   ├── prisma/schema.prisma
│   ├── scripts/
│   │   ├── prisma-run.ts
│   │   └── validate-databases.ts
│   ├── src/
│   │   ├── config/env.ts
│   │   ├── config/secrets.ts
│   │   ├── lib/prisma.ts
│   │   ├── middleware/errorHandler.ts
│   │   ├── middleware/notFound.ts
│   │   ├── routes/health.routes.ts
│   │   ├── app.ts
│   │   └── server.ts
│   ├── tests/
│   │   ├── config/secrets.test.ts
│   │   └── health.test.ts
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   └── tsconfig.build.json
├── frontend/
│   ├── src/
│   │   ├── services/api.ts
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── index.css
│   │   └── vite-env.d.ts
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── .gitignore
└── README.md
```

## Pré-requisitos

- Node.js 20.19 ou superior (validado com Node.js 24.20.0).
- npm 10 ou superior (validado com npm 12.2.0).

## Instalação

No PowerShell, a partir da raiz do projeto:

```powershell
Set-Location -LiteralPath "C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital"

Set-Location backend
npm install
Copy-Item .env.example .env

Set-Location ..\frontend
npm install
Copy-Item .env.example .env

Set-Location ..
```

Os arquivos `.env` são locais e não devem ser versionados.

## Execução local

Abra dois terminais na raiz do projeto.

Terminal 1 — backend (porta 4000):

```powershell
Set-Location -LiteralPath "C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend"
npm run dev
```

Terminal 2 — frontend (porta 5173):

```powershell
Set-Location -LiteralPath "C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\frontend"
npm run dev
```

Acesse `http://localhost:5173`. A página consulta `GET /api/health` e exibe
**API disponível** ou **API indisponível**.

Para interromper cada servidor, pressione `Ctrl+C` no terminal correspondente.

## Variáveis de ambiente

### Backend (`backend/.env`)

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `NODE_ENV` | `development` | Ambiente de execução |
| `PORT` | `4000` | Porta HTTP da API |
| `CORS_ORIGIN` | `http://localhost:5173` | Origem exata autorizada no CORS |
| `DB_PROFILE` | `app-dev` em desenvolvimento; `app-test` em testes | Com `NODE_ENV=test`, apenas `app-test` é aceito; valor vazio explícito é rejeitado |
| `CARDAPIO_SECRETS_DIR` | `%LOCALAPPDATA%\CardapioDigital\secrets` | Pasta local protegida fora do OneDrive |

`backend/.env` não contém credenciais. As URLs ficam na pasta local protegida,
em um arquivo por perfil (`app-dev.env`, `app-test.env`, `migrate-dev.env` e
`migrate-test.env`). Perfis `migrate-*` são rejeitados pelo backend em execução.

Testes de integração devem executar com `NODE_ENV=test` e `DB_PROFILE=app-test`.
Um perfil divergente interrompe a inicialização antes de construir o Prisma ou
abrir conexão. `createApp()` aceita opcionalmente `{ prisma }` para injeção em
testes; o cliente de produção é criado na inicialização de `server.ts`. Os testes
unitários de `env`, Prisma e health usam doubles e não acessam PostgreSQL.

### Pasta local de segredos

Crie a pasta fora do OneDrive e restrinja a ACL ao usuário atual, SYSTEM e
Administradores:

```powershell
$secretsDir = Join-Path $env:LOCALAPPDATA 'CardapioDigital\secrets'
New-Item -ItemType Directory -Path $secretsDir -Force
icacls $secretsDir /inheritance:r /grant:r `
  "$($env:USERDOMAIN)\$($env:USERNAME):(OI)(CI)F" `
  "*S-1-5-18:(OI)(CI)F" `
  "*S-1-5-32-544:(OI)(CI)F"
```

Preencha os quatro arquivos manualmente. Não peça nem cole senhas no chat, não
salve credenciais no workspace e não copie a pasta para o OneDrive. O modelo
está em `backend/config/database.env.example`.

### Frontend (`frontend/.env`)

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:4000/api` | URL base da API |

## Prisma (Fases 1B.1 e 1B.2C)

O schema está em `backend/prisma/schema.prisma` e o client reutilizável em
`backend/src/lib/prisma.ts`. O datasource usa `DATABASE_URL` e
`shadowDatabaseUrl` usa `SHADOW_DATABASE_URL`, sempre fornecidas pelo arquivo do
perfil carregado pelo wrapper.

O wrapper `backend/scripts/prisma-run.ts` lê o arquivo de segredo do perfil,
valida usuário, banco, host, porta e senha e injeta as variáveis no processo
filho do Prisma. Ele permite `validate` e `generate` e, exclusivamente com o
perfil `migrate-test`, `migrate status` e `migrate deploy`. `migrate dev`,
`reset`, `resolve`, `db push` e seed são bloqueados.

```powershell
Set-Location -LiteralPath "C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend"
npm run db:validate
npm run db:generate
npm run db:migrate:status:test
```

O `migrate deploy` só é liberado com o banco `cardapio_digital_test`, finalidade
`migration` e confirmação explícita no ambiente da execução:

```powershell
$env:CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION = "APPLY_CARDAPIO_DIGITAL_TEST"
npm run db:migrate:deploy:test
```

O perfil `migrate-dev` exige `SHADOW_DATABASE_URL` apontando exclusivamente para
`cardapio_digital_shadow`. O banco principal e o shadow nunca podem ser iguais.
O perfil `migrate-test` também exige shadow, mas `migrate deploy` não o utiliza.

A migration inicial está em
`backend/prisma/migrations/20261023000000_initial_schema/migration.sql`. Ela
ainda não foi aplicada. O procedimento de backup, recuperação, suspensão de
`CONNECT` e proteção de `_prisma_migrations` está em
`backend/docs/security/initial-migration-acl-hardening.md`.

## Endpoint disponível

### `GET /api/health`

Resposta de sucesso (HTTP 200):

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "cardapio-digital-api",
    "timestamp": "2026-01-01T00:00:00.000Z",
    "uptime": 12.345
  }
}
```

Resposta de rota inexistente (HTTP 404):

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Rota não encontrada: GET /api/rota-inexistente"
  }
}
```

## Scripts

### Backend

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Inicia a API com recarga automática |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Executa a API compilada |
| `npm run typecheck` | Verifica os tipos sem gerar arquivos |
| `npm test` | Executa os testes com Vitest |
| `npm run test:watch` | Executa os testes em modo observação |
| `npm run db:validate` | Valida o schema usando o perfil `migrate-dev` |
| `npm run db:generate` | Gera o Prisma Client usando o perfil `migrate-dev` |
| `npm run db:validate:app` | Valida o schema usando o perfil `app-dev` |
| `npm run db:generate:app` | Gera o client usando o perfil `app-dev` |
| `npm run db:migrate:status:test` | Consulta o status no banco de teste com `migrate-test` |
| `npm run db:migrate:deploy:test` | Aplica migrations no teste; exige confirmação explícita |

O script `scripts/validate-databases.ts` executa verificações somente leitura de
conectividade, isolamento e privilégios depois que as credenciais reais forem
preenchidas manualmente:

```powershell
npx tsx scripts/validate-databases.ts
```

### Frontend

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Inicia o servidor de desenvolvimento Vite |
| `npm run build` | Verifica os tipos e gera o build de produção |
| `npm run preview` | Pré-visualiza o build de produção |
| `npm run typecheck` | Verifica os tipos sem gerar arquivos |

## Validação

```powershell
Set-Location -LiteralPath "C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend"
npm run db:validate
npm run db:generate
npm run typecheck
npm test
npm run build
npm audit

Set-Location ..\frontend
npm run typecheck
npm run build
```

A inspeção de permissões do PostgreSQL é somente leitura nesta fase:

```powershell
Set-Location -LiteralPath "C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend"
psql -h 127.0.0.1 -p 5432 -U cardapio_migrator -d cardapio_digital_dev  -f docs/sql/inspect-dev.sql
psql -h 127.0.0.1 -p 5432 -U cardapio_migrator -d cardapio_digital_test -f docs/sql/inspect-test.sql
psql -h 127.0.0.1 -p 5432 -U cardapio_migrator -d cardapio_digital_shadow -f docs/sql/inspect-shadow.sql
```

Nenhum `GRANT`, `REVOKE`, `ALTER ... OWNER`, migration, `db push`, reset ou seed
deve ser executado sem inspeção prévia e autorização específica.

Com os dois servidores em execução, também é possível validar a API diretamente:

```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/health" -Method Get
```
