# Jornada E2E real no PostgreSQL Test — 3D.3.21-B

> 3D.3.23-E: a limpeza do resíduo legado (comanda 999999) foi executada e validada; o passo 2 das pré-condições está cumprido. 3D.3.25-A: execução alternativa em runner descartável do GitHub Actions: ver `github-actions-e2e.md`.

**Estado (3D.3.30):** a jornada **foi executada e aprovada no GitHub Actions** (CI #5, PostgreSQL 18 efêmero no runner,
1 teste Playwright em 8,6 s, teardown e resíduo zero confirmados; ver `github-actions-e2e.md`). **Neste notebook ela
continua NÃO executada**: qualquer execução local escreve em `cardapio_digital_test` e exige autorização específica.
O texto abaixo descreve o fluxo local e as proteções, que valem também para o CI.

## O que mudou em relação ao E2E antigo

| Antes (`seed_raw.js`) | Agora (`tests/integration-db/e2e`) |
| --- | --- |
| `DELETE FROM` sem filtro em pedidos, itens, histórico, sessões e convites | Nenhuma exclusão global; só as linhas da própria execução |
| Credencial embutida no arquivo | Role `cardapio_test_fixtures` pelo mecanismo de segredos existente (`fixtures-test.env`) |
| Sem teardown (resíduo permanente) | Manifesto + teardown cirúrgico + prova de resíduo zero |
| IDs e comanda fixos (`999999`), reabertos por `ON CONFLICT DO UPDATE` | Identificadores por execução (`runId`), faixa de comandas reservada, nada preexistente é alterado |
| Sem checagem de ambiente | Preflight completo do harness aprovado (banco, 7 migrations + checksums, ACL efetiva, sondagem do `pg_hba`, advisory lock) |
| Servidores reaproveitados, portas 4000/5173 | `reuseExistingServer: false`, portas isoladas 4100/5174 |

`backend/seed_raw.js` foi **preservado sem alteração** para análise (não é mais invocado por nada). Não o execute.

## Configuração exata da instância de teste

| Item | Valor |
| --- | --- |
| Banco | `cardapio_digital_test`, 127.0.0.1:5432 (só loopback) |
| Runtime (backend do E2E) | `cardapio_test_app`, `NODE_ENV=test`, `DB_PROFILE=app-test` (exatos, sem espaço) |
| Fixtures | `cardapio_test_fixtures` (`CONNECTION LIMIT 2`, `connection_limit=1` no cliente), isolada pelo `pg_hba.conf` |
| Backend | `npx tsx src/server.ts` em `../backend`, `PORT=4100`, `CORS_ORIGIN=http://localhost:5174` |
| Frontend | `npx vite --port 5174 --strictPort`, `VITE_API_URL=http://localhost:4100/api`, `VITE_ORDER_SUBMISSION=enabled` **somente aqui**, `VITE_CATALOG_MODE=api` |
| Servidores | `reuseExistingServer: false`: porta ocupada = falha imediata |
| Estado da execução | `%TEMP%\rustika-e2e\<runId>.e2e-manifest.json` (fora do repositório e do OneDrive; só ids, sem senha) |

## Variáveis de ambiente (as quatro confirmações são exigidas)

```powershell
$env:NODE_ENV = 'test'                      # exatamente "test"
$env:DB_PROFILE = 'app-test'                # exatamente "app-test"
$env:RUSTIKA_DB_INTEGRATION = '1'
$env:RUSTIKA_DB_INTEGRATION_CONFIRM = 'WRITE_CARDAPIO_DIGITAL_TEST'
$env:RUSTIKA_E2E_CONFIRM = 'RUN_E2E_ON_CARDAPIO_DIGITAL_TEST'
```

Não podem existir: `DATABASE_URL`, `SHADOW_DATABASE_URL`, `CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION`. O
`playwright.config.ts` recusa carregar sem `RUSTIKA_E2E_CONFIRM`, antes de subir qualquer servidor.

## Pré-condições (todas verificáveis; pare se alguma falhar)

1. **Credenciais: decisão do usuário (05/11/2026) — manter as atuais; a rotação NÃO é pré-requisito.**
   `npm run secrets:audit` seguirá acusando `FAIL` (senha compartilhada por três roles e curta/numérica);
   isto é um **risco residual aceito**, registrado em `RELATORIO-ENTREGA-3D.3.22-C.md`. Nada no código do
   E2E exige a rotação. Procedimento em `secrets-rotation.md` mantido apenas como referência.
2. **Resíduo do E2E antigo removido** (a comanda `999999` do `seed_raw.js` é uma colisão e bloqueia o
   preflight): primeiro `npm run e2e:cleanup-legacy` (dry-run), depois `-- --execute` com autorização.
3. `npm run e2e:inspect` (somente leitura): 7 migrations concluídas (a 6ª e a 7ª só existem após a aplicação autorizada), `orders` = 0, resíduo legado = 0,
   sem sessões de `cardapio_test_app`/`cardapio_test_fixtures`, sem advisory locks.
4. Portas 4100 e 5174 livres (`Get-NetTCPConnection -LocalPort 4100,5174 -State Listen` vazio).
5. Nenhum manifesto remanescente em `%TEMP%\rustika-e2e`.
6. Backup do Test recente e com SHA-256 conferido (`restore-backup.md`).
7. Memória livre razoável (a 3D.3.21-A mediu 705 MB livres e uma queda do Node por falta de memória).

## Sequência da execução (autorização única, todas as etapas em ordem)

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
npm run e2e:inspect                              # 1. estado inicial (somente leitura)
npm run e2e:cleanup-legacy                       # 2. dry-run do resíduo legado (lista, não apaga)
$env:RUSTIKA_E2E_LEGACY_CLEANUP = 'ERASE_LEGACY_E2E_FIXTURES'
npm run e2e:cleanup-legacy -- --execute          #    apaga SOMENTE os ids fixos do seed_raw.js
Remove-Item Env:RUSTIKA_E2E_LEGACY_CLEANUP
npm run e2e:inspect                              # 3. confirma resíduo legado = 0

cd ..\frontend
npx playwright test                              # 4. setup -> jornada -> teardown (verificação + limpeza)

cd ..\backend
npm run e2e:inspect                              # 5. estado final: tudo como em (3)
Remove-Item Env:NODE_ENV, Env:DB_PROFILE, Env:RUSTIKA_DB_INTEGRATION, Env:RUSTIKA_DB_INTEGRATION_CONFIRM, Env:RUSTIKA_E2E_CONFIRM
```

### O que o `npx playwright test` faz

1. **Config:** recusa carregar sem confirmação; sobe backend (4100) e Vite (5174) novos.
2. **globalSetup → `run-setup.ts`:** gates; falha se houver manifesto anterior; preflight completo;
   grava o manifesto (`pending`) **antes** de escrever; cria numa transação o admin sintético, a categoria
   pública, os produtos, a comanda fechada e o convite expirado; completa o manifesto (`provisioned`);
   devolve ao Playwright (stdout, só em memória) e-mail, senha efêmera, comanda, produto e preço.
3. **Jornada (`e2e.spec.ts`):** login admin → convite para a comanda reservada → resgate pelo cliente →
   produto sintético no carrinho → revisão → "Prosseguir para envio" → botão **habilitado** (falha aqui,
   com a causa à vista, se o envio estiver desligado) → clique real.
4. **Verificação do POST:** `POST /api/orders` com `X-Rustika-Request: 1`, `Idempotency-Key` UUID v4,
   `Content-Type: application/json`, cookie `rustika_session` e `Origin` exata; resposta **HTTP 201**,
   `comandaNumber` igual à comanda reservada e `totalInCents` igual ao preço do produto; estado de
   sucesso "Pedido recebido" sem erro visível.
5. **Idempotência:** o mesmo POST reenviado (mesma chave e corpo) devolve **HTTP 200** e o mesmo
   `orderNumber`.
6. **globalTeardown → `run-teardown.ts`** (roda também se a jornada falhar):
   - lê e valida o manifesto (rejeita adulteração);
   - preflight; compara o que a identidade da execução encontra com o manifesto (qualquer registro
     que o manifesto não explique aborta **antes** de apagar);
   - **verificação somente leitura do pedido persistido:** exatamente 1 pedido na comanda; status
     `RECEIVED`; cliente `E2E Customer`; total = preço × 1; 1 item com a chave pública do produto,
     quantidade 1, preço e subtotal corretos; histórico inicial `null → RECEIVED`; chave e digest de
     idempotência com 64 hexadecimais; 1 convite consumido com sessão ativa;
   - remove somente as linhas da execução, filho antes de pai, numa transação; prova resíduo zero;
   - só então apaga o manifesto.

## Condições de parada (nenhuma é contornável por flag)

| Situação | Efeito |
| --- | --- |
| Variável de confirmação ausente, `NODE_ENV`/`DB_PROFILE` com espaço ou valor errado | config/setup recusam; nada sobe, nada é escrito |
| Porta 4100 ou 5174 ocupada | Playwright falha ao iniciar o servidor |
| Preflight reprovado (banco, role, 7 migrations/checksums, ACL, `pg_hba`, lock, resíduo, colisão) | setup aborta antes de escrever |
| Manifesto anterior presente | setup aborta antes de abrir o banco |
| Botão "Enviar pedido" desabilitado | jornada falha ali |
| POST ≠ 201 ou replay ≠ 200 | jornada falha com status e corpo |
| Banco contém registro da execução que o manifesto não descreve | teardown aborta **sem apagar**, manifesto mantido, exit 2 |
| Resíduo após a limpeza | teardown falha, manifesto mantido |
| Verificação do pedido falhou | fixtures removidas, mas o teardown falha (exit 3) com os motivos |

Em estado incerto **não** limpe à mão: investigue com `npm run e2e:inspect` e, só então, rode
`npm run e2e:teardown` (mesmas travas). Sem manifesto, não há limpeza por varredura.

## Preservação dos outros bancos e dos dados preexistentes

- A role de fixtures só conecta em `cardapio_digital_test` (regras do `pg_hba.conf`); o preflight tenta
  conectar nos demais bancos e aborta se algum aceitar. `cardapio_test_app` só tem `CONNECT` no Test.
- Nenhuma tabela é truncada, nenhuma sequência alterada; a numeração dos pedidos avança (lacuna esperada).
- Testes com mocks (`tests/e2e-fixtures.test.ts`, 70+ casos) provam que linhas preexistentes — dados
  reais, resíduo de outra execução, E2E legado, comanda 999999, faixa de comandas de outra execução —
  **não** são removidas, e que uma chave estrangeira violada reverte a transação inteira.

## Operação de pedidos na jornada (opt-in, 3D.4.1)

`RUSTIKA_E2E_ORDER_OPS=enabled` (ambiente do setup) acrescenta o passo 7 da jornada (admin vê o pedido, move para IN_PREPARATION, conflito 409 e transição 422 rejeitados). O teardown passa a exigir IN_PREPARATION e dois históricos. Sem a variável nada muda. **Preparado, não executado**; detalhes em `docs/order-operations.md`.
