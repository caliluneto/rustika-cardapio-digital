> **ERRATA (3D.5.3-B.1):** este relatório foi superado em três pontos: (1) o Build Command precisa de `npm ci --include=dev` e `NODE_VERSION=22`; (2) `/api/ready` NÃO é mais isento do portão (somente `GET/HEAD /api/health`); (3) o Health Check Path é `/api/health`. Ver `RELATORIO-ENTREGA-3D.5.3-B.1.md`.

# RELATÓRIO DE ENTREGA — 3D.5.3-B
**Preparação offline do código para um único Render Web Service Free**

Base: `main` = `897a7b763b1de28f427d7ed387bc97bedd4c34a2` (snapshot limpo e igual a `origin/main`). Leitura prévia: `RELATORIO-ENTREGA-3D.5.3-A-RENDER.md`.

**Nada foi implantado, nenhum banco ou conta foi criado, nenhuma migration/Playwright foi executada, não há commit nem push, e o Render não foi tocado.** Toda a alteração está no repositório original, mais um manifesto de transferência.

Legenda de estado: **IMPLEMENTADO** · **VALIDADO LOCALMENTE** · **PREPARADO PARA PUBLICAÇÃO** · **NÃO EXECUTADO** · **PENDENTE**.

---

## 1. Arquitetura implementada
Um único processo Express, na mesma origem HTTPS, atrás do balanceador do Render:

```
Navegador ──HTTPS──> Render (TLS, proxy) ──HTTP──> Express
   Express (ordem dos middlewares, definida em app.ts)
     1. trust proxy (somente se TRUST_PROXY_HOPS > 0; padrão 0)
     2. X-Robots-Tag: noindex   (somente com o portão ativo)
     3. Portão HTTP Basic       (somente com HOMOLOG_GATE=on; exceção: GET/HEAD /api/health e /api/ready exatos)
     4. CORS (inalterado)
     5. /api/health, /api/ready, /api (catálogo), /api/admin, /api/comanda-sessions, /api/orders  (inalterados)
     6. Frontend estático (somente com SERVE_FRONTEND=on)   <- depois de TODA a API
     7. notFound (JSON 404) e errorHandler (inalterados)
```
Tudo é **opt-in**: sem as variáveis novas o comportamento é exatamente o anterior (somente API). **IMPLEMENTADO · VALIDADO LOCALMENTE.**

## 2. Arquivos alterados
| Arquivo | Tipo | O que mudou |
|---|---|---|
| `backend/src/config/webConfig.ts` | novo | Leitura/validação de `SERVE_FRONTEND`, `TRUST_PROXY_HOPS`, `HOMOLOG_GATE*` (falha fechada; mensagens sem valores) |
| `backend/src/security/homologGate.ts` | novo | Portão HTTP Basic |
| `backend/src/web/staticFrontend.ts` | novo | Servidor de estáticos de `frontend/dist` |
| `backend/src/app.ts` | alterado (+13 linhas) | Encaixa proxy, noindex, portão e estáticos; `AppDependencies.web` opcional |
| `backend/src/server.ts` | alterado (+12) | Lê a configuração web; aviso se o frontend é servido sem portão |
| `backend/src/config/secrets.ts` | alterado | Origem `env` opt-in, só para `app-homolog` runtime |
| `frontend/src/services/catalogAdapter.ts` | alterado | `imageUrl` com base relativa e endurecimento |
| `frontend/package.json` | alterado (1 linha) | Inclui o novo teste no `npm test` |
| `backend/tests/web-hosting.test.ts` | novo | 9 testes |
| `backend/tests/web-gate-proxy.test.ts` | novo | 18 testes |
| `backend/tests/config/web-config.test.ts` | novo | 7 testes |
| `backend/tests/config/secrets-env-source.test.ts` | novo | 8 testes |
| `frontend/tests/catalog-image-url.test.mjs` | novo | 8 testes |
| `RELATORIO-ENTREGA-3D.5.3-B.md`, `manifest-3d53b-transfer.txt` | novos | Este relatório e o manifesto |

**Não alterados:** as sete migrations, `prisma-run`, scripts SQL, workflows, `env.ts`, rotas, serviços, bootstrap, identidade do servidor, gates de TLS/host.

## 3. Servidor Express (estáticos) — IMPLEMENTADO · VALIDADO
* `createStaticFrontend(dir)` exige `index.html` na criação; senão lança `FrontendBuildMissingError` (o servidor **não sobe** sem o build).
* Somente `GET`/`HEAD`. Qualquer caminho `/api…` (qualquer caixa, com ou sem barra) **nunca** chega aos estáticos: segue para o 404 JSON.
* **Sem *fallback* de SPA**: o roteamento é por hash; só `/` e `/index.html` devolvem HTML. Caminho inexistente → 404 (nunca HTML com 200).
* Arquivos internos: `dotfiles: 'ignore'`; bloqueio de `.map .env .pem .key .crt .p12 .sql .log` **testado após decodificar a URL** (`x.%6dap`, `%2e%65nv`); traversal (`..`, `%2e%2e`, `%2f`, `%5c`, `%00`) → 400/404; a raiz é exclusivamente `frontend/dist`.
* Cabeçalhos: `X-Content-Type-Options: nosniff`; `index.html` → `no-cache`; `/assets/*` (hash do Vite) → `public, max-age=31536000, immutable`; demais arquivos (ex.: `rustika/*.png`) → `public, max-age=3600`.
* `/api/ready` continua sendo a prontidão (503 sem banco, 200 com banco, `no-store`); `/api/health` continua sendo liveness sem banco.

## 4. Frontend estático (build) — VALIDADO LOCALMENTE
Saída `frontend/dist` (Vite 6, `base=/`). Com `VITE_API_URL=/api` e `VITE_CATALOG_MODE=api`, o bundle contém `VITE_API_URL:"/api"`; nenhum segredo entra no bundle. `VITE_ORDER_SUBMISSION` **não** é definido (pedidos reais desabilitados). Build medido: ≈ 5 s com `NODE_OPTIONS=--max-old-space-size=400`.

## 5. Build — valores finais para o Render
| Campo | Valor |
|---|---|
| Root Directory | **(em branco / raiz do repositório)** — `getBackendRoot()` já aceita `cwd/backend`; o runtime precisa enxergar `../frontend/dist` |
| Build Command | `NODE_OPTIONS=--max-old-space-size=400 npm --prefix frontend ci --no-audit --no-fund && NODE_OPTIONS=--max-old-space-size=400 npm --prefix frontend run build && cd backend && npm ci --no-audit --no-fund && npx prisma generate && NODE_OPTIONS=--max-old-space-size=400 npm run build` |
| Start Command | `cd backend && node dist/server.js` |
| Health Check Path | `/api/ready` (valor escolhido pelo proprietário) — **ver risco R2; recomendo `/api/health`** |
| Auto-Deploy | Off |
| Node | `NODE_VERSION=22` (CI usa 22; `engines` ≥ 20.19) **[confirmar no painel]** |
| Migrations | **Nenhuma** no build nem no start |

Validação: cada etapa foi executada localmente (build do frontend, `prisma generate`, build do backend, `dist/server.js` e `dist/web/*` gerados). **NÃO EXECUTADO:** a sequência completa a partir de checkout limpo com `npm ci` (apagaria `node_modules` locais); tempo e memória reais no Render ficam **PENDENTES**.

## 6. Inicialização — IMPLEMENTADO
`node dist/server.js` (`PORT` do Render; escuta em todas as interfaces). Em produção: valida `CORS_ORIGIN`, a configuração web, e **verifica a identidade do servidor de banco antes de `listen`**; falha ⇒ `exit(1)` (inalterado). Se `SERVE_FRONTEND=on` e o build não existir, o processo encerra. Aviso (sem valores) se o frontend é servido sem portão.

## 7. Correção de imagens — IMPLEMENTADO · VALIDADO (161 testes de frontend, 8 novos)
Causa: `new URL(valor, base)` com base relativa (`/api`) lançava e descartava a imagem em silêncio.
* Base relativa `/api` é resolvida contra `location.origin` (somente http/https); sem origem de página (fora do navegador) o caminho relativo é omitido.
* **Política preservada:** absoluta `http(s)` sem credenciais é aceita; `javascript:`, `data:`, `file:`, `ftp:`, `blob:` e URLs com usuário/senha continuam omitidos; a base absoluta anterior se comporta como antes.
* **Endurecimento acrescentado (nova decisão, a auditar):** valores relativos não podem ser *protocol-relative* (`//host/x`), conter barra invertida (`/\host` vira `//host` nos navegadores) nem caracteres de controle, e **a URL resolvida precisa ter a mesma origem da API**. Bases suspeitas (`//evil/api`, `/\x`, vazia) são recusadas.
* Observação: URLs **absolutas** de outras origens continuam aceitas (política existente). Se a auditoria quiser restringi-las, é uma decisão de produto separada.

## 8. Proxy e rate limit — IMPLEMENTADO · VALIDADO (cadeia do Render NÃO medida)
* `TRUST_PROXY_HOPS` inteiro de 0 a 5, **padrão 0**; `true`, negativos, fracionários e texto são rejeitados. `app.set('trust proxy', n)` só é chamado com n > 0 (número de saltos, nunca `true`).
* Com 0 saltos, `X-Forwarded-For` é ignorado e o contador usa o endereço do socket. Com 1 salto usa o último endereço (o acrescentado pelo proxy); entradas forjadas à esquerda são ignoradas. A regra IPv6 /64 do limitador foi preservada.
* Testes confirmam que falsificar `X-Forwarded-For` **não** evita o limitador do portão em 0 nem em 1 salto, e que com 1 salto clientes distintos têm contadores independentes.
* **Evidência insuficiente para fixar o número de saltos do Render** (a página de IP do cliente retornou 404 na pesquisa anterior). Por isso o padrão é 0 e o roteiro de validação está na §16 (R3). **Com 0 no Render, todos os clientes compartilham um contador** (seguro, porém degradado: o lockout é global).

## 9. Portão de homologação — IMPLEMENTADO · VALIDADO (18 testes)
* Desativado por padrão. `HOMOLOG_GATE=on` exige `HOMOLOG_GATE_USER` (3–64: letras, números, `.` `-` `_`) e `HOMOLOG_GATE_PASSWORD` (24–256, sem controles, sem conter o usuário); caso contrário o servidor não sobe.
* Comparação em tempo constante (SHA-256 dos dois lados + `timingSafeEqual`, sem curto-circuito); credenciais nunca em código, logs, respostas ou cabeçalhos ecoados (testado).
* Tentativas repetidas: 10 falhas por cliente em 15 min; a 11ª tentativa recebe **429** (`Retry-After`), inclusive com credencial correta, até a janela expirar. A primeira visita sem cabeçalho (desafio do navegador) não conta.
* Cobre estáticos **e** API (inclusive 404). O cookie do administrador, o CSRF/Origin e as autorizações continuam atuando por trás (teste: com credencial do portão, escrita sem `Origin` ainda dá 403 `ORIGIN_NOT_ALLOWED`).
* **Exceção mínima** para o health check: `GET`/`HEAD` em `/api/ready` e `/api/health` **exatos**. Variações (`/api/ready/`, `/API/READY`, `//api/ready`, `/api/admin/ready`, métodos de escrita) passam pelo portão. As duas respostas não carregam dados do sistema além de estado fixo (`/api/health` inclui `uptime` e `timestamp`).
* `X-Robots-Tag: noindex, nofollow, noarchive` em todas as respostas (200/401/404) quando o portão está ativo — defesa complementar, **não** controle de acesso.
* **A auditar:** o portão protege a página; um navegador reenvia as credenciais Basic nas chamadas `fetch` da mesma origem. Esse comportamento é padrão, mas **não foi verificado em navegador real** (PENDENTE).

## 10. Segredos — IMPLEMENTADO (adaptação opt-in) · VALIDADO · NÃO TESTADO NO RENDER
**Incompatibilidade:** o gate exige arquivo `app-homolog.env` com modo sem bits de grupo/outros e fora do workspace. O Render pode não garantir esse modo em *Secret Files* (documentação indisponível na pesquisa).
* **Gate de arquivo não foi enfraquecido** e continua sendo o padrão (testado: arquivo 0644 ainda é recusado).
* **Adaptação:** `CARDAPIO_SECRETS_SOURCE=env` (opt-in explícito) lê **três variáveis prefixadas** (`RUSTIKA_HOMOLOG_DATABASE_URL`, `RUSTIKA_HOMOLOG_EXPECTED_DATABASE_HOST`, `RUSTIKA_HOMOLOG_EXPECTED_CLUSTER_ID`). Variáveis genéricas (`DATABASE_URL`, `SHADOW_DATABASE_URL`) são ignoradas.
* **Restrições:** só vale para o perfil `app-homolog` com finalidade `runtime`; para migração, bootstrap, replay e perfis locais lança erro. Todas as demais validações permanecem (host remoto/não local, `EXPECTED_DATABASE_HOST`, TLS `require|verify-*`, `sslaccept=strict`, lista de parâmetros, banco e usuário exatos, UUID do cluster, sem shadow). A identidade do servidor continua sendo verificada em `server.ts`.
* **Trade-off a auditar:** variáveis de ambiente do Render substituem a proteção de modo de arquivo; o isolamento passa a depender do cofre de variáveis do provedor. Migrations e bootstrap **não** usam essa origem.
* Caminho alternativo: se o Secret File do Render comprovadamente tiver modo ≤ 0600 e caminho fora do workspace (ex.: `/etc/secrets`), usar o modo `file` sem a adaptação. **PENDENTE de teste no Render.**

## 11. Segurança — preservada
Cookies `HttpOnly; Secure; SameSite=Strict|Lax` (inalterados); Origin/CORS/CSRF (`writeGuard`) inalterados e testados por trás do portão; rate limiting inalterado (chave por cliente, /64 IPv6, agora respeitando `trust proxy` configurado); autorização administrativa, isolamento de sessões, privilégios mínimos do PostgreSQL, TLS e identidade do cluster intactos; proteção contra duplicidade de pedidos intacta (rotas de pedidos não foram tocadas). Nenhum gate foi removido ou relaxado.

## 12. Sessões e suspensão (documentação)
O Render Free suspende após 15 min sem tráfego e retoma em cerca de 1 min; pode reiniciar a qualquer momento.
| Item | Impacto |
|---|---|
| Sessões administrativas (memória) | Perdidas a cada suspensão/reinício → novo login |
| Sessões de comanda (memória) | Perdidas → clientes precisam reabrir a comanda |
| Rate limits e contadores do portão | Zerados a cada reinício (janela de tentativas recomeça) |
| Login | Funciona após o despertar; a primeira requisição espera ~1 min + banco |
| Pedidos | Enfileirados não existem; pedido em voo durante o reinício pode falhar. A idempotência (`Idempotency-Key`) já existente protege contra duplicidade ao repetir |
| Reconexão PostgreSQL | O processo reabre o pool no start; com o Neon suspenso o primeiro `connect` espera o compute acordar (`connect_timeout` permitido na URL). Conexões ociosas cortadas pela suspensão podem gerar erro na 1ª consulta → **PENDENTE de teste** |
| *Polling* do frontend | Chamadas durante o despertar falham/temporizam (timeout do cliente: 15 s); a interface já trata erros de rede |
| Tráfego artificial | **Não implementado**, conforme a decisão do proprietário |
Armazenamento de sessões **não** foi alterado (sem autorização específica).

## 13. Testes
| Suíte | Resultado |
|---|---|
| Backend `test:ci` | **1050 aprovados, 8 ignorados** (antes 1008; +42 novos) |
| Frontend `npm test` | **161 aprovados, 0 falhas** (+8 novos) |
| `tsc --noEmit` (backend) | 2 erros **preexistentes** (`tests/scripts/verify-fixtures-rotation.ts`); nenhum novo |
| `tsc --noEmit` (frontend) | limpo |
| Build backend / frontend | OK |
| Smoke com o `frontend/dist` real (supertest, sem porta): `/`, bundle JS, imagem, `/api/xyz` → 404 | OK (arquivo temporário removido) |
| Varredura de segredos nos 13 arquivos do manifesto | sem ocorrências |
Cobertura nova: estáticos e rotas inexistentes, segurança de arquivos internos, ordem dos middlewares, health/readiness, portão (credenciais, exceções, 429, janela, noindex, logs), proxy (0/1 saltos, falsificação, IPv6), configuração de produção (mensagens sem valores), segredos por ambiente (restrições e validações), imagens. **NÃO EXECUTADO** (conforme a instrução): PostgreSQL persistente, migrations, Playwright, workflows; os testes de integração existentes foram preservados sem alteração.

## 14. Comandos e valores finais do Render
Ver §5. Resumo: Root Directory **em branco**; Build Command e Start Command conforme a tabela; Health Check Path `/api/ready` (R2).

## 15. Variáveis de ambiente (sem valores sensíveis)
| Variável | Tipo | Finalidade |
|---|---|---|
| `NODE_ENV=production` | texto | modo de homologação |
| `DB_PROFILE=app-homolog` | texto | perfil obrigatório em produção |
| `CORS_ORIGIN` | texto | URL exata do serviço (`https://…onrender.com`, sem barra final) |
| `SERVE_FRONTEND=on` | texto | serve `frontend/dist` |
| `TRUST_PROXY_HOPS=0` | texto | manter 0 até validar (§16 R3) |
| `HOMOLOG_GATE=on` | texto | liga o portão |
| `HOMOLOG_GATE_USER` | **segredo** | usuário do portão |
| `HOMOLOG_GATE_PASSWORD` | **segredo** | senha do portão (≥ 24 caracteres) |
| `CARDAPIO_SECRETS_SOURCE=env` *(ou arquivo, §10)* | texto | origem dos segredos de banco |
| `RUSTIKA_HOMOLOG_DATABASE_URL` | **segredo** | URL do banco (endpoint direto, TLS) |
| `RUSTIKA_HOMOLOG_EXPECTED_DATABASE_HOST` | texto | host esperado |
| `RUSTIKA_HOMOLOG_EXPECTED_CLUSTER_ID` | texto | UUID da marca do cluster |
| `VITE_CATALOG_MODE=api` | build | modo do catálogo |
| `VITE_API_URL=/api` | build | API na mesma origem |
| `NODE_VERSION=22` | build/runtime | versão do Node (confirmar) |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` | build | garante que o `npm ci` não baixe navegadores |
`PORT` é fornecido pelo Render. **Não definir** `VITE_ORDER_SUBMISSION`. Nenhum valor real foi criado ou gravado.

## 16. Riscos
| # | Risco | Mitigação / estado |
|---|---|---|
| R1 | Estratégia de banco não provada no Neon (3D.5.3-A §6.3) | Ensaio 3D.5.3-C. **PENDENTE** |
| R2 | **Health check `/api/ready` acorda/mantém o Neon ativo e falha enquanto o banco dorme.** Cada sondagem consulta o banco (cache 5 s). Se o Render a repetir a cada poucos segundos, o compute nunca suspende (0,25 CU × 720 h ≈ 180 > 100 CU-h do Free) e as 750 h do Render podem ser consumidas se a sondagem impedir o *spin-down* [não documentado]. | Recomendo trocar para `/api/health` (liveness, sem banco; já é exceção do portão). `/api/ready` serve para verificação manual. Decisão do proprietário. |
| R3 | Número de saltos do Render desconhecido; com 0 o lockout do portão/limites é global | Validar após o 1º deploy: com `TRUST_PROXY_HOPS=0`, errar a senha 10× de um cliente A e testar com B (outra rede): 429 em B confirma o contador compartilhado. Definir `1`, repetir (B deve entrar) e confirmar que entradas forjadas de `X-Forwarded-For` não ajudam A. Se o Render acrescentar mais de uma entrada, ajustar e repetir. Nunca usar `true`. |
| R4 | Modo/caminho dos Secret Files desconhecidos | Origem `env` opt-in (§10) ou teste prévio do arquivo |
| R5 | Credenciais Basic nas chamadas `fetch` do navegador | Verificar em navegador real no 1º deploy |
| R6 | `xlsx` baixado do CDN da SheetJS no `npm ci` do backend | Pode quebrar o build; mitigação futura (retirar do build) |
| R7 | Build/RAM de 512 MB | Heap limitado a 400 MB nos comandos; tempo/memória reais **PENDENTES** |
| R8 | Sessões em memória / *cold start* | Documentado (§12); aceito para homologação |
| R9 | Artefato local: em shell Git Bash, `VITE_API_URL=/api` foi convertido em `C:/Program Files/Git/api` | Só afeta builds locais no Windows (`MSYS_NO_PATHCONV=1`); o Render é Linux. Revalidado: `VITE_API_URL:"/api"` no bundle |
| R10 | Mudança no endurecimento de imagens pode ocultar URLs que antes carregavam (ex.: barra invertida) | Documentado e testado; avaliar com o catálogo real em homologação |

## 17. Pendências do Neon (herdadas de 3D.5.3-A, **NÃO tratadas aqui**)
`ALTER ROLE … RENAME`; `COMMENT ON ROLE` e leitura da marca pela role de runtime; dono `cardapio_migrator` do banco transitório; PostgreSQL 17/18 no Free; `pg_stat_ssl`; *cold start* e P1017; `sslaccept=strict` com a CA pública; `schema:compare` contra o CI efêmero. Nada foi criado no Neon.

## 18. Manifesto de transferência — PREPARADO PARA PUBLICAÇÃO
`manifest-3d53b-transfer.txt` (14 linhas, caminhos relativos à raiz do projeto):
```
backend/src/app.ts                         backend/tests/web-hosting.test.ts
backend/src/server.ts                      backend/tests/web-gate-proxy.test.ts
backend/src/config/secrets.ts              backend/tests/config/web-config.test.ts
backend/src/config/webConfig.ts            backend/tests/config/secrets-env-source.test.ts
backend/src/security/homologGate.ts        frontend/src/services/catalogAdapter.ts
backend/src/web/staticFrontend.ts          frontend/tests/catalog-image-url.test.mjs
frontend/package.json                      RELATORIO-ENTREGA-3D.5.3-B.md
```
Verificado: no snapshot, `app.ts`, `server.ts`, `secrets.ts`, `catalogAdapter.ts` e `package.json` diferem do original **somente** pelas mudanças desta etapa (13, 12, 63, 37 e 2 linhas), então a transferência é um delta limpo. Regras ao publicar: não copiar `.git`; converter CRLF→LF; adicionar explicitamente (sem `git add .`); `git push --no-tags origin main:main`; não disparar workflows. **NÃO EXECUTADO.**

## 19. Próximos passos
1. **Auditoria** deste relatório (ChatGPT) e decisões do proprietário: health check (`/api/health` vs `/api/ready`), origem de segredos (`env` vs arquivo), endurecimento de imagens.
2. Publicar o delta no snapshot (commit pontual `feat(web): prepare single-service Render hosting`).
3. **3D.5.3-C**: ensaio de compatibilidade do Neon em projeto descartável (exige a conta do proprietário).
4. **3D.5.3-D**: criação do serviço no Render, validação de saltos de proxy, de Secret Files e de navegador, e *smoke tests*.

## 20. Estado dos repositórios
* **Original** (`…\Cardapio_Digital`): contém as alterações desta etapa (não commitadas; o repositório original já tinha outras modificações pendentes anteriores a esta etapa, fora do escopo).
* **Snapshot sanitizado** (`C:\Users\u1n3c\RustikaPublish\cardapio-digital-snapshot`): intocado nesta etapa; `HEAD` = `origin/main` = `897a7b763b1de28f427d7ed387bc97bedd4c34a2`, árvore limpa.
* **GitHub** (`caliluneto/rustika-cardapio-digital`): inalterado. Nenhum workflow disparado.
* **Render / Neon**: nenhum recurso criado.

### Resumo por estado
| Estado | Itens |
|---|---|
| IMPLEMENTADO | Estáticos, portão, proxy configurável, origem de segredos por ambiente, correção de imagens, validação de configuração |
| VALIDADO LOCALMENTE | 1050 testes backend, 161 frontend, typecheck, builds, smoke com `dist` real, varredura de segredos |
| PREPARADO PARA PUBLICAÇÃO | Manifesto e delta limpo para o snapshot |
| NÃO EXECUTADO | Deploy, banco, migrations, Playwright, workflows, `npm ci` a frio, commit/push, qualquer ação no Render ou Neon |
| PENDENTE | R1–R10, medição de saltos do Render, Secret Files, Neon, comportamento do navegador com Basic, tempo/memória de build |
