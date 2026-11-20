# RELATÓRIO DE ENTREGA — 3D.5.3-B.1
## Auditoria de segurança e preparação da publicação Render Free

Data: 2026-11-06 · Escopo: auditoria e correções pontuais locais. **Sem deploy, commit, push, migrations, PostgreSQL persistente ou Playwright. Render e Neon não foram tocados.**

---

## 1. Resultado da auditoria

**Resultado: APROVADO COM CORREÇÕES (5 correções de código aplicadas + 1 mitigação de configuração). Pronto para avaliação antes da publicação.**

| Item auditado | Resultado |
|---|---|
| Portão HTTP Basic desligado por padrão | OK — só ativa com `HOMOLOG_GATE=on`; em produção com frontend e sem portão, o servidor emite aviso (sem valores) |
| Credenciais fora de logs | OK — comparação SHA-256 + `timingSafeEqual`; nada é logado; teste de não vazamento no 429 |
| Rate limit por IP | OK — 10 falhas/15 min por cliente; a 11ª tentativa recebe 429 mesmo com a senha certa; ausência de cabeçalho não conta |
| X-Forwarded-For / `TRUST_PROXY_HOPS` | OK — padrão 0 (XFF ignorado); validação 0–5 `/^\d{1,2}$/`; IPv6 agrupado em /64; testes com 0 e 1 salto |
| Cookies / Origin / CSRF | OK — inalterados (CORS exato, cookies `secure` em produção/https, `X-Rustika-Request`); portão fica à frente, sem substituí-los |
| noindex | OK — `X-Robots-Tag: noindex, nofollow, noarchive` quando o portão está ativo |
| Exceção de health | **Corrigido (P2)** — só `GET/HEAD /api/health`; `/api/ready` passa pelo portão |
| Path traversal / arquivos internos | OK — `.env`, `.map`, `.key`, `.pem`, `.sql`, `.log`, dotfiles, `%2e`, `%00`, `..%2f`, `..%5c` → 400/403/404 sem conteúdo |
| Segredos por ambiente | OK — `CARDAPIO_SECRETS_SOURCE=env` só no perfil `app-homolog`; valores diferentes de `env` não desligam a validação |
| Gates de TLS, papéis, identidade do PostgreSQL | Preservados (todas as validações de URL/host/TLS/UUID permanecem no modo env) |
| Comandos de build integrados | **Corrigido (P1)** — ver seção 2 |
| Backend encontra `frontend/dist`; rotas `/api` corretas | OK — ordem API → estáticos → 404; `/api` desconhecido nunca recebe HTML |
| Sete migrations históricas | Intactas (`diff -rq` idêntico; migration-integrity OK) |
| Varredura de segredos | Limpa |

---

## 2. Problemas encontrados

- **P1 — Build quebra em produção.** Com `NODE_ENV=production` o `npm ci` omite devDependencies (TypeScript, Vite, Prisma CLI) → build falha (reproduzido: EXIT=1).
- **P2 — `/api/ready` isento do portão.** Consulta o banco; aberto, permitiria a terceiros manter o compute do banco ativo (custo/consumo de CU-h).
- **P3 — Cache público de conteúdo autenticado.** Arquivos estáticos atrás do portão saíam com `Cache-Control: public`, permitindo cache compartilhado de conteúdo autenticado.
- **P4 — `env.ts` resolvia/validava a pasta de segredos mesmo com `CARDAPIO_SECRETS_SOURCE=env`**, falhando no Render (sem pasta de segredos).
- **P5 — `sendFile` negava o `index.html`** quando o diretório publicado tem um ancestral com ponto (ex.: `/home/runner/.cache/...`).
- **P6 — Node 24 / npm ≥ 12 recusa o tarball remoto `xlsx` (EALLOWREMOTE).** Exige fixar `NODE_VERSION=22`.

---

## 3. Correções necessárias (aplicadas)

- **C1** — Build Command com `npm ci --include=dev` (frontend e backend).
- **C2** — `HEALTH_EXEMPT_PATHS` reduzido a `/api/health`; Health Check do Render passa a ser `/api/health`.
- **C3** — `createStaticFrontend(root, { privateCache })`: com portão ativo, `private, max-age=…`; sem portão, `public`.
- **C4** — `env.ts`: `secretsDir` vazio quando `CARDAPIO_SECRETS_SOURCE` for exatamente `env`.
- **C5** — `sendFile('index.html', { root, dotfiles: 'deny' })` (a verificação de dotfiles passa a valer só dentro da raiz).
- **C6 (configuração)** — `NODE_VERSION=22` obrigatório no Render.

Arquivos de código alterados nesta etapa: `backend/src/security/homologGate.ts`, `backend/src/web/staticFrontend.ts`, `backend/src/app.ts`, `backend/src/config/env.ts` (+ testes).

---

## 4. Testes aprovados

- Backend (`npm run test:ci`): **1057 aprovados, 8 ignorados, 0 falhas**.
- Frontend: **161 aprovados**.
- Typecheck: apenas os **2 erros pré-existentes** (não relacionados), nenhum novo.
- Builds backend e frontend: OK. migration-integrity: OK. `diff -rq` das migrations: idêntico.
- Novos/atualizados: `web-hosting` (11), `web-gate-proxy`, `config/web-config`, `config/secrets-env-source`, `config/env-secrets-source`, `catalog-image-url`.
- **Cópia limpa**: sem `--include=dev` → EXIT=1; com `--include=dev` → EXIT=0 (~70 s).
- **HTTP real sobre `dist` compilado**: portão 401/200; `/api/ready` 401 sem credenciais; 404 JSON para `/api` desconhecido, caminhos inexistentes, `.env` e traversal; cabeçalhos `private` com portão.
- **Boot fail-closed** (`node dist/server.js`): identidade do banco inverificável → saída 1; senha do portão curta → erro de configuração; `frontend/dist` ausente → `FrontendBuildMissingError`; portão desligado → aviso.
- Varredura de segredos: limpa.

---

## 5. Comandos finais do Render

Web Service `rustika-homolog` · Free · branch `main` · Root Directory **vazio** · Auto-Deploy **Off** · Health Check Path `/api/health`.

**Build Command**
```bash
NODE_OPTIONS=--max-old-space-size=400 npm --prefix frontend ci --include=dev --no-audit --no-fund && NODE_OPTIONS=--max-old-space-size=400 npm --prefix frontend run build && cd backend && npm ci --include=dev --no-audit --no-fund && npx prisma generate && NODE_OPTIONS=--max-old-space-size=400 npm run build
```

**Start Command**
```bash
cd backend && node dist/server.js
```

**Variáveis de ambiente**

| Variável | Valor |
|---|---|
| `NODE_VERSION` | `22` (obrigatória) |
| `NODE_ENV` | `production` |
| `DB_PROFILE` | `app-homolog` |
| `CORS_ORIGIN` | `https://<URL exata do serviço>` |
| `SERVE_FRONTEND` | `on` |
| `TRUST_PROXY_HOPS` | `0` (ver R1) |
| `HOMOLOG_GATE` | `on` |
| `HOMOLOG_GATE_USER` | usuário (3–64, `[A-Za-z0-9._-]`) |
| `HOMOLOG_GATE_PASSWORD` | senha ≥ 24 caracteres, sem conter o usuário |
| `VITE_CATALOG_MODE` | `api` |
| `VITE_API_URL` | `/api` |
| `CARDAPIO_SECRETS_SOURCE` | `env` |
| `RUSTIKA_HOMOLOG_DATABASE_URL` | (segredo) |
| `RUSTIKA_HOMOLOG_EXPECTED_DATABASE_HOST` | (segredo) |
| `RUSTIKA_HOMOLOG_EXPECTED_CLUSTER_ID` | (segredo) |

**Não definir** `VITE_ORDER_SUBMISSION`. Valores sensíveis são digitados pelo titular no painel do Render; nunca em chat, repositório ou relatório.

---

## 6. Arquivos para publicação (manifesto `manifest-3d53b-transfer.txt`, 17 itens)

Backend: `src/app.ts`, `src/server.ts`, `src/config/env.ts`, `src/config/secrets.ts`, `src/config/webConfig.ts`, `src/security/homologGate.ts`, `src/web/staticFrontend.ts`.
Testes backend: `tests/web-hosting.test.ts`, `tests/web-gate-proxy.test.ts`, `tests/config/web-config.test.ts`, `tests/config/secrets-env-source.test.ts`, `tests/config/env-secrets-source.test.ts`.
Frontend: `src/services/catalogAdapter.ts`, `tests/catalog-image-url.test.mjs`, `package.json`.
Relatórios: `RELATORIO-ENTREGA-3D.5.3-B.md`, `RELATORIO-ENTREGA-3D.5.3-B.1.md`.

Comparação original × snapshot (somente esses arquivos diferem): `app.ts` 13 linhas, `server.ts` 12, `env.ts` 3, `secrets.ts` 63, `catalogAdapter.ts` 37, `package.json` 2; demais são arquivos novos. Sete migrations idênticas.

**Não publicar:** arquivos soltos do repositório original (`backend/c.js`, `check_db.js`, `apply_mig.js` etc.) e qualquer `.env`.

---

## 7. Riscos restantes

- **R1** — Número de saltos de proxy do Render não confirmado: com `TRUST_PROXY_HOPS=0` todos os clientes compartilham o mesmo balde de bloqueio do portão (10 falhas bloqueiam todos por 15 min). Confirmar na primeira execução e ajustar para 1.
- **R2** — Estratégia Neon (replay das 7 migrations, renomear banco/papéis, papel-marcador, `COMMENT ON ROLE`, `pg_stat_ssl`, `sslaccept=strict`, versão do PostgreSQL) **não comprovada**.
- **R3** — Secret Files/modos de arquivo no Render não verificados (por isso a opção `env`).
- **R4** — Reenvio automático das credenciais Basic pelo navegador em chamadas `fetch` same-origin não verificado em browser real.
- **R5** — Tempo e memória do build no Render Free (512 MB) não medidos.
- **R6** — Sessões em memória: reinício/spin-down (15 min) derruba sessões e limites.
- **R7** — Endurecimento de `imageUrl` pode rejeitar URLs relativas antes aceitas; validar visualmente.
- **R8** — `/api/health` expõe `uptime`/`timestamp` (baixo risco; única rota isenta).
- **R9** — Cold start (~1 min) e suspensão por limites do plano; sem tráfego artificial.
- **R10** — Arquivos soltos no repositório original não devem ser publicados.

---

## 8. Próxima etapa recomendada

1. Avaliação deste relatório pelo ChatGPT/titular.
2. Com aprovação: publicar os 17 itens no snapshot (commit `feat(web): prepare single-service Render hosting`, `git push --no-tags origin main:main`) — **não executado**.
3. **3D.5.3-C** — ensaio de compatibilidade Neon (conta do titular).
4. **3D.5.3-D** — deploy no Render, primeira verificação do número de saltos de proxy e do reenvio de credenciais Basic.
5. Só então a homologação real; nenhuma aprovação é declarada sem execução real.
