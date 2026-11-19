# Deploy de Homologação — Render Free + Neon Free (`app-homolog-neon`)

## 1. Visão Geral e Fronteira de Custos

A homologação do **RÚSTIKA — Cardápio Digital** opera em serviço único no **Render Free** servindo simultaneamente os ativos compilados do frontend (`frontend/dist`) e a API Express (`/api/*`) na mesma origem HTTPS, conectada ao PostgreSQL 18 do **Neon Free** sob o perfil restrito de aplicação `app-homolog-neon` (`cardapio_homolog_app`).

- **Custo mensal:** R$ 0/mês (`plan: free` no Render, plano Free no Neon, sem discos persistentes pagos, sem Redis externo).
- **Separação estrita de privilégios:** o Render recebe **exclusivamente** a credencial de runtime `cardapio_homolog_app` (menor privilégio). Credenciais de `cardapio_homolog_migrator`, `neondb_owner` ou `cardapio_homolog_bootstrap` **nunca** são cadastradas no Render.
- **Zero automação destrutiva:** `autoDeploy: false`; `buildCommand` e `startCommand` não executam `prisma migrate`, `db push`, bootstrap administrativo nem importação de catálogo.

## 2. Pré-requisitos Antes da Publicação

1. **Snapshot público sanitizado atualizado:** exportar a árvore limpa para o repositório externo de publicação (`cardapio-digital-snapshot`, fora do OneDrive, conforme [publication-snapshot.md](file:///C:/Users/u1n3c/OneDrive/Documentos/Cardapio_Digital/backend/docs/publication-snapshot.md)), validar `git status` e `npm test` antes do `git push`.
2. **Banco Neon ainda não confirmado nesta sessão:** histórico 9/9 e Gate 09 são evidências históricas. `prisma-homolog/` mantém as nove migrations históricas e a variante 10 para roles definitivas, testada em PostgreSQL 18 descartável (10/10); o wrapper valida a cadeia e seleciona-a somente com `migrate-homolog`, mantendo `migrate-homolog-replay deploy` bloqueado. **Primeiro solicitar autorização específica** para `tsx scripts/prisma-run.ts migrate-homolog migrate status` (somente leitura), confirmar o resultado e histórico real antes de pedir autorização separada para o deploy. Não usar `migrate resolve` nem a credencial migradora no Render.
3. **Primeiro administrador:** não criado no Neon. O candidato histórico E4-ALT 9/9 não serve. Após 10/10 confirmado, coletar candidato E5.1 não aprovado, revisão independente e aprovação humana própria; somente então solicitar autorização distinta para bootstrap administrativo.
4. **Catálogo real:** não importado no Neon. O importador agora exige histórico 10/10 e checksum remoto; o planejamento offline da planilha privada selecionou exatamente 144 itens comercializáveis em 12 categorias (24 insumos, 6 incertos e 30 inativos excluídos). Dry-run e importação remota precisam de autorizações separadas.

## 3. Variáveis de Ambiente no Render (`render.yaml`)

### Definidas declarativamente no blueprint (não sensíveis)

| Variável | Valor | Função |
|---|---|---|
| `NODE_VERSION` | `22` | Runtime Node LTS compatível com backend e Vite 6 |
| `NODE_ENV` | `production` | Ativa cookies `Secure`, oculta `/api/docs` e exige perfil de homologação |
| `DB_PROFILE` | `app-homolog-neon` | Perfil opt-in para Neon com prova TLS externa independente |
| `CARDAPIO_SECRETS_SOURCE` | `env` | Lê segredos das variáveis `RUSTIKA_HOMOLOG_*` sem arquivo `.env` no container |
| `SERVE_FRONTEND` | `on` | Serve `frontend/dist` após todas as rotas `/api/*` |
| `TRUST_PROXY_HOPS` | `1` | Confia em exatamente 1 proxy reverso do Render para rate-limit por IP real |
| `HOMOLOG_GATE` | `on` | Exige HTTP Basic + `X-Robots-Tag: noindex` em tudo exceto `/api/health` e `/api/ready` |
| `VITE_CATALOG_MODE` | `api` | Compila o frontend consumindo `/api/categories` e `/api/products` |
| `VITE_ORDER_SUBMISSION` | `enabled` | Habilita o fluxo real de comanda e submissão de pedidos no build |

### Preenchidas manualmente no painel do Render (`sync: false`)

| Variável | Regra / Formato exigido |
|---|---|
| `CORS_ORIGIN` | Origem HTTPS exata do serviço Render, **sem barra final** (ex.: `https://rustika-cardapio-homolog.onrender.com`) |
| `HOMOLOG_GATE_USER` | `3..64` caracteres (`[A-Za-z0-9._-]`) para o portão HTTP Basic |
| `HOMOLOG_GATE_PASSWORD` | `24..256` caracteres gerados em gerenciador de senhas, sem conter `HOMOLOG_GATE_USER` |
| `RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK` | Valor exato documentado em `backend/src/config/neonServerIdentity.ts`, preenchido somente após leitura de [neon-homolog.md](file:///C:/Users/u1n3c/OneDrive/Documentos/Cardapio_Digital/backend/docs/neon-homolog.md) |
| `RUSTIKA_HOMOLOG_DATABASE_URL` | `postgresql://cardapio_homolog_app:<SENHA_URLENCODED>@<HOST_DIRETO_SEM_POOLER>/cardapio_digital_homolog?schema=public&sslmode=require&sslaccept=strict&channel_binding=require` (Prisma/Quaint 6.19.3: `verify-full` é recusado porque cairia em `prefer`) |
| `RUSTIKA_HOMOLOG_EXPECTED_DATABASE_HOST` | Hostname direto do endpoint Neon (`ep-sweet-king-bd7i7ypb...neon.tech`, nunca `-pooler`) |
| `RUSTIKA_HOMOLOG_EXPECTED_CLUSTER_ID` | UUID gravado em `COMMENT ON ROLE rustika_homolog_marker` |
| `RUSTIKA_HOMOLOG_EXPECTED_PROJECT_ID` | `aged-scene-47291697` |

## 4. Roteiro de Smoke Test Pós-Deploy

1. **Saúde e prontidão (sem credencial HTTP Basic):**
   - `GET https://<servico>.onrender.com/api/health` → `200 OK` (`status: "ok"`).
    - `GET https://<servico>.onrender.com/api/ready` **com HTTP Basic** → `200 OK` (confirma conectividade Prisma `SELECT 1`); sem Basic → `401`. Somente `/api/health` é isento do portão.
2. **Portão de homologação e cabeçalhos de segurança:**
   - `GET https://<servico>.onrender.com/` sem HTTP Basic → `401 Unauthorized` + `X-Robots-Tag: noindex, nofollow, noarchive`.
   - `GET https://<servico>.onrender.com/api/docs` → `404 Not Found` (Swagger desativado em `NODE_ENV=production`).
3. **Fluxo administrativo (`/#admin`):**
    - Autenticar no portão HTTP Basic, acessar `/#admin` e fazer login com o administrador aprovado para o novo 10/10.
   - Confirmar cookie `rustika_admin` (`HttpOnly`, `Secure`, `SameSite=Strict`).
   - Verificar os 144 produtos do catálogo real, marcar ao menos 1 produto de teste como `AVAILABLE`, emitir 1 convite de comanda de homologação.
4. **Fluxo público do cliente (`/`):**
   - Resgatar o convite na gaveta da comanda (`rustika_session`), adicionar item disponível ao carrinho, revisar e enviar pedido idempotente (`Idempotency-Key`), acompanhar transição `RECEIVED → IN_PREPARATION → READY → DELIVERED` pelo painel administrativo.

## 5. Estratégia de Rollback e Resposta a Incidentes

- **Falha no boot de identidade (`process.exit(1)`):** o Render mantém a revisão anterior ativa (ou falha o health check `/api/health` sem rotear tráfego). Corrigir apenas a variável incorreta no painel Render; nunca afrouxar `neonServerIdentity.ts` ou `secrets.ts`.
- **Rollback de código no Render:** acionar *Rollback to previous deploy* no painel do Render (imediato, sem tocar no banco). A migration 10 concede somente ACLs por coluna e **não** tem rollback automático do banco; qualquer reversão de ACL exige plano específico, backup e autorização própria, nunca `migrate resolve`.
- **Suspensão emergencial:** pausar o Web Service no painel do Render ou rotacionar `HOMOLOG_GATE_PASSWORD` / senha de `cardapio_homolog_app`. A branch de recovery no Neon permanece intacta.

> `HOMOLOG_GATE=on` torna a homologação acessível somente a quem possui credencial HTTP Basic, inclusive no celular. Não é abertura pública para clientes do restaurante; retirar o portão requer decisão/autorização separada, revisão de exposição e smoke test sem dados reais de teste.
