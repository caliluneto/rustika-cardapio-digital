# RELATÓRIO DE ENTREGA — 3D.3.24-A

Preparação segura do ambiente para o Playwright E2E. **Somente leitura e análise estática.** Não executei Playwright, setup, teardown, seeds, migrations, limpeza nem escrita em banco; não alterei senhas, secrets, OneDrive, memória virtual ou arquivos; não encerrei processos; nada de commit/push.

## 1. Memória e recursos (05/11/2026 10:55)

| Item | Valor |
|---|---|
| RAM total | 7,82 GB |
| **RAM livre** | **0,62 GB** (mínimo definido: 1,8 GB) |
| Memória virtual | 8,6 GB livres de 28,8 GB; pagefile alocado 21 GB, uso 2,9 GB |
| Disco C: | 689,6 GB livres |
| Chromium do Playwright | `chromium-1248` e `chromium_headless_shell-1248` instalados e presentes (Playwright 1.64.1) |
| `npx` / `tsx` | funcionam (npx 12.2.0, tsx 4.23.15) |

Maiores consumidores (MB): Memory Compression 887; node 329 (processo de ferramenta, não do RÚSTIKA); claude 238/131/123; Defender 210; OneDrive 180; Edge 175; node 167; VS Code 140+140; Chrome 131 (headless, outro uso). Há ainda ~35 processos `node` pequenos (MCPs, Codex, Prisma language server do editor) e 4 processos de teste (`tsx --test`/`--require`) da PLATAFORMA_SITES_IA. Nenhum processo do RÚSTIKA em execução além desta sessão.

**Conclusão: a memória continua abaixo do limite. Playwright NÃO deve ser iniciado agora.**

Estimativa do pico do E2E (aproximada, não medida): backend `tsx` ~150 MB + Vite ~150 MB + runner do Playwright ~150 MB + Chromium headless ~250–350 MB + processo filho do setup/teardown ~150 MB (transitório) = ~0,8–1,0 GB. A 3D.3.21-A caiu por falta de memória com 705 MB livres.

Alternativas seguras (todas dependem de você; nada foi executado): (a) fechar Edge, Chrome e janelas do VS Code, e sessões Claude/Codex que não estejam em uso; (b) pausar os testes da PLATAFORMA_SITES_IA que estão rodando; (c) reiniciar o Windows (a opção que mais libera Memory Compression e cache); (d) pausar o OneDrive (também reduz E/S). Depois, repetir a medição; só prosseguir com ≥ 1,8 GB livres. Não alterei memória virtual.

## 2. Integridade dos arquivos Playwright e críticos

- `frontend/playwright.config.ts` (04/11 21:56), `tests/e2e.spec.ts` (21:58), `globalSetup.ts` e `globalTeardown.ts` (21:57): datas anteriores à regressão do OneDrive, conteúdo coerente com a documentação e com os pareceres anteriores.
- Hashes dos módulos de segurança (`gate.ts`, `legacy.ts`, `launch-env.ts`, `cleanup-legacy.ts`, `databases.ts`, `preflight.ts`, `prisma.ts`, `env.ts`) **idênticos** aos da 3D.3.23-E. `.trim()` de `NODE_ENV` e `createPrismaRuntime` presentes.
- `frontend/src/App.tsx` aparece como `M` no Git só por diferença de final de linha (conteúdo igual ao HEAD e à cópia de conflito).
- Sem manifesto remanescente em `%TEMP%\rustika-e2e` (requisito do setup).

## 3. Conflitos do OneDrive

32 arquivos `*-Calil-Notebook.*` (22 de código-fonte, 10 em `backend/dist`), **o mesmo número da 3D.3.23-D; nenhum novo** desde as 10:53. Nada apagado, movido ou sobrescrito. `git status`: 149 entradas, 0 em stage. Avaliação: pausar a sincronização durante o E2E é recomendável (o `npx playwright` grava `test-results/` e o manifesto fica no `%TEMP%`; arquivos escritos em pasta sincronizada podem gerar conflitos). Não mexi na configuração do OneDrive; a pausa é decisão sua.

## 4. Portas e processos

4000, 4100, 5173 e 5174 livres. 5432 em uso pelo PostgreSQL (esperado). Sem Vite, backend ou Playwright do RÚSTIKA ativos. Sem sessões nem advisory locks no banco Test (verificado na 3D.3.23-E).

## 5. Cobertura E2E existente

Um único teste (`e2e.spec.ts`, "E2E Real Journey"), em Chromium headless, 1 worker, `retries: 0`, timeout 60 s:

| Fluxo pedido | Cobertura |
|---|---|
| 1. Acesso ao cardápio | Parcial: `/#catalog` é aberto, mas não há asserção específica |
| 2. Categorias e produtos | Parcial: o produto sintético é localizado por nome em `.product-card`; categorias não são verificadas |
| 3. Carrinho e quantidades | Parcial: adiciona 1 item; **não altera quantidades** |
| 4. Associação à comanda | Sim: login admin → convite → resgate → comanda ativa |
| 5. Checkout | Sim: revisar → prosseguir → nome → botão habilitado → envio |
| 6. Pedido persistido | Sim: POST 201 (cabeçalhos, idempotência, total) e verificação somente leitura no teardown (1 pedido, `RECEIVED`, 1 item, histórico inicial, chaves de idempotência, convite consumido) |
| 7. Atualização de status | **Não coberta** (nem existe no fluxo atual do teste) |
| 8. Isolamento e limpeza | Sim: manifesto, teardown cirúrgico, prova de resíduo zero |

Lacunas não preenchidas nesta etapa (por instrução): quantidades, categorias e status. Não implementei nada.

## 6. Scripts de setup e teardown

- `globalSetup.ts` → `backend/tests/integration-db/e2e/run-setup.ts` (processo filho via `tsx`, herda o ambiente; imprime uma linha JSON com o ambiente da execução, inclusive a senha efêmera do admin sintético, só em memória).
- `globalTeardown.ts` → `run-teardown.ts`: lê o manifesto, compara com o banco, verifica o pedido e apaga só as linhas da execução; roda mesmo se a jornada falhar.
- Ambos usam `launch-env.ts` como primeiro import (corrige o `.env` legado sem tocar nos gates). Manifesto em `%TEMP%\rustika-e2e`.

## 7. Comandos exatos do E2E real (NÃO executados)

Pré-condição: ≥ 1,8 GB livres, portas 4100/5174 livres, nenhum manifesto, `e2e:inspect` limpo. O passo de limpeza legada do documento antigo **já foi feito** e não deve ser repetido.

```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
$env:NODE_ENV='test'; $env:DB_PROFILE='app-test'
$env:RUSTIKA_DB_INTEGRATION='1'; $env:RUSTIKA_DB_INTEGRATION_CONFIRM='WRITE_CARDAPIO_DIGITAL_TEST'
$env:RUSTIKA_E2E_CONFIRM='RUN_E2E_ON_CARDAPIO_DIGITAL_TEST'
Remove-Item Env:DATABASE_URL,Env:SHADOW_DATABASE_URL,Env:CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION,Env:RUSTIKA_E2E_LEGACY_CLEANUP -ErrorAction SilentlyContinue
npm run e2e:inspect                                   # 1. estado inicial (leitura)
cd ..\frontend
npx playwright test --workers=1 --project=chromium    # 2. setup -> jornada -> teardown
cd ..\backend
npm run e2e:inspect                                   # 3. estado final (leitura)
Remove-Item Env:NODE_ENV,Env:DB_PROFILE,Env:RUSTIKA_DB_INTEGRATION,Env:RUSTIKA_DB_INTEGRATION_CONFIRM,Env:RUSTIKA_E2E_CONFIRM
```

Resultado esperado: teste 1/1 aprovado; "Global Teardown: execução … limpa; pedido verificado: sim"; no `e2e:inspect` final, contagens iguais às de 3.23-E (admins 1, categories 1, products 1, tudo o mais 0, 5 migrations).

## 8. Riscos de escrita e estratégia de isolamento

- Escreve no Test: admin, categoria, produtos, comanda, convite, sessão, pedido, item e histórico, todos sintéticos e por `runId`; só o banco `cardapio_digital_test` (gate exige `NODE_ENV=test`, `DB_PROFILE=app-test`, confirmações, ausência de `DATABASE_URL`; o preflight verifica identidade, 5 migrations, ACL e `pg_hba`, e tenta conectar em outros bancos).
- Manifesto gravado **antes** de escrever; teardown cirúrgico e por manifesto.
- Backend do E2E sobe como `NODE_ENV=test`, `DB_PROFILE=app-test` (role `app` do Test), portas 4100/5174 com `reuseExistingServer: false`.
- Observação: o `webServer` sobe o backend antes do `globalSetup`; não há escrita nesse intervalo.
- Riscos residuais: memória (acima); `test-results/` fica na pasta sincronizada pelo OneDrive e **não está no `.gitignore`**; contém `error-context.md` de uma execução antiga, e uma falha futura poderia gravar capturas/traces com dados da execução sintética (sem segredos permanentes, mas com a senha efêmera possível no estado da página). Credenciais fracas e compartilhadas continuam como risco aceito (decisão do usuário).

## 9. Critérios para abortar e recuperação

Abortar (e não prosseguir) se: RAM livre < 1,8 GB; porta ocupada; qualquer arquivo crítico com hash diferente ou nova cópia de conflito; `e2e:inspect` com resíduo, sessões ou locks; manifesto presente; qualquer gate recusar. Falhas já bloqueiam sozinhas (tabela em `backend/docs/e2e-real.md`).

Recuperação: se o teardown abortar ou falhar, **não limpar à mão**; rodar `npm run e2e:inspect` e depois `npm run e2e:teardown` (mesmas travas). Sem manifesto não há limpeza por varredura. Backup válido do Test: `C:\RustikaBackups\TestDB_Secure\cardapio_digital_test_pre-cleanup_20261105-130911.dump` (SHA-256 `5159C9D4…5E1BD7`, conferido na 3D.3.23-E); ele é anterior à limpeza e só serve a recuperação sob autorização específica.

## 10. Alterações necessárias antes dos testes

Obrigatória: nenhuma no código. Bloqueio operacional: liberar memória.
Recomendadas (nenhuma aplicada; exigem autorização): (a) adicionar `test-results/` e `playwright-report/` ao `.gitignore`; (b) `screenshot: 'only-on-failure'` e traço compatível (`trace: 'on-first-retry'` não produz nada com `retries: 0`); (c) atualizar `backend/docs/e2e-real.md` (remover o passo da limpeza legada, já concluído); (d) cobertura de quantidades, categorias e status em etapa própria.

## 11. Arquivo legado `verify-fixtures-rotation.ts`

Não interfere no Playwright: está em `backend/tests/scripts/`, fora do `testDir` do Playwright (`frontend/tests`), nenhum setup/teardown o importa (`run-setup`/`run-teardown` usam `tsx` por arquivo, sem `tsc`), e nada o referencia. Só atrapalha o `tsc --noEmit` completo do backend (2 erros). Não foi alterado.

## 12. Parecer final

**BLOQUEADO para solicitar a autorização do E2E real — por recursos, não por código.** Memória livre de 0,62 GB contra o mínimo de 1,8 GB. Todo o restante está pronto: arquivos e hashes íntegros, nenhuma nova cópia de conflito, portas livres, Chromium instalado, banco limpo, backup íntegro. Quando a memória for liberada e remedida (≥ 1,8 GB), o ambiente fica **PRONTO** para você autorizar a execução com escrita.
