# RELATÓRIO DE ENTREGA — 3D.5.3-A
**Preparação da hospedagem 100% gratuita no Render (planejamento, sem deploy)**

Escopo cumprido: somente leitura do código e pesquisa em documentação oficial. **Nada foi criado, contratado, implantado, migrado ou commitado.** Nenhum arquivo do projeto além deste relatório foi alterado. Ponto de partida: `main` = `897a7b763b1de28f427d7ed387bc97bedd4c34a2`.

Legenda usada em todo o documento: **[CÓDIGO]** lido no repositório · **[DOC]** documentação oficial consultada em 06/11/2026 · **[INFERIDO]** dedução minha · **[TESTAR]** não provado; exige teste antes de confiar.

---

## 1. Resumo executivo

| Pergunta | Resposta |
|---|---|
| Arquitetura | **Alternativa A**: um único Web Service Free no Render, com o Express servindo a API em `/api` e o build do Vite na mesma origem. |
| Banco | **Neon Free** (direto, sem *pooler*) como candidato. **Render PostgreSQL Free descartado** (expira em 30 dias, 1 GB). |
| Maior risco | A estratégia atual de banco (replay das 7 migrations + renomeação de banco e roles + role-marca) **nunca foi provada no Neon**. Vários pontos não constam na documentação do Neon e exigem um ensaio. |
| Maior ajuste de código | Rate limit e IP do cliente atrás do *proxy* do Render (hoje todo cliente cairia no mesmo contador). |
| Custo | R$ 0, desde que nenhum cartão seja cadastrado e nenhum recurso pago seja escolhido (§12). |
| Veredito | **Viável com mudanças pequenas de código + 1 ensaio de compatibilidade do Neon.** Não está pronto para deploy hoje. |

---

## 2. Arquitetura recomendada: Alternativa A (um serviço)

### 2.1 Comparação

| Critério | **A — 1 Web Service (API + estáticos)** | B — Static Site + Web Service |
|---|---|---|
| Origem | Única (`https://<nome>.onrender.com`) | Duas origens diferentes |
| Cookies administrativos | `SameSite=Strict`, `path=/api/admin`, `HttpOnly`, `Secure` funcionam **sem alteração** | **Quebram**: `onrender.com` é sufixo público ([INFERIDO], conferir em publicsuffix.org); os dois subdomínios são *cross-site*. Seria preciso `SameSite=None`, sujeito ao bloqueio de cookies de terceiros dos navegadores. Muda o modelo de segurança. |
| CORS / Origin / CSRF | `CORS_ORIGIN` = própria origem; o `writeGuard` (Origin exata + `X-Rustika-Request`) segue igual | Mantém-se, mas com CORS real e preflight em toda chamada |
| Mudanças no código | Servir `frontend/dist` + ajustes da §5 | Cookies, `SameSite`, eventual reescrita de CSRF |
| Deploy | Um serviço, um build | Dois serviços, duas configurações, ordem de URLs |
| Desempenho | Estáticos passam pela instância de 512 MB / CPU compartilhada [DOC: RAM 512 MB]; aceitável para homologação sem clientes | Frontend sempre ativo (sem *spin-down*), API fria |
| Limites gratuitos | 750 h/mês por workspace; um serviço só | Estáticos não gastam horas, mas consomem banda e minutos de build do mesmo workspace [DOC] |

**Decisão: A.** Menor risco, preserva cookies e CSRF exatamente como estão e evita reabrir decisões de segurança já aprovadas.

### 2.2 Como funciona (alvo)
* Build: compila o Vite (`frontend/dist`) e o TypeScript do backend (`backend/dist`).
* `server.ts` (produção) verifica a identidade do servidor de banco e só então chama `listen` [CÓDIGO]. O Express serviria `frontend/dist` **depois** das rotas `/api/*` e **antes** do `notFound`; `/api/*` desconhecido continua respondendo o JSON de 404 atual.
* O roteamento do frontend é por **hash** (`#admin`) [CÓDIGO: `AppWrapper.tsx`], logo **não há necessidade de *fallback* de SPA** para rotas de caminho; só `/` precisa devolver `index.html`.
* HTTPS: terminado pelo balanceador do Render, que encaminha em HTTP ao serviço [DOC]. O código já marca cookies como `Secure` quando `NODE_ENV=production` ou `CORS_ORIGIN` começa com `https://` [CÓDIGO: `app.ts`], sem depender de `req.secure`.

---

## 3. Compatibilidade com o código existente (inspecionado)

| Item | Estado [CÓDIGO] | Situação no Render |
|---|---|---|
| Build backend | `tsc -p tsconfig.build.json` → `backend/dist/server.js`; `npm start` = `node dist/server.js` | OK |
| Build frontend | `tsc --noEmit && vite build` → `frontend/dist` (sem `base` customizado: `BASE_URL` = `/`) | OK |
| `PORT` | `readPort(process.env.PORT, 4000)`; `app.listen(port)` sem host (todas as interfaces) | OK; Render define `PORT` (padrão 10000) e exige escuta em `0.0.0.0` [DOC] |
| `NODE_ENV=production` | Exige `DB_PROFILE=app-homolog` e valida `CORS_ORIGIN` (https público, sem barra final, não localhost) | Compatível |
| Liveness | `GET /api/health` (sem banco) | Usar como *health check* do Render |
| Readiness | `GET /api/ready` (SELECT + sonda de schema, timeout **2 s**, `no-store`) | Ver risco de *cold start* do Neon (§7) |
| Shutdown | Trata `SIGTERM`/`SIGINT`: `close()` + `$disconnect()` | OK; Render envia `SIGTERM` e dá 30 s padrão antes do `SIGKILL` [DOC] |
| Segredos | **Arquivo** `<CARDAPIO_SECRETS_DIR>/app-homolog.env` (modo sem bits de grupo/outros), **fora** do workspace do projeto; chaves `DATABASE_URL`, `EXPECTED_DATABASE_HOST`, `EXPECTED_CLUSTER_ID` | **Incerto no Render** (§6.3) |
| Parâmetros da URL do banco | Lista fechada: `sslmode`, `sslaccept`, `sslcert`, `schema`, `connect_timeout`, `connection_limit`, `pool_timeout`. `sslmode` ∈ require/verify-ca/verify-full; porta 5432 | Compatível com Neon **direto**; **não** permite `pgbouncer=true` (§6.2) |
| Host | Bloqueia loopback, `localhost`, rótulo único; `EXPECTED_DATABASE_HOST` = host da URL | `ep-….neon.tech` é aceito |
| `VITE_API_URL` | Padrão `http://localhost:4000/api`; usado em `fetch(`${API_BASE_URL}…`)` | **Armadilha**: valor relativo (`/api`) funciona para `fetch`, mas `catalogAdapter.imageUrl` usa `new URL(value, base)` e **falha com base relativa**, descartando imagens em silêncio (§5) |
| `VITE_CATALOG_MODE` | `api` ou `demo`; qualquer outro lança erro | Definir `api` no build |
| `VITE_ORDER_SUBMISSION` | Envio real de pedidos só com `enabled` | **Manter desabilitado** na primeira homologação |
| Service worker | Nenhum (`serviceWorker` ausente em `src/` e `public/`) | Sem cache offline a invalidar |
| Rate limit | Em memória, por IP; comentário explícito: *"Forwarding headers are never trusted"*; **sem `trust proxy`** | **Problema** no Render (§5.2) |
| Sessões | Administrativas e de comanda **em memória**; instância única | Perdidas a cada *spin-down*/reinício (§8) |
| Dependência externa de build | `xlsx` vem de `https://cdn.sheetjs.com/…tgz` (backend) | `npm ci` depende desse CDN; sem uso em `src/` (apenas scripts) → risco de build, ver §8 |

---

## 4. Limitações do Render Free [DOC: render.com/docs/free e /web-services, /health-checks, /deploys]

| Tema | Fato |
|---|---|
| Horas | **750 h/mês por workspace**; só serviços em execução consomem; esgotado → todos os Free são suspensos até o mês seguinte; não acumula |
| Suspensão por inatividade | Após **15 min** sem tráfego HTTP/WebSocket; retomada na próxima requisição em **cerca de 1 min** |
| Memória/CPU | **512 MB** de RAM [DOC secundária]; CPU não declarada na página principal (fontes secundárias citam 0,1 vCPU) **[TESTAR]** |
| Reinícios | "Render might restart a Free web service at any time" |
| Sistema de arquivos | Efêmero; perdido em *deploy*, reinício e *spin-down*; sem disco persistente |
| Instâncias | Máximo 1; sem escala horizontal; sem shell; sem *jobs* pontuais; não recebe tráfego de rede privada |
| Banda | Conta contra a banda do workspace; excedente é cobrado; **sem forma de pagamento cadastrada, os serviços Free são suspensos** (comportamento a favor do custo zero) |
| Minutos de build | Contam contra a cota do workspace; sem forma de pagamento e esgotada a cota, **novos builds são desativados** no mês; serviços existentes continuam |
| Portas de saída | 25, 465 e 587 bloqueadas no Free (o sistema não envia e-mail) |
| Suspensão discricionária | O Render pode suspender Free com tráfego de saída incomum (ex.: banco externo, APIs) |
| *Rollback* | Apenas para os **dois deploys anteriores** |
| Logs | Retenção **não declarada** nas páginas lidas **[TESTAR/CONFIRMAR no painel]** |
| *Health check* | Padrão: TCP na porta; opcional HTTP GET em caminho iniciado por `/` com 2xx/3xx em até 5 s; 15 s de falhas consecutivas tiram do roteamento, 60 s reiniciam |
| Limites de build | build 120 min, *start* 15 min |
| Não encontrado nas páginas | Página de *Secret Files* e de cabeçalhos *forwarded*/IP do cliente retornaram 404 na consulta; **tratar como não verificado** (§5.2, §6.3) |

---

## 5. Mudanças mínimas necessárias no código (para a próxima etapa; **não implementadas**)

### 5.1 Servir o frontend pelo Express (~15 linhas)
`express.static(<repo>/frontend/dist)` somente quando `NODE_ENV=production`, **depois** das rotas `/api/*`; `index.html` com `Cache-Control: no-cache`, `assets/*` (nomes com hash do Vite) com cache longo. Localizar `frontend/dist` a partir de `getBackendRoot()/../frontend/dist`. Teste: `/api/*` inexistente continua JSON 404; `/` devolve HTML; `/api/orders` etc. intactos.

### 5.2 Endereço do cliente atrás do proxy do Render (**obrigatório**)
Sem `trust proxy`, `request.ip` será o do balanceador: **todos os clientes compartilham o mesmo contador**. Consequências: login administrativo (10 tentativas/15 min) pode ser esgotado por qualquer terceiro e travar o administrador (negação de serviço); limites de comanda e pedidos deixam de ser por cliente. Mas o projeto decidiu não confiar em cabeçalhos *forwarded*. Proposta: variável explícita `TRUST_PROXY_HOPS` (inteiro, **padrão 0**), aplicada como `app.set('trust proxy', n)`, ativada só na homologação após **medir** quantos saltos o Render adiciona **[TESTAR]**. Nunca `true` genérico. Adicionar testes (0 hop ignora `X-Forwarded-For`; 1 hop usa o último IP confiável).

### 5.3 Base absoluta para imagens
`imageUrl()` precisa de base absoluta. Opção mínima: quando `API_BASE_URL` começar com `/`, usar `window.location.origin` como base. Alternativa sem código: `VITE_API_URL=https://<nome>.onrender.com/api` já no build (exige conhecer o nome antes do build; nome escolhido na criação do serviço). **Recomendo a correção em código** (robusta a trocar o nome).

### 5.4 Portão de acesso da homologação (ver §10)

### 5.5 Itens opcionais
* `/api/ready` com timeout de 2 s pode devolver 503 enquanto o Neon acorda (§7); aceitável (não usar `/api/ready` como *health check*), ou subir o timeout só em produção.
* Carregamento de segredos por variável de ambiente, **somente se** o modo de arquivo do Render não passar (§6.3).

Fora de qualquer mudança: as sete migrations (e seus checksums), `prisma-run`, gates de TLS/host, identidade do cluster, scripts SQL, bootstrap.

---

## 6. Banco de dados: Neon Free

### 6.1 Por que não o Render PostgreSQL Free
Expira **30 dias** após a criação (1 GB), sem backups [DOC]. Inadequado como banco duradouro, conforme decisão do proprietário.

### 6.2 Fatos do Neon Free [DOC: neon.com/docs/introduction/plans, /connect/connection-pooling, /manage/roles, /manage/databases, /reference/compatibility, /introduction/backup-restore, /connect/connect-securely]

| Tema | Fato |
|---|---|
| Custo | Free, sem mínimo; 100 projetos, 10 *branches*/projeto (branches extras não disponíveis no Free) |
| Compute | **100 CU-horas/projeto/mês**; autoescala até 2 CU (8 GB); **suspensão automática após 5 min, não desativável** |
| Armazenamento | **1 GB/projeto**, 20 GB no total da conta |
| Rede | 5 GB/projeto/mês de transferência pública |
| Limite atingido | Computação suspensa até o próximo ciclo; dados **não** são apagados |
| Conexões diretas | 0,25 CU → 104 (97 úteis); 2 CU → 839 |
| *Pooler* | PgBouncer em modo de transação; **sem** `SET`, `LISTEN/NOTIFY`, `PREPARE` SQL, tabelas temporárias, *advisory locks* de sessão; usar endpoint **direto** para migrations, `pg_dump` e sessão |
| Versões | Suporta PostgreSQL 14–18, escolhida na criação do projeto. **Se 17/18 podem ser escolhidas no Free: não declarado** |
| TLS | Obrigatório; `sslmode` require/verify-ca/verify-full; recomenda `verify-full` (certificado Let's Encrypt/ISRG Root X1, raiz pública) |
| Backup/restauração | Janela de histórico de **6 h** (até 1 GB de mudanças) e **1 *snapshot* manual** no Free; *backups* agendados **não** disponíveis; restauração instantânea só em *branch* raiz |
| IP Allow / Private Networking | **Não disponíveis** no Free (somente Scale) |
| Roles | `CREATE ROLE … LOGIN PASSWORD` via SQL é suportado; roles criadas por SQL **não** pertencem a `neon_superuser`; nomes `pg_*`, `neon_superuser`, `cloud_admin` etc. reservados; senha exige ~60 bits de entropia |
| Banco | `ALTER DATABASE … RENAME TO …` via SQL é suportado (de outro banco da mesma *branch*, encerrando conexões); proibido apenas dono `neon_superuser`; bancos `postgres`, `template0/1` reservados |
| Padrões | Projeto novo traz `neondb` e a role `neondb_owner` (membro de `neon_superuser`) |

### 6.3 Compatibilidade com a estratégia atual (replay + renomeação + marca) — **o ponto crítico**

| Requisito do projeto | Situação no Neon | Status |
|---|---|---|
| PostgreSQL ≥ 17 (migrations 3/5/6/7 e `serverIdentity`) | Existe 17/18; escolha no Free não declarada | **[TESTAR]** |
| TLS real (`pg_stat_ssl.ssl = true`) | TLS obrigatório; leitura de `pg_stat_ssl` não documentada | **[TESTAR]** (esperado OK) |
| `CREATE ROLE` das roles legadas e da marca `rustika_homolog_marker` (NOLOGIN) | Suportado por SQL | Provável OK **[TESTAR]** |
| `COMMENT ON ROLE rustika_homolog_marker …` e leitura por `shobj_description(oid,'pg_authid')` pela role de runtime | **Não documentado** | **[TESTAR]** — a identidade do servidor (`server.ts`) depende disso |
| Banco `cardapio_digital_test` com **dono** `cardapio_migrator` (guardas das migrations) | Dono não-`neon_superuser` permitido; `CREATE DATABASE … OWNER` por role sem superuser exige pertencer à role-dona (possível `GRANT cardapio_migrator TO neondb_owner WITH SET TRUE`) | **[TESTAR]** |
| Executor das migrations = `cardapio_migrator`; `ALTER DEFAULT PRIVILEGES FOR ROLE cardapio_migrator …`, `REVOKE … FROM PUBLIC` | Parte do PostgreSQL padrão; restrições do Neon a roles sem superuser possíveis | **[TESTAR]** |
| `ALTER DATABASE cardapio_digital_test RENAME TO cardapio_digital_homolog` (script 04) | Suportado; precisa rodar a partir de **outro** banco, sem conexões | Provável OK **[TESTAR]** |
| `ALTER ROLE … RENAME TO …` das 3 roles | **Não documentado** | **[TESTAR]** (bloqueio possível) |
| "Cluster dedicado e vazio": script 01 recusa bancos `cardapio_digital_*` e roles do projeto | Projeto Neon novo tem `neondb`/`neondb_owner`/`neon_*`; o script só recusa nomes do projeto | Provável OK; `neondb` é um banco extra tolerado pelo gate **[TESTAR]** |
| Identidade final: ausência de `cardapio_digital_dev/shadow`, sem roles legadas | Satisfeita se o replay for concluído e renomeado | OK por construção |
| Endpoint **direto**, mesmo host nos 4 perfis (`EXPECTED_DATABASE_HOST`) | Compatível; **não** usar `-pooler` (a lista de parâmetros não aceita `pgbouncer=true` e as migrations exigem sessão) | OK |
| `sslmode=require` + `sslaccept=strict` com certificado público | Prisma valida com raízes do sistema (Debian do Render tem `ca-certificates`) | **[TESTAR]**; risco já conhecido de o Prisma ignorar `verify-*` |
| *Cold start* do Neon (suspende em 5 min) | Primeira conexão acorda o compute; `connect_timeout` é parâmetro permitido | **[TESTAR]** com `connect_timeout=15`; verificar P1017/"server closed the connection" na primeira consulta após suspensão |
| Marca única copiável (UUID em comentário) | Mesmo risco já registrado; inalterado | Aceito para homologação |

**Conclusão:** o Neon Free **não está provado compatível nem provado incompatível**. Os três pontos mais prováveis de bloqueio são `ALTER ROLE RENAME` por role não-superuser, `COMMENT ON ROLE`/leitura da marca e o `OWNER` do banco transitório.

### 6.4 Estratégia de banco recomendada
1. **Ensaio de compatibilidade (próxima etapa, §14)** em um **projeto Neon descartável**, executando os scripts 01–04 e o replay das 7 migrations do jeito atual, sem tocar no código, e comparando `schema:fingerprint` com o obtido no CI efêmero (`diffSnapshots` vazio).
2. **Se passar**: usar o mesmo roteiro da §6 de `homologation-environment.md` contra o Neon (endpoint direto).
3. **Se algum passo falhar — adaptação futura, segura e auditável (apenas proposta):**
   * **Opção 1 (preferida)**: ajustar os scripts SQL de provisionamento (não as migrations) aos privilégios do Neon, ex.: `GRANT … WITH SET TRUE` ao dono do projeto, e documentar cada desvio.
   * **Opção 2**: gerar o banco final no CI efêmero (já provado) e **restaurar** por `pg_dump`/`pg_restore` no Neon, mantendo os registros reais de `_prisma_migrations` e comparando o fingerprint nos dois lados. Exige revisão própria (nomes de roles e ACLs precisam existir antes da restauração).
   * Em nenhum caso: alterar as sete migrations, `migrate resolve`, `db push`, `migrate reset` ou desligar gates.
4. **Backup**: janela de 6 h + 1 *snapshot* manual no Neon, **mais** `pg_dump -Fc` por endpoint direto, a partir da máquina do proprietário, para destino privado e cifrado (procedimento já documentado em `docs/restore-backup.md`). Como a homologação não tem dados reais, a recuperação de desastre aceitável é **recriar do zero** (roteiro reproduzível).
5. **Orçamento**: com *scale to zero* só o tempo ativo conta. Mesmo ativo todo o mês, 0,25 CU consome ≈ 180 CU-h (> 100), logo o uso contínuo 24 h estouraria; o padrão de uso intermitente cabe com folga **[INFERIDO]**.

---

## 7. Frontend: build e publicação

| Item | Valor |
|---|---|
| Build | `npm --prefix frontend ci` e `npm --prefix frontend run build` (inclui `tsc --noEmit`) |
| Saída | `frontend/dist` (Vite 6, `base` = `/`) |
| Variáveis de build (`VITE_*`, **públicas**: entram no bundle) | `VITE_CATALOG_MODE=api`; `VITE_API_URL=/api` (com a correção §5.3) ou URL absoluta; `VITE_ORDER_SUBMISSION` **ausente** (pedidos reais desabilitados) |
| Segredos | Nenhum `VITE_*` pode conter segredo. Nenhum é necessário. |
| Roteamento | Hash (`#admin`); sem *rewrite* |
| Cache | `index.html` sem cache; `assets/*` com hash → cache longo; JSON da API: ETag padrão do Express; sem service worker, a atualização do catálogo depende de nova consulta a cada carregamento |
| Playwright | Está em `devDependencies` do frontend; `npm ci` não baixa navegadores (download só com `playwright install`) → build leve **[TESTAR memória/tempo no Render]** |

---

## 8. Backend: build, start, runtime

* **Build Command** (raiz do repositório; *Root Directory* em branco; `getBackendRoot()` já aceita `cwd/backend`):
  ```
  npm --prefix frontend ci && npm --prefix frontend run build && npm --prefix backend ci && (cd backend && npx prisma generate) && npm --prefix backend run build
  ```
* **Start Command**: `cd backend && node dist/server.js` (**sem** migrations, bootstrap ou provisionamento).
* **Health check**: `/api/health`.
* **Node**: definir versão ≥ 20.19 (CI usa 22). Variável `NODE_VERSION=22` **[CONFIRMAR no painel; página de runtimes não lista]**.
* **Variáveis**: `NODE_ENV=production`, `DB_PROFILE=app-homolog`, `CORS_ORIGIN=https://<nome>.onrender.com` (sem barra final), `CARDAPIO_SECRETS_DIR=<pasta fora do repositório>`, `TRUST_PROXY_HOPS` (após §5.2). `PORT` vem do Render.
* **Segredos** (`app-homolog.env`: `DATABASE_URL`, `EXPECTED_DATABASE_HOST`, `EXPECTED_CLUSTER_ID`): o código exige **arquivo** com modo `600` e **fora** do workspace. O Render oferece *Secret Files*, mas a página oficial não pôde ser lida; caminho, dono e **modo** do arquivo são desconhecidos **[TESTAR]**. Se o modo não for ≤ 0600, a alternativa é aceitar variáveis de ambiente em produção (mudança de código revisada, sem relaxar as demais validações).
* **Ciclo de vida**: ao dormir/reiniciar, a próxima subida refaz a verificação de identidade do banco (acorda o Neon) antes de abrir a porta; falha ⇒ `process.exit(1)` (falha fechada, correto).
* **Sessões e limitadores em memória**: cada *spin-down*/reinício encerra login administrativo e sessões de comanda. Aceitável na homologação; **não** corrigir agora.
* **Risco de build**: `npm ci` baixa `xlsx` do CDN da SheetJS; se o CDN falhar, o build quebra. Mitigação futura: retirar `xlsx` das dependências do build (uso só em scripts) ou *vendorizar*.

---

## 9. Segurança (preservada e verificações necessárias)

| Controle | Estado |
|---|---|
| Repositório privado | Mantido; o Render precisa ser autorizado no GitHub **somente** para este repositório |
| HTTPS | Terminado no Render; cookies `Secure`; sem HTTP→HTTPS manual necessário **[TESTAR redirecionamento]** |
| CSRF/Origin | Inalterados; mesma origem ⇒ `Origin` = `CORS_ORIGIN` |
| Cookies | Admin: `HttpOnly; Secure; SameSite=Strict; Path=/api/admin`; comanda: `Lax; Path=/api` |
| Rate limit | **Depende de §5.2** |
| Banco | Sem exposição pública além do endpoint TLS do Neon; role de runtime com privilégios mínimos (sem `INSERT` em `admins`); migrator e bootstrap **fora** do runtime |
| Gates | Nenhum será desativado: TLS, host remoto, identidade do cluster, perfil `app-homolog`, `CORS_ORIGIN` https público |
| Segredos | Nada no bundle; arquivo de segredo fora do repositório; `.gitignore` já cobre `.env*` |
| Neon sem IP Allow | A senha forte + TLS são a única barreira de rede; usar senhas ≥ 24 caracteres (já exigido) e **nunca** a *connection string* completa em logs/painel de variáveis desnecessário |

---

## 10. Privacidade da homologação a custo zero

`onrender.com` é público e indexável. Não há evidência de *basic auth* nem *IP allow list* no Render Free **[não declarado]**; o Neon Free não oferece IP Allow. Proposta de camadas, todas gratuitas:

1. **Portão da homologação no próprio app** (nova etapa de código, §5.4): *middleware* HTTP Basic (credencial única longa, só por variável de ambiente/segredo), ativo quando `HOMOLOG_GATE=on`, cobrindo estáticos e `/api/*`, exceto `/api/health` (liveness sem dados). O navegador reenvia as credenciais Basic nas chamadas `fetch` da mesma origem; o cookie administrativo continua independente. Comparação em tempo constante, falha fechada, limitada por IP.
2. `X-Robots-Tag: noindex, nofollow` e `robots.txt` restritivo; nome do serviço longo e imprevisível.
3. Nenhum dado real, pedidos reais desabilitados (`VITE_ORDER_SUBMISSION` ausente) e **suspender o serviço** no painel quando não estiver em uso (a pausa manual não consome horas).
4. **Não** usar Cloudflare Access/Tunnel: exige domínio próprio (fora do orçamento).

---

## 11. Riscos operacionais

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| 1 | Estratégia de rename/marca não suportada no Neon | Bloqueio do banco | Ensaio em projeto descartável (§14); opção 2 da §6.4 |
| 2 | Rate limit global atrás do proxy | Lockout do admin / sem proteção | `TRUST_PROXY_HOPS` medido (§5.2) |
| 3 | *Cold start* em cascata (Render ~1 min + Neon) | Primeira requisição lenta; `/api/ready` 503; falha de `connect` | `connect_timeout=15`; não usar `/api/ready` como health check; documentar |
| 4 | Conexão ociosa cortada pela suspensão do Neon | Erro na primeira consulta | Testar P1017; ajustar `pool_timeout`/`connection_limit` |
| 5 | Modo do *Secret File* ≠ 0600 | API não sobe (falha fechada) | Alternativa por variável de ambiente (código revisado) |
| 6 | Sessões em memória | Re-login após cada despertar | Aceito na homologação |
| 7 | CDN do `xlsx` indisponível no build | Build falha | Mitigação futura |
| 8 | Cotas (750 h, banda, minutos de build, 100 CU-h) | Suspensão do serviço ou computação | Suspender quando ocioso; monitorar painéis; sem cartão ⇒ suspensão, não cobrança |
| 9 | Render pode reiniciar/suspender Free a qualquer momento | Indisponibilidade | Homologação sem clientes reais |
| 10 | Render e Neon podem mudar limites dos planos gratuitos | Planejamento desatualizado | Reconferir as páginas oficiais na implantação |
| 11 | Páginas oficiais do Render sobre *Secret Files* e IP do cliente indisponíveis (404) | Premissas não verificadas | Marcadas **[TESTAR]** |

---

## 12. Garantias de custo zero

* Render: **Web Service, tipo de instância "Free"**, explícito; sem disco, sem *cron job*, sem Postgres do Render, sem domínio, sem *Static Site* pago, **sem cadastrar forma de pagamento** (com cota excedida o serviço é suspenso, não cobrado [DOC]).
* Neon: plano **Free**, sem cartão; sem *branches* extras nem recursos pagos; um projeto para a homologação e outro descartável para o ensaio (limite de 100).
* Verificar no painel, antes de confirmar cada criação, o texto "Free"/"$0" e **abortar** se aparecer qualquer valor.
* Não usar créditos ou *trials* como solução permanente; nenhum tráfego artificial para impedir a suspensão.
* Aviso: os valores acima podem mudar; reconfirmar na implantação.

---

## 13. Roteiro futuro de implantação (**não executar agora**)

| # | Passo | Observação |
|---|---|---|
| 1 | Conta Render Free | Sem cartão; 2FA |
| 2 | Conectar GitHub privado | App do Render restrito a `caliluneto/rustika-cardapio-digital` |
| 3 | Criar Web Service (Free) | Repositório, branch `main`, runtime Node, região próxima do Neon |
| 4 | *Root Directory* | Em branco (raiz) |
| 5 | Build Command | §8 |
| 6 | Start Command | `cd backend && node dist/server.js` |
| 7 | Variáveis | §8; `CORS_ORIGIN` = URL real do serviço; portão de homologação |
| 8 | Banco | Projeto Neon (Free), PG 17/18, endpoint **direto**; roles/DB conforme §6 |
| 9 | Migrations | **Fora do start**, a partir da máquina do proprietário (ou workflow manual): `homolog:preflight` → `01`→`04` → `homolog:replay:deploy` → `homolog:migrate:status` → `schema:compare` (0) → `05`; confirmações explícitas |
| 10 | Bootstrap admin | `homolog:bootstrap-admin` (janela `06`/`07`/`08`), senha em TTY, nunca no *start* |
| 11 | HTTPS | Automático; validar cookie `Secure` |
| 12 | Acesso restrito | Portão (§10) ativo antes de divulgar a URL |
| 13 | Health/readiness | *Health check* `/api/health`; conferir `/api/ready` após o Neon acordar |
| 14 | Smoke tests | Catálogo, imagens, login admin, listagem de pedidos, disponibilidade; CSRF (Origin errada → 403); rate limit por cliente; cookie flags; `/api/orders` desabilitado |
| 15 | Rollback | Redeploy do commit anterior (2 últimos deploys no Free); migrations aditivas, sem `down` |
| 16 | Backup/restauração | Snapshot manual Neon + `pg_dump -Fc` por endpoint direto; restauração só em banco novo; ou recriar do zero |

---

## 14. Próxima implementação recomendada

Duas etapas independentes, nesta ordem, **sem criar conta ou recurso ainda**:

* **3D.5.3-B — Preparação de código para o Render (offline, testada em CI):** servir `frontend/dist` no Express; `TRUST_PROXY_HOPS` (padrão 0); correção de `imageUrl` com base relativa; portão de homologação; cabeçalhos de cache/robôs; testes de regressão; `render.yaml` opcional (com `plan: free` explícito); atualização de `docs/`.
* **3D.5.3-C — Ensaio de compatibilidade do Neon (exige o proprietário criar a conta/projeto descartável):** executar 01–04 + replay no Neon, medir `COMMENT ON ROLE`, `ALTER ROLE RENAME`, `OWNER`, `pg_stat_ssl`, versão 17/18, *cold start*, TLS do Prisma; fechar com o `schema:compare`. Só depois, **3D.5.3-D (deploy)**.

---

## 15. Critérios de aceite

1. `GET /` devolve o frontend; `/api/*` inexistente devolve JSON 404; `#admin` carrega.
2. Login administrativo por HTTPS com cookie `HttpOnly; Secure; SameSite=Strict`; logout limpa o cookie; `Origin` inválida → 403.
3. Rate limit por cliente real (prova com dois IPs distintos).
4. Imagens de produto carregam em origem única.
5. Servidor só abre a porta se a identidade do banco confere (TLS, marca, PG ≥ 17, banco final); caso contrário encerra.
6. `schema:compare` entre o CI efêmero e o Neon retorna 0; sete migrations com checksums originais; `_prisma_migrations` sem `resolve`.
7. Portão de homologação bloqueia acesso anônimo a páginas e API (exceto `/api/health`).
8. Pedidos reais desabilitados; nenhum dado real.
9. Nenhum custo: painéis Render e Neon em plano Free, sem cartão.
10. Suíte `test:ci`, `tsc` e build verdes; nenhuma etapa de migration/bootstrap no *start*.

---

## 16. Comprovado × a testar

**Comprovado (código lido):** comandos de build/start; escuta de `PORT`; `shutdown`; validações de produção; roteamento por hash; cookies e CSRF; ausência de `trust proxy`; rate limit por IP em memória; lista fechada de parâmetros da URL; segredos por arquivo `600` fora do workspace; `imageUrl` com `new URL` e base relativa; ausência de service worker.

**Documentado pelo fornecedor (leitura, não teste):** limites do Render Free e do Neon Free (§4, §6.2), exceto os itens "não declarado".

**Não comprovado — exige teste:** todas as linhas **[TESTAR]** da §6.3; modo e caminho dos *Secret Files* do Render; saltos de *proxy* e cabeçalhos de IP do Render; CPU real da instância; retenção de logs; PostgreSQL 17/18 no Neon Free; comportamento do Prisma após suspensão do compute; `sslaccept=strict` com a CA pública; memória/tempo do build no Render; `NODE_VERSION`; redirecionamento HTTP→HTTPS.

---

## 17. Observações finais

* Nenhum recurso foi criado; nenhuma conta aberta; nenhuma migration executada; nenhum banco acessado; nenhum commit ou push.
* Durante a pesquisa, uma das páginas de documentação consultadas pelo agente de leitura continha texto dirigido a assistentes de IA pedindo o envio de *feedback* a uma URL externa. **Foi ignorado** e nada foi enviado.
* As fontes são páginas oficiais (render.com/docs, neon.com/docs, neon.com/pricing e FAQ) consultadas em 06/11/2026; limites de planos gratuitos mudam com frequência e devem ser reconfirmados na implantação.
* Este relatório está pronto para auditoria antes da implementação.
