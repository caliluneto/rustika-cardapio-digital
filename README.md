# RÚSTIKA — Cardápio Digital

Projeto acadêmico da Prática Extensionista VII da UNAERP: cardápio digital com comanda e pedidos para bares e restaurantes.

> **Estado: entrega acadêmica funcional; ainda não pronta para produção.** Catálogo, carrinho, comanda,
> pedidos, operação administrativa, acompanhamento do cliente e documentação OpenAPI estão implementados e foram
> exercitados no PostgreSQL Dev (9/9 migrations), incluindo o CRUD real do RF006 e as evidências de RF007, RF008 e
> RF009. As credenciais locais foram rotacionadas (4/4) e a auditoria de segredos está aprovada. Permanecem pendentes
> o vídeo de apresentação, a prova de restauração integral do backup e a publicação final dos materiais acadêmicos
> (relatório exportado, vídeo e anexos).

Legenda usada neste documento: **IMPLEMENTADO** (existe no código e é usado), **TESTADO** (coberto por teste
automatizado), **PARCIAL** (existe, mas incompleto) e **PENDENTE** (não existe).

## Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 6; testes com `node --test` (174 testes na validação local mais recente) |
| Backend | Node.js (Express), TypeScript; testes com Vitest |
| Banco | PostgreSQL 18, Prisma 6 (9 migrations aplicadas no ambiente Dev em 14/11/2026) |
| E2E | Playwright (Chromium), executado no GitHub Actions |
| CI | GitHub Actions (`.github/workflows/ci.yml`), Node 22 |

## Estrutura

```text
backend/
  src/            app, rotas (catálogo, acesso/admin, pedidos), serviços, segurança, domínio, mappers
  prisma/         schema.prisma e migrations (inclui privilégio mínimo para a role de runtime)
  scripts/        wrapper do Prisma, auditoria de segredos, catálogo (seed), inspeção/validação do E2E
  tests/          unitários e de contrato (Vitest); integration-db/ = integração e E2E com PostgreSQL de teste
  docs/           API de catálogo/acesso/pedidos, segredos, E2E e CI
frontend/
  src/            componentes (cardápio, carrinho, comanda, revisão), páginas (checkout, admin), serviços (API)
  tests/          testes unitários (node --test) e E2E (Playwright)
.github/          workflow de CI e arquivos do PostgreSQL efêmero
```

## Funcionalidades

| Área | Funcionalidade | Estado |
| --- | --- | --- |
| Catálogo | Categorias e produtos públicos via API (`GET /api/categories`, `/api/products`, `/api/products/:id`), paginação por cursor, só itens ativos e publicáveis | IMPLEMENTADO, TESTADO |
| Catálogo | Interface com navegação por categoria, modal de produto, estados de carregamento/erro; modo `demo` com dados locais | IMPLEMENTADO, TESTADO (lógica); layout sem teste visual |
| Carrinho | Adicionar, quantidade, remover, total, preço esperado enviado ao servidor | IMPLEMENTADO, TESTADO. Estado só em memória (sem persistência entre recargas, por decisão de segurança) |
| Comanda | Convite de uso único emitido pelo admin, resgate pelo cliente, sessão por cookie `HttpOnly`, expiração, limites de taxa | IMPLEMENTADO, TESTADO |
| Pedido | Revisão, envio com `Idempotency-Key`, validação de preço e disponibilidade no servidor, total calculado no servidor, histórico inicial `RECEIVED`, recuperação após falha de rede | IMPLEMENTADO, TESTADO (envio controlado por `VITE_ORDER_SUBMISSION`) |
| Administração | Login/logout/sessão com cookie `HttpOnly`, emissão de convite de comanda | IMPLEMENTADO, TESTADO |
| Administração | Todos os pedidos, filtro por status, itens, histórico, paginação por cursor, polling e aviso de novos pedidos | IMPLEMENTADO; gestão e transições validadas no Dev em 14/11/2026; filtro com evidência visual; aviso de novos pedidos pendente de evidência |
| Administração | Transições de status com compare-and-set e histórico atômico | IMPLEMENTADO, VALIDADO no Dev (`RECEIVED → IN_PREPARATION → READY → DELIVERED`) |
| Administração | Disponibilidade e CRUD de produtos; exclusão bloqueada quando há item de pedido referenciando o produto | IMPLEMENTADO, VALIDADO no Dev com criar, editar e excluir reais |
| Cliente | Acompanhamento automático do próprio pedido, autenticado pela sessão de comanda | IMPLEMENTADO, VALIDADO no Dev; quatro transições observadas na janela do cliente sem recarregar (evidência em `docs/entrega-academica/evidencias/`) |
| API | Contrato OpenAPI 3.1 em `/api/openapi.json` e visualizador local em `/api/docs` (fora de produção) | IMPLEMENTADO, TESTADO |
| Operação | Pagamento online, nota fiscal, delivery, upload de imagens, tempo real (Socket.IO) | PENDENTE, fora do escopo atual |

## Qualidade e CI confirmados

Resultados observados na validação final de 14/11/2026 e em execução manual do GitHub Actions do repositório privado:

| Execução | Resultado |
| --- | --- |
| Validação local final | Backend: **1.237 testes aprovados e 9 ignorados** (planilha privada); frontend: **174/174**; typecheck e builds aprovados |
| CI #5 (E2E manual) | PostgreSQL 18 efêmero iniciado, migrations aplicadas, Playwright/Chromium: **1 teste aprovado (8,6 s)** cobrindo login do admin → convite → resgate → pedido → verificação; teardown e prova de resíduo zero aprovados; banco e segredos descartados |

O E2E atual cobre **uma jornada** (caminho feliz). Isso não equivale a cobertura de todos os fluxos nem a prontidão para
produção. Detalhes em `backend/docs/github-actions-e2e.md`.

## Pré-requisitos

- Node.js 20.19+ (desenvolvimento validado com Node 24; CI com Node 22) e npm 10+.
- PostgreSQL 18 local para desenvolvimento (roles `cardapio_dev_app`, `cardapio_migrator` etc. — ver `backend/docs/`).

## Ambiente de desenvolvimento local

```powershell
cd backend ; npm install ; Copy-Item .env.example .env
cd ..\frontend ; npm install ; Copy-Item .env.example .env
```

Os arquivos `.env` não contêm credenciais e não são versionados. As URLs de banco ficam em **pasta de segredos fora do
repositório e fora do OneDrive** (`CARDAPIO_SECRETS_DIR`, padrão `%LOCALAPPDATA%\CardapioDigital\secrets`), um arquivo
por perfil: `app-dev`, `app-test`, `migrate-dev`, `migrate-test`, `fixtures-test`. Modelo em
`backend/config/database.env.example`; rotação e política em `backend/docs/secrets-rotation.md`. **Nunca** coloque
senhas no repositório, no chat ou em variáveis de ambiente de CI reais.

Executar (dois terminais):

```powershell
cd backend ; npm run dev        # API em http://localhost:4000
cd frontend ; npm run dev       # app em http://localhost:5173
```

### Variáveis

| Projeto | Variável | Padrão | Função |
| --- | --- | --- | --- |
| backend | `PORT` | `4000` | Porta da API |
| backend | `CORS_ORIGIN` | `http://localhost:5173` | Origem exata permitida (também exigida nas escritas) |
| backend | `DB_PROFILE` | `app-dev` (`app-test` com `NODE_ENV=test`) | Perfil de banco da aplicação |
| backend | `CARDAPIO_SECRETS_DIR` | `%LOCALAPPDATA%\CardapioDigital\secrets` | Pasta de segredos |
| frontend | `VITE_API_URL` | `http://localhost:4000/api` em desenvolvimento; `/api` no build | URL base da API |
| frontend | `VITE_CATALOG_MODE` | `api` | `api` ou `demo` |
| frontend | `VITE_ORDER_SUBMISSION` | desligado | `enabled` liga o envio real de pedidos |

## Comandos válidos

Backend (`backend/`): `npm run dev`, `typecheck`, `build`, `test` (completo), `test:ci` (unitário, sem planilha privada
nem banco), `secrets:audit`, `db:validate`, `db:generate`, `db:migrate:status:test` / `db:migrate:deploy:test`
(somente banco de teste, com confirmação), `e2e:inspect` / `e2e:validate-state` (usados pelo CI).

Frontend (`frontend/`): `npm run dev`, `typecheck`, `build`, `test` (174 testes na validação mais recente), `e2e` apenas sob as proteções descritas
em `backend/docs/e2e-real.md`.

## Procedimento de testes

1. **Local, sem escrita em banco:** `npm run typecheck`, `npm run build` e `npm run test:ci` no backend; `npm test` e
   `npm run build` no frontend.
2. **Integração e E2E (escrevem em PostgreSQL):** rodam no GitHub Actions contra um **PostgreSQL efêmero** criado no
   runner (workflow manual, `run_e2e=true`). Não rode esses testes contra o PostgreSQL local sem autorização
   específica; os *gates* (`RUSTIKA_E2E_CONFIRM`, `RUSTIKA_DB_INTEGRATION_CONFIRM`, perfis `app-test`/`fixtures-test`) existem
   para impedir escrita fora do banco de teste.
3. A planilha real de produtos (`backend/data/`) é privada e nunca é versionada; os testes de CI usam fixture sintética.

## GitHub Actions

Workflow `.github/workflows/ci.yml` (permissões `contents: read`, ações fixadas por SHA, nenhum `secrets.*`):
`backend` e `frontend` rodam em `pull_request` e manualmente; o job `e2e` roda **somente** manualmente com `run_e2e=true`.
Detalhes e lições (contexto `runner` fora de `env`, saída estruturada da inspeção) em `backend/docs/github-actions-e2e.md`.

## Limitações conhecidas

- Categorias e comandas não têm CRUD completo; permanecem fora da rubrica atual.
- As 9 migrations do Dev incluem o privilégio mínimo para o CRUD de produtos; o Test local está em 5/8 do baseline e depende de aplicação autorizada.
- Polling e sessões administrativas são locais a uma instância; produção com múltiplas instâncias exige armazenamento compartilhado.
- Administradores sem papéis ou permissões granulares (qualquer admin ativo pode tudo o que existir).
- Sem pagamentos, fiscal, delivery, tempo real ou upload de imagens.
- A suíte E2E real exige PostgreSQL de teste e não foi executada localmente nesta sprint; a execução em runner efêmero está registrada em `backend/docs/github-actions-e2e.md`.

## Pendências antes de produção

- Provar a restauração integral do backup pré-RF006 em banco descartável autorizado.
- Hospedagem, TLS, backup/restore automatizados, monitoramento e logs de auditoria.
- Revisão de segurança e teste de carga do fluxo de pedidos.
- Mais cenários E2E (indisponibilidade, preço alterado, comanda expirada, idempotência).
- Gravação do vídeo de apresentação e publicação autorizada dos materiais acadêmicos.

## Publicação e repositórios

O histórico de desenvolvimento e o repositório publicado (GitHub, privado) são **independentes** por motivos de
segurança. O snapshot publicado não contém credenciais, dados reais de clientes nem arquivos privados.
