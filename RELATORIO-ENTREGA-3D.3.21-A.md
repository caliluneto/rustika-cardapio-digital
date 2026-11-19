# RELATÓRIO DA ENTREGA 3D.3.21-A

Diagnóstico da falha real no checkout E2E

Data: 04/11/2026 (America/Sao_Paulo)
Executor: Claude Code (Windows 11, Node v24.20.0, PostgreSQL 18.6)

**Parecer: 3D.3.21-A — CORREÇÃO PREPARADA, NOVO E2E AGUARDANDO AUTORIZAÇÃO.**

Classes: **[EXEC]** executado nesta entrega · **[LEITURA]** consulta real somente leitura ao PostgreSQL Test · **[INSP]** inspeção de código/arquivo · **[INFERÊNCIA]** conclusão deduzida, não observada diretamente.

Não executado: nova jornada E2E, qualquer escrita em banco, limpeza de fixtures, migration, Seed, alteração de role, ACL ou `pg_hba.conf`, `git add`, commit, push. Nenhum processo foi encerrado (os processos antigos encontrados estão listados na seção 6).

---

## 1. Resultado das execuções já iniciadas

### 1ª execução (falhou) [EXEC, artefatos em disco]

| Item | Valor |
|---|---|
| Resultado | `status: failed`, 1 teste falho (`.last-run.json`, 20:25:22) |
| Teste | `e2e.spec.ts › E2E Real Journey › Complete flow` |
| Erro | `#checkout-title`: esperado "Pedido recebido", recebido "Enviar pedido" (33 tentativas em 15 s) |
| Passos concluídos antes da falha | login admin, emissão de convite, resgate, carrinho, revisão e "Prosseguir para envio" (o spec só chega ao passo seguinte se cada um deu certo) |

### 2ª execução (sem rastro) [EXEC]

O resultado dela **não pode ser determinado**, e não o afirmo. O que o estado do sistema comprova:

- nenhum processo do runner do Playwright vivo (só os do MCP); portas 4000 e 5199 fechadas;
- nenhum artefato em `test-results/` depois das 20:25:22;
- nenhum dado no banco posterior à primeira execução: o convite foi criado às 20:24:50 e a sessão às 20:24:51. O `seed_raw.js` apaga convites e sessões a cada execução; uma segunda execução que tivesse chegado ao login teria deixado um convite mais novo;
- nenhum log salvo: busquei em todas as saídas de tarefas do dia.

**[INFERÊNCIA]** a segunda execução não chegou a emitir convite. Exit code, aprovados/falhos, respostas HTTP e limpeza dela: **desconhecidos**.

Limpeza: nenhuma ocorreu em nenhuma execução (o `globalSetup` não tem `globalTeardown`). Pedidos persistidos: **0** (seção 5).

---

## 2. Causa da falha

Classificação pedida na etapa 2: a falha ocorreu **(1) antes do `POST /api/orders`**. O envio foi **desligado pelo ambiente**: o botão "Enviar pedido" estava desabilitado e `handleSubmit` retorna em silêncio quando o envio está desligado (`if (!enabled || !sessionUsable || sending) return;`). Não houve chamada HTTP, nem rejeição da API, nem erro de renderização.

Há **duas causas independentes**; qualquer uma bastava para o envio ficar desligado:

### Causa B (defeito de código, demonstrado)

`orderSubmissionEnabled()` lia a variável por um alias: `const meta = import.meta; meta.env?.VITE_ORDER_SUBMISSION`. O Vite só injeta `import.meta.env = {...}` em módulos que contêm o texto literal `import.meta.env`. Provas [EXEC]:

| Prova | Resultado |
|---|---|
| Módulo `orderSubmission.ts` servido pelo Vite antigo | `const meta = import.meta;` e **nenhuma** linha `import.meta.env = ` |
| Instância **nova** do Vite (porta 5199) com `VITE_ORDER_SUBMISSION=enabled` no ambiente | mesmo resultado: sem injeção, em `orderSubmission.ts` e em `api.ts` |
| Controle: `useCatalog.ts`, que usa a forma literal | injeção presente |

Consequência: **`VITE_ORDER_SUBMISSION=enabled` nunca teve efeito**, por mais correto que fosse o comando. O mesmo vale para `VITE_API_URL` em `api.ts` (inofensivo hoje porque o valor padrão coincide com o usado).

A tentativa de contorno no teste (`window._E2E_FORCE_ENABLED = true` depois que o diálogo já tinha renderizado, `removeAttribute('disabled')` e `click({ force: true })`) também não poderia funcionar: o clique dispara `handleSubmit`, que lê o `enabled` da renderização anterior (falso), e nada força nova renderização.

### Causa A (infraestrutura do teste, demonstrada)

O Playwright reaproveitou um Vite **antigo**, em vez de iniciar o dele (`reuseExistingServer: !process.env.CI`):

- PID 20708, **573 minutos de vida** quando medi (iniciado por `cmd /c vite`, sem as variáveis do E2E);
- o `env` injetado por ele, observado em `useCatalog.ts`, é `{"BASE_URL","DEV","MODE","PROD","SSR"}`: **nenhuma variável `VITE_*`**.

Mesmo depois de corrigir a causa B, esse servidor teria mantido o envio desligado.

### Defeito relacionado: `NODE_ENV` com espaço no fim (segurança) [EXEC]

O comando do backend usava `set NODE_ENV=test && set DB_PROFILE=app-test && ...`. No `cmd.exe` isso grava `"test "` e `"app-test "`, o que provei executando o mesmo comando. Como `env.ts` não normalizava o valor, a trava `NODE_ENV=test exige DB_PROFILE=app-test` **ficava desligada**. Demonstração sem tocar em banco:

| Entrada | Resultado |
|---|---|
| `NODE_ENV='test'` + `DB_PROFILE='app-dev'` | recusado |
| `NODE_ENV='test '` + `DB_PROFILE='app-dev '` | **aceito (`app-dev`)** |

Nesta execução o perfil acabou sendo `app-test`, e o `loadDatabaseProfile` só acessa o banco do perfil, então **não há indício de acesso ao Dev**; o banco Test confirma que só ele foi usado (seção 5). Mas a proteção estava desativada sem ninguém perceber.

## 3. Resposta HTTP observada

**Nenhuma.** O `POST /api/orders` não foi emitido. Evidências: `orders`, `order_items` e `order_status_history` com 0 linhas; o spec não detectou nenhum `.admin-error`; o título ficou em "Enviar pedido". Os `console.log` de rede do spec foram para o terminal e não foram salvos, então não há captura de rede: a conclusão se apoia no banco, no código e no `error-context.md`.

## 4. Estado da sessão [LEITURA]

| Item | Valor |
|---|---|
| Convite (comanda 999999) | criado 20:24:50, **consumido**, não revogado |
| Sessão de comanda | criada 20:24:51, expira **05/11 04:24:51**, não revogada |
| Cookie | existia só no navegador do Playwright, já descartado; no banco só há o hash. A sessão residual não é utilizável por ninguém |

Login, convite e resgate **funcionaram**, o que confirma cookies, `Origin` e `X-Rustika-Request` nessas três rotas.

## 5. Estado do banco Test [LEITURA]

Consulta em transação `READ ONLY` (`cardapio_migrator`, `current_database() = cardapio_digital_test`, PG 18.6, `transaction_read_only = on`), feita **antes** de qualquer edição minha:

| Verificação | Resultado |
|---|---|
| Migrations | 5 aplicadas, todas concluídas e não revertidas |
| `orders` / `order_items` / `order_status_history` | **0 / 0 / 0**: nenhum pedido persistido |
| Fixtures do E2E | 1 admin `e2e@rustika.local`, 1 categoria, 1 produto, 1 comanda `999999` |
| Convites / sessões | 1 / 1 (seção 4) |
| Resíduos de outras suítes | 0 (`fixture-3d39-%`) |
| Sessões de outros clientes | 4 do `cardapio_migrator` (`psql`, ociosas desde 15:10 a 15:17) e 1 do `postgres`; **nenhuma** de `cardapio_test_app` nem `cardapio_test_fixtures` |
| Advisory locks / transações preparadas | 0 / 0 |

Banco Dev: não acessado por nenhum comando desta entrega.

---

## 6. Segurança: itens da etapa 3

| Item | Situação |
|---|---|
| `NODE_ENV=test` | **valor era `"test "`**: corrigido (seção 7) |
| `DB_PROFILE=app-test` | era `"app-test "`; o perfil é aparado, então valeu `app-test` |
| Backend no `cardapio_digital_test` | sim, pelo perfil `app-test` (o banco só tem sessões do migrator ociosas; nenhuma conexão de runtime no momento) |
| `VITE_ORDER_SUBMISSION=enabled` só na instância E2E | sim: só em `playwright.config.ts`; nenhum `.env` versionável o liga (testado) |
| Cookies e `Origin` | corretos: o resgate (cookie `rustika_session`) funcionou entre 5173 e 4000 |
| `X-Rustika-Request`, `Idempotency-Key` UUID v4 | implementados em `api.ts`; **agora o spec os confere** no POST real |
| Sessão de comanda ativa | sim (seção 4) |
| Nenhum acesso ao Dev | nenhum indício; a guarda estava desligada por acaso e foi restaurada |

**Achados fora do escopo, só registrados, sem alteração:**

1. **`backend/seed_raw.js` (usado pelo `globalSetup`) faz `DELETE FROM` sem filtro** em `order_status_history`, `order_items`, `orders`, `comanda_sessions` e `comanda_invitations` do Test a cada execução. Apagaria qualquer pedido ou sessão de outra suíte. Usa a role `cardapio_test_fixtures` e **tem a string de conexão embutida no arquivo**.
2. Há pelo menos **10 scripts soltos em `backend/`** com credencial embutida (`check_*.js`, `db-check.js`, `db-dumper.js`, `seed_e2e.js`, `seed_pg.js`, `seed_raw.js`...), não ignorados pelo Git. Entrariam no checkpoint.
3. Processos antigos ainda vivos: Vite PID 20708 (porta 5173, 573 min); `vitest run` PIDs 20396 e 20264 (cerca de 590 min); `vitest tests/integration-db/comandas.integration.ts` PIDs 35328/27780 e `run_vitest.js` PID 7316 (159 min). Nenhum deles tem conexão de runtime ou de fixtures no banco. Consomem memória: **705 MB livres de 8 GB** e 34 processos `node`.
4. `playwright` entrou em `devDependencies` do frontend (correto) e `pg` em `dependencies` do backend, ainda sem commit.

---

## 7. Arquivos modificados [EXEC]

| Arquivo | Estado | Mudança |
|---|---|---|
| `frontend/src/services/orderSubmission.ts` | modificado | Remove o desvio `window._E2E_FORCE_ENABLED` / `window.process`; lê `import.meta.env` pela forma literal como parâmetro padrão de `orderSubmissionEnabled(env)` |
| `frontend/src/services/api.ts` | modificado | Mesma correção em `configuredApiUrl(env)` (agora exportada) |
| `frontend/src/vite-env.d.ts` | modificado | Declara `VITE_API_URL`, `VITE_ORDER_SUBMISSION` e `VITE_CATALOG_MODE` em `ImportMetaEnv` |
| `backend/src/config/env.ts` | modificado | `NODE_ENV` com `.trim()` |
| `frontend/playwright.config.ts` | novo (não rastreado) | Variáveis por `env`, `cwd`, readiness por URL, `reuseExistingServer: false`, `workers: 1`, sem variáveis `RUSTIKA_*` no servidor |
| `frontend/tests/e2e.spec.ts` | novo (não rastreado) | Sem atalhos; exige o botão habilitado e confere o POST (cabeçalhos, 201) |
| `frontend/tests/vite-env-injection.test.mjs` | **novo** | 4 testes (seção 8) |
| `frontend/tests/e2e-guard.test.mjs` | **novo** | 5 testes (seção 8) |
| `frontend/package.json` | modificado | Os dois testes novos no script `test` |
| `backend/tests/config/env.test.ts` | modificado | +2 testes |

Nenhuma migration, rota, serviço, autenticação, CSRF, idempotência ou permissão foi alterada. **Lapso meu:** `playwright.config.ts` e `e2e.spec.ts` eram arquivos não rastreados e os sobrescrevi sem guardar cópia antes. O conteúdo antigo está preservado de forma parcial no `error-context.md` (código do spec) e na seção 2 (os comandos). Não há perda funcional, pois a versão nova substitui as duas por completo.

Fora desta entrega e sem relação com ela: `frontend/src/components/Header.tsx` aparece modificado; não o alterei e não verifiquei a origem.

## 8. Correções e testes locais [EXEC]

| Teste | Cobre |
|---|---|
| `vite-env-injection` (4) | só `"enabled"` (com trim) liga o envio; nenhum desvio em `window` liga; `configuredApiUrl`; **o próprio Vite (API, sem porta) injeta `VITE_ORDER_SUBMISSION` e `VITE_API_URL` nos módulos reais** |
| `e2e-guard` (5) | todo `import.meta` em `src` é o literal `.env`; nenhum desvio de depuração no código; config do Playwright (sem `set`/`&&`, sem espaços, `reuseExistingServer: false`, perfil de teste, sem `RUSTIKA_*`); nenhum `.env` versionável liga o envio; spec sem atalhos e com as conferências obrigatórias |
| `env.test.ts` (+2) | `NODE_ENV='test '` com `app-dev ` é recusado; com `app-test ` é normalizado |

Resultados:

| Projeto | Typecheck | Testes | Build |
|---|---|---|---|
| Frontend | exit 0 | **96/96** em duas rodadas seguidas (antes 87; +9) | exit 0 |
| Backend | **5 erros TS2307, todos de `xlsx` (pré-existentes)** | 417 aprovados; **5 suítes não carregam** pelo mesmo motivo; os 4 arquivos que tocam `env.ts` passam (62/62) | exit 0 |

- **Backend e `xlsx`:** o pacote nunca foi declarado (nem em `package.json` nem em nenhum lockfile, nem no `HEAD`); estava instalado só como pacote avulso e o `npm install` de hoje (18:47, que adicionou `pg`) o removeu. Afeta cinco scripts (`analyze-excel*.ts`, `executor-seed-real.ts`, `inspect-reconciliation.ts`, `seed-real.ts`) e os testes deles. **Não corrigi**: exigiria decidir se o pacote entra como dependência.
- **Frontend:** uma única rodada do `npm test` terminou com código 134 (falta de memória do Node, sem resumo); não reproduziu em duas rodadas seguidas e coincide com a pressão de memória medida (705 MB livres).
- **Prova ponta a ponta da correção [EXEC]:** com uma instância nova do Vite e `VITE_ORDER_SUBMISSION=enabled`, os módulos servidos agora trazem `VITE_ORDER_SUBMISSION=[enabled]` e `VITE_API_URL=[http://localhost:4000/api]`, sem o desvio `_E2E_FORCE_ENABLED`. Instância parada em seguida.
- **Não coberto:** o spec e o config do Playwright não são verificados pelo typecheck do projeto (`tsconfig` inclui só `src`) e **não foram executados**; só a lógica que os protege foi testada.

---

## 9. Condições para nova execução real (exigem autorização específica)

1. **Autorização expressa** para escrever no `cardapio_digital_test`.
2. **Encerrar o Vite antigo** (PID 20708, porta 5173). Com a nova config o Playwright **falha** se as portas 4000 ou 5173 estiverem ocupadas, o que é o comportamento desejado.
3. **Decidir sobre o `seed_raw.js`** antes de rodar: ele apagaria, sem filtro, todos os pedidos, itens, histórico, sessões e convites do Test. Recomendo limitar os `DELETE` às linhas do E2E (comanda `999999`, ids `ca000000…`/`cc000000…`), mover a credencial para a pasta de segredos e acrescentar um teardown. Não alterei.
4. Encerrar ou conferir os `vitest` antigos (seção 6, item 3) e liberar memória.
5. Repetir a leitura somente leitura da seção 5 **antes** e **depois**; o resultado esperado depois: `orders` = 1 com 1 item e 1 evento `RECEIVED`, total 9900 centavos.
6. Comando previsto, sem `CI` definido e a partir de `frontend/` (**não executado**):

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\frontend
npx playwright test
```

7. Condições de parada: porta ocupada; botão "Enviar pedido" desabilitado (o spec agora falha ali, com a causa à vista); `POST /api/orders` diferente de 201 (o spec imprime status e corpo); qualquer linha de pedido fora do esperado.

**Riscos que continuam:** este E2E nunca emitiu o primeiro `POST /api/orders` de verdade; passada a barreira do envio desligado, ainda pode surgir outra falha (é a primeira vez que o fluxo chega ao servidor pela interface). O contrato do POST está coberto por testes com mocks e pela suíte `integration-db`, mas não por este navegador.

**Correção de afirmações anteriores:** a 3D.3.8 verificou que o envio estava "desligado por padrão" olhando só o caso sem variável, e a 3D.3.20 registrou `VITE_ORDER_SUBMISSION=enabled` como guardrail. Em ambas, **o caso ligado nunca foi testado**, e a causa B mostra que ele não funcionava. Agora está testado.

## 10. Parecer final

**3D.3.21-A — CORREÇÃO PREPARADA, NOVO E2E AGUARDANDO AUTORIZAÇÃO.**

- Causa real: o envio nunca foi habilitado, por defeito de leitura do `env` (causa B) agravado pelo reaproveitamento de um Vite antigo (causa A). Não houve falha de API, de sessão, de CSRF nem de renderização do sucesso. O banco Test está íntegro: 0 pedidos, 5 migrations, resíduos apenas das fixtures do E2E.
- Corrigido e testado localmente: leitura do `env`, remoção do desvio de produção, configuração do Playwright, spec sem atalhos e a guarda do `NODE_ENV`.
- Não resolvido nesta entrega, por exigir decisão: o `seed_raw.js` com exclusões sem filtro e credencial embutida, os scripts soltos com credencial, o `xlsx` não declarado e os processos antigos.

Nenhuma fase seguinte foi iniciada.
