# RÚSTIKA — Etapa 3D.3.23-A
## Preparação operacional e proposta final de limpeza E2E
Data: 05/11/2026 · Escritas no banco: **nenhuma** · Processos encerrados: **nenhum** · Senhas/roles/`pg_hba.conf`: **intocados**

Reaproveita `RELATORIO-ENTREGA-3D.3.22-C.md`, `RELATORIO-ENTREGA-3D.3.23-PREP-E2E.md` e `backend/docs/e2e-real.md`.
Executado: consultas de processos/memória, um `e2e:inspect` somente leitura, leitura de código, **uma alteração de código sem efeito em banco** (seção 3.4) com testes unitários.

## 1. Processos antigos — resultado da reconfirmação
O computador foi **reiniciado hoje às 08:07**. Os PIDs 20396, 20264, 7316, 35328 e 27780 **não existem mais**, nem o Vite 20708 (porta 5173 agora livre).

| PID | Situação em 05/11 | Ação |
| --- | --- | --- |
| 20396, 20264, 7316, 35328, 27780 | inexistentes (reinício do Windows) | **nenhuma; nada a encerrar** |
| 20708 (Vite Dev, 5173) | inexistente | nenhuma; a 5173 está livre (nada foi iniciado nem alterado) |

Estado atual: portas 4000, 4100, 5173 e 5174 livres; só o PostgreSQL escuta (5432, PID 7108); nenhum `vitest`/`vite`/`playwright`/`tsx` do projeto; sem manifestos em `%TEMP%\rustika-e2e`; **0 sessões** de roles no Test (as 4 `psql` ociosas do migrator também sumiram); 0 advisory locks. **Autorização de encerramento de processo: não necessária.**

## 2. Resíduos do banco Test (reconfirmados hoje: mesmos 6 registros, `orders`=0)
| Tabela | Chave primária | Identificador público | Relações | Evidência E2E antigo | Remover? | Recriado pelo próximo E2E? |
| --- | --- | --- | --- | --- | --- | --- |
| `comandas` | `cc000000-0000-4000-8000-000000000999` | número `999999` (aberta) | pai de convite e sessão; 0 pedidos | id fixo do `seed_raw.js`; **única colisão do preflight** (número `9…` sem convite de admin de fixture) | **SIM** | não (o setup reserva números próprios por `runId`) |
| `comanda_invitations` | `3d3a7928-328c-47ae-ad47-b8780411bc33` | — (só hash) | filho da comanda e do admin legado; pai da sessão; expirou 04/11 20:34 | emitido pelo admin E2E para a comanda 999999 | **SIM** (RESTRICT impede apagar a comanda sem ele) | sim (cria o seu) |
| `comanda_sessions` | `45866608-27e6-4747-b5a0-8da0bad75d25` | — | filho da comanda e do convite; 0 pedidos; expirou 05/11 04:24 | resgate do convite acima | **SIM** (idem) | sim |
| `admins` | `ca000000-0000-4000-8000-000000000000` | `e2e@rustika.local` | após a remoção do convite, **sem nenhuma referência** (histórico de pedidos por ele: 0) | id fixo, e-mail `.local`, "E2E Admin" | **não necessário** | sim (admin sintético por `runId`) |
| `categories` | `cc000000-…-000000000000` | `e2e-cat` | pai do produto legado | id fixo, "E2E Category" | **não necessário** | sim |
| `products` | `cc000000-…-000000000001` | `rustika-E2E001` (`source_code` E2E001, R$ 0,99) | filho da categoria; 0 `order_items` | id fixo, "E2E Product" | **não necessário** | sim |

**A colisão da 999999 pode ser eliminada sem tocar admin, categoria e produto.** Verificado no código (`fixtures.ts`, `countCollisions`): a outra colisão checada (`source_code PA062240`) não existe; o produto E2E001 não colide. O próximo E2E não depende de nenhum dos 3 registros preservados: o setup cria admin, categoria, produtos, comanda e convite próprios (`lifecycle.ts`), e o seletor do teste é o nome único `FRIOS FIXTURE [marcador]`.
**Efeito colateral aceito ao preservar (opção mínima):** o admin ativo `e2e@rustika.local`, a categoria e o produto "E2E" continuam no Test (visíveis no catálogo do Test). Se preferir remover tudo, é a opção B (seção 3.5), com autorização separada.

## 3. Plano SQL exato (somente `cardapio_digital_test`; NÃO executado)
### 3.1 Pré-condições
1. Hoje: 0 sessões de `test_app`/`test_fixtures`, 0 locks, 0 manifestos, 5 migrations concluídas, portas 4100/5174 livres.
2. **Backup novo do Test** com SHA-256 conferido antes (a pedido: `pg_dump -Fc`, cuja senha você digita). Atenção: os dumps existentes (`…pre-migrations-3d311…`, `…pre3d38…`) são **anteriores** ao resíduo; nenhum contém estas 6 linhas. Elas são sintéticas e recriáveis.
3. `npm run e2e:inspect` imediatamente antes (esperado: 1/1/1/1/1/1 e `orders`=0).

### 3.2 Caminho preparado (recomendado): utilitário com transação e conferência
`cleanLegacy(..., scope: 'blocker')` faz, numa transação Prisma, exatamente as 3 exclusões abaixo e **reverte tudo** se qualquer contagem divergir. Antes de apagar, `inspectLegacy` aborta se: o convite for de outro emissor, houver pedido na comanda, existir outra comanda 999999, ou qualquer atributo não conferir.

### 3.3 SQL equivalente (para auditoria; sessão `psql` com a role de fixtures, em `cardapio_digital_test`)
```sql
\set ON_ERROR_STOP on
BEGIN;
SELECT current_database(), current_user;                       -- esperado: cardapio_digital_test | cardapio_test_fixtures

-- (a) contagens ANTES: esperado 1,1,1 e todo o resto 0
SELECT
 (SELECT count(*) FROM comandas            WHERE id='cc000000-0000-4000-8000-000000000999' AND number='999999')                         AS comanda,
 (SELECT count(*) FROM comanda_invitations WHERE id='3d3a7928-328c-47ae-ad47-b8780411bc33' AND comanda_id='cc000000-0000-4000-8000-000000000999' AND issued_by_admin_id='ca000000-0000-4000-8000-000000000000') AS convite,
 (SELECT count(*) FROM comanda_sessions    WHERE id='45866608-27e6-4747-b5a0-8da0bad75d25' AND comanda_id='cc000000-0000-4000-8000-000000000999' AND invitation_id='3d3a7928-328c-47ae-ad47-b8780411bc33') AS sessao,
 (SELECT count(*) FROM orders              WHERE comanda_id='cc000000-0000-4000-8000-000000000999')                                      AS pedidos,
 (SELECT count(*) FROM comanda_invitations WHERE comanda_id='cc000000-0000-4000-8000-000000000999' AND id<>'3d3a7928-328c-47ae-ad47-b8780411bc33') AS outros_convites,
 (SELECT count(*) FROM comanda_sessions    WHERE comanda_id='cc000000-0000-4000-8000-000000000999' AND id<>'45866608-27e6-4747-b5a0-8da0bad75d25') AS outras_sessoes,
 (SELECT count(*) FROM comandas            WHERE number='999999' AND id<>'cc000000-0000-4000-8000-000000000999')                         AS outra_999999;

-- (b) exclusões (filho -> pai), cada uma deve responder DELETE 1
DELETE FROM comanda_sessions    WHERE id='45866608-27e6-4747-b5a0-8da0bad75d25' AND comanda_id='cc000000-0000-4000-8000-000000000999' AND invitation_id='3d3a7928-328c-47ae-ad47-b8780411bc33';
DELETE FROM comanda_invitations WHERE id='3d3a7928-328c-47ae-ad47-b8780411bc33' AND comanda_id='cc000000-0000-4000-8000-000000000999' AND issued_by_admin_id='ca000000-0000-4000-8000-000000000000';
DELETE FROM comandas            WHERE id='cc000000-0000-4000-8000-000000000999' AND number='999999';

-- (c) verificação ainda dentro da transação
SELECT (SELECT count(*) FROM comandas WHERE number LIKE '9%')                    AS comandas_9,        -- 0
       (SELECT count(*) FROM comanda_invitations)                                AS convites,          -- 0
       (SELECT count(*) FROM comanda_sessions)                                   AS sessoes,           -- 0
       (SELECT count(*) FROM admins)                                             AS admins,            -- 1 (preservado)
       (SELECT count(*) FROM categories)                                         AS categorias,        -- 1
       (SELECT count(*) FROM products)                                           AS produtos,          -- 1
       (SELECT count(*) FROM orders)                                             AS pedidos,           -- 0
       (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL)   AS migrations;        -- 5
-- Se QUALQUER número divergir do esperado ou um DELETE não responder "DELETE 1": digite ROLLBACK;
-- Se tudo conferir:  COMMIT;
```
Sem `TRUNCATE`, `DROP`, `CASCADE` ou DELETE sem `id` + atributos. Cada DELETE afeta no máximo 1 linha por chave primária.

### 3.4 Comandos preparados (código novo, sem efeito em banco)
Adicionado o escopo `--scope blocker` a `backend/tests/integration-db/e2e/legacy.ts` e `cleanup-legacy.ts` (padrão continua `full`); 2 testes novos, **75/75** em `e2e-fixtures.test.ts` (o escopo mínimo preserva admin/categoria/produto e todas as linhas fora do escopo; aborta sem apagar se houver pedido na comanda).
```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
$env:NODE_ENV='test'; $env:DB_PROFILE='app-test'; $env:RUSTIKA_DB_INTEGRATION='1'
$env:RUSTIKA_DB_INTEGRATION_CONFIRM='WRITE_CARDAPIO_DIGITAL_TEST'; $env:RUSTIKA_E2E_CONFIRM='RUN_E2E_ON_CARDAPIO_DIGITAL_TEST'
npm run e2e:inspect                                               # antes (somente leitura)
npm run e2e:cleanup-legacy -- --scope blocker                     # DRY-RUN: lista as 3 linhas, não apaga
# --- somente com autorização expressa ---
$env:RUSTIKA_E2E_LEGACY_CLEANUP='ERASE_LEGACY_E2E_FIXTURES'
npm run e2e:cleanup-legacy -- --scope blocker --execute
Remove-Item Env:RUSTIKA_E2E_LEGACY_CLEANUP
npm run e2e:inspect                                               # depois
```
Esperado no dry-run: `present` `{admin:true, category:true, product:true, comanda:true}`, `counts` `{invitations:1, sessions:1, orders:0, orderItems:0, history:0}`, `problems` vazio. Esperado no `--execute`: `deleted` `{comanda_sessions:1, comanda_invitations:1, comandas:1}` (sem chaves de admin/categoria/produto).
Depois: `legacy_e2e_residue` `{admin:1, categoria:1, produto:1, comanda_999999:0}`; `fixture_residue.comandas_faixa_9`=0; demais tabelas iguais; 5 migrations.

### 3.5 Opção B (alternativa, autorização separada)
Sem `--scope` (ou `--scope full`): remove também admin, categoria e produto legados (6 linhas), pelo mesmo utilitário já testado.

### 3.6 Recuperação
- **Falha antes do COMMIT:** a transação reverte sozinha (utilitário) ou `ROLLBACK;` (psql). Nada muda.
- **Após o COMMIT:** não há o que "desfazer" de valor: as linhas são sintéticas e não referenciadas. Se precisar delas, recria-se pelo setup do E2E (linhas próprias por execução). Restauração do dump novo só para um **banco de apoio**, nunca sobre o Test sem autorização. Se algo fora das 3 linhas mudar (não deve), pare e compare `e2e:inspect` antes/depois.
- **Evidências de que o resto fica intacto:** filtros por `id` + atributos; contagens antes/depois; as 3 tabelas sensíveis (`admins`, `categories`, `products`) e `orders*` com mesmos totais; teste unitário com banco falso (preexistentes sobrevivem, FK RESTRICT reverte).

## 4. Memória e ambiente — plano de execução econômica
Medição de hoje: RAM total 8.007 MB, **livre ~1.108 MB** (subiu dos 759 MB de ontem após o reinício). Maiores consumidores: Claude 1,26 GB, ChatGPT 1,21 GB, Edge 1,18 GB. Estimativa do E2E: backend `tsx` ~150–200 MB + Vite ~150 MB + runner do Playwright ~150 MB + Chromium headless ~300–450 MB ≈ **0,8–1,0 GB**, ou seja, margem estreita com 1,1 GB livres.
- Antes de rodar: fechar o Edge (e abas pesadas) e, se possível, o ChatGPT; meta **≥ 1,8 GB livres** (conferir com `Get-CimInstance Win32_OperatingSystem`).
- Uma instância do backend Test (4100), uma do frontend E2E (5174), `workers: 1` e `fullyParallel: false` (já na config), `retries: 0`, **headless**, um navegador; sem Vitest em paralelo; `reuseExistingServer:false` (falha se a porta estiver ocupada, sem duplicar).
- Opcional: `$env:NODE_OPTIONS='--max-old-space-size=512'` limita o heap do Node; não altera a Vite Dev (5173), que hoje nem está ativa.
- Não iniciar o Playwright nesta etapa.

## 5. Verificação do fluxo no código existente (nada a reconstruir)
| Pergunta | Resposta (arquivo) |
| --- | --- |
| Como os dados são preparados | `globalSetup.ts` → `run-setup.ts` → `e2eSetup`: gates, preflight, manifesto `pending`, depois, numa transação, admin sintético, categoria pública, produtos, comanda fechada, faixa de comandas e senha efêmera; devolve e-mail, senha, comanda, produto e preço só em memória |
| Como a comanda é criada/resgatada | admin faz login em `/#admin`, emite convite para a comanda reservada ("Emitir Convite"); o cliente cola o token em "Abrir carrinho → Resgatar" e fica com a sessão `rustika_session` |
| Como os produtos aparecem | API `GET /categories`/`/products` (`VITE_CATALOG_MODE=api`); o teste clica `.product-card` com o nome `FRIOS FIXTURE [marcador]` |
| Como o pedido é enviado | carrinho → "Revisar pedido" → "Prosseguir para envio" → "Enviar pedido" (habilitado só com `VITE_ORDER_SUBMISSION=enabled` no Vite do E2E) → `POST /api/orders` com `X-Rustika-Request`, `Idempotency-Key` UUID v4, cookie e `Origin`; exige **201**, comanda e total corretos, "Pedido recebido"; reenvio igual exige **200** e o mesmo `orderNumber` |
| Como a persistência é verificada | `globalTeardown.ts` → `run-teardown.ts`: lê o manifesto, confere o que a identidade encontra, verifica **somente leitura** o pedido (1 pedido, `RECEIVED`, cliente, total, 1 item, histórico `null→RECEIVED`, chave/digest, convite consumido) |
| Como elimina ou preserva | remove só as linhas do manifesto (filho→pai, transação), prova resíduo zero e apaga o manifesto; abortar sem apagar se houver registro que o manifesto não explica. O **pedido** da execução também é removido (a numeração de pedidos avança) |

## 6. Critérios de aceite
1. Limpeza: `deleted` = 1/1/1; admin, categoria, produto e todas as demais linhas inalterados; `orders`=0; 5 migrations idênticas; nenhum catálogo real tocado (o Test não tem catálogo real).
2. Preflight do E2E passa (sem colisão); portas 4100/5174 livres antes e depois.
3. E2E: `POST /api/orders` 201, replay 200, "Pedido recebido" sem erro visível, verificação do pedido persistido OK.
4. Pós-E2E: resíduo zero da execução, nenhum manifesto remanescente, 0 sessões de `test_app`/`test_fixtures`, `e2e:inspect` = estado do item 1.
5. Nenhum segredo em log/relatório; nenhum commit/push.

## 7. Pendências e riscos
| # | Item | Natureza |
| --- | --- | --- |
| 1 | **`backend/tests/scripts/verify-fixtures-rotation.ts`** (não rastreado, criado 04/11 23:50, **não é meu**): quebra o `tsc --noEmit` do backend (`pg` sem tipos; import `./src/config/secrets` inexistente). Os demais arquivos compilam. A rotação foi cancelada; não o apaguei nem o alterei | **decidir:** manter, mover ou remover (apenas você) |
| 2 | Memória livre ~1,1 GB para ~1 GB estimado | fechar Edge/ChatGPT antes |
| 3 | Admin/categoria/produto legados continuam no Test se escolher a opção mínima | aceito; opção B disponível |
| 4 | Credenciais fracas/compartilhadas | risco aceito pelo usuário; não bloqueia |
| 5 | Nenhum dump contém o resíduo | irrelevante (sintético); fazer dump novo antes de apagar |
| 6 | `npm` falhou uma vez neste shell em 05/11 ("Could not determine Node.js install directory"); `node`/`tsx` direto funcionam | usar PowerShell novo |
| 7 | 11 scripts soltos com senha em `backend/` | manter fora do Git |

## 8. Estado do Git
Branch `main`; **0 arquivos em stage**; 118 entradas de status (modificadas e não rastreadas); nenhum commit, push, reset ou clean. Alterados nesta etapa: `backend/tests/integration-db/e2e/legacy.ts`, `cleanup-legacy.ts`, `backend/tests/e2e-fixtures.test.ts` e este relatório. Validação: `e2e-fixtures.test.ts` 75/75; `tsc` só falha no arquivo do item 7.1.

## 9. Proposta final de intervenção mínima
1. **Processos a encerrar:** nenhum (todos já encerrados pelo reinício).
2. **Registros a remover (3):** comanda `999999` (`cc000000-…-0999`), convite `3d3a7928-…-bc33`, sessão `45866608-…-5d75`.
3. **Registros a preservar:** admin `ca000000-…`, categoria `cc000000-…-0000`, produto `cc000000-…-0001`, todo o resto do banco, as 5 migrations, o catálogo real e os bancos Dev/Shadow.
4. **Comandos preparados:** seção 3.4 (dry-run livre; `--execute` só com autorização).
5. **Autorização específica necessária** (uma frase sua, por exemplo): *"Autorizo o `cleanup-legacy --scope blocker --execute` no `cardapio_digital_test`, removendo somente a comanda 999999, o convite 3d3a7928… e a sessão 45866608…, após dump novo e `e2e:inspect`."* A execução do E2E real exige **outra** autorização, depois da limpeza verificada.

**Encerrada. Aguardando auditoria do ChatGPT e autorização; nenhuma etapa seguinte foi iniciada.**
