# RELATÓRIO DE ENTREGA — ETAPA 3D.4.1-C
Transferência segura, commit e publicação privada da operação de pedidos

(Arquivo local; não publicado.) Sem alteração de bancos, migrations, seeds, Playwright, workflow, tags, force push ou merge de históricos.

## 1. Estado inicial
Snapshot: `main` em `b09c084fb5b1c3207a8cd1c3c5cc98cbf1eb8da7`, árvore limpa, sem operação Git em andamento, remoto `origin` = repositório privado, `ls-remote` = mesmo hash. Original: `3b857ad`, sem remoto, índice vazio, 82 refs. Manifesto: 34 caminhos únicos, todos existentes, nenhum relatório/manifesto/cópia OneDrive/`.env`/teste sensível.

## 2. Arquivos transferidos (34)
22 modificados + 12 novos, exatamente a lista de `manifest-3d41b-transfer.txt` (staged == manifesto, conferido por `diff`). Novos: `order-operations.md`, a migration `20261105000000_order_status_update_privilege`, `orderOperations.service.ts`, `e2e-order-ops.test.ts`, `fixtures/orderOps.ts`, `order-operations.integration.ts`, `order-admin.test.ts`, `order-status-privilege-migration.test.ts`, `AdminOrders.tsx`, `adminOrders.ts`, `adminOrdersPolling.ts`, `admin-orders.test.mjs`.

## 3. Diferenças resolvidas
Antes de copiar, cada arquivo existente no snapshot foi comparado ao original: as únicas linhas removidas eram as edições intencionais (ex.: assinatura de `authenticated`, retorno do cliente de API, contagem de inputs). Os arquivos do original estavam parcial ou totalmente em CRLF; o snapshot usa LF no índice. Normalizei as cópias para LF (migration permanece LF, `-text`); o diff caiu de 658+/417− para 273+/32− nos arquivos modificados. `git diff --check` limpo.

## 4. Correções preservadas
`ci.yml` do snapshot recebeu apenas adições (3 inputs, passo de integração, dois passos Playwright): FIX01 (`CARDAPIO_SECRETS_DIR` via `$GITHUB_ENV`), FIX02 (inspeção estruturada `--out`, validador de resíduos), gates e migrations anteriores intactos. `ci-config.test.ts` (42 testes) passa.

## 5–7. Testes (executados no snapshot)
Backend `test:ci`: 39 arquivos, **812 passando**, 7 ignorados (integração, sem banco). Frontend: **117/117**. `tsc --noEmit` backend: **0 erros** (o arquivo legado não está versionado); build backend e frontend ok. Reexecutados após a normalização de fim de linha.

## 8. Migration e ACL
Migration conferida: único `GRANT UPDATE (status, updated_at) ON public.orders` à role de runtime, guardas de identidade/banco/versão, pós-condição na mesma transação; sintaxe validada pelo parser do PostgreSQL (offline). Testes estáticos de ACL e da matriz `PERMISSIONS_SQL` passam. Nada foi aplicado a banco algum.

## 9. Integridade do preflight
`EXPECTED_MIGRATIONS` = 6 entradas com checksums fixos; testes cobrem 5, 7, nome trocado e checksums divergentes; diretório de migrations em disco igual ao conjunto esperado.

## 10. Segredos
Varredura de chaves privadas, tokens (`ghp_`, `AKIA`) e URLs com credencial no conteúdo staged: sem achados reais (apenas dois fixtures de redação pré-existentes em `integration-db-support.test.ts`). Quatro testes com valor sensível do original: sem alteração e não transferidos.

## 11–13. Commit e publicação
Commit `140221e1e851917d80c0162a799569830b2183da` — `feat(admin): add order operations and prepare isolated integration tests` (34 arquivos, +2018/−32, staging com caminhos explícitos).
Visibilidade: consulta anônima à API do GitHub retornou 404 (repositório privado); `gh` não está instalado. Push: `git push --no-tags origin main:main` → `b09c084..140221e`. `ls-remote`: `refs/heads/main` = `140221e…`; nenhuma outra ref. Remoto não havia avançado.

## 14. Repositório original
HEAD `3b857ad`, índice vazio, 82 refs, sem remoto; arquivos de trabalho inalterados nesta etapa; quatro testes sensíveis sem diff.

## 15. Primeira execução de integração (NÃO disparada)
Actions → CI → *Run workflow* em `main`, repositório privado, com:

| Input | Valor |
| --- | --- |
| run_backend | false (opcional) |
| run_frontend | false (opcional) |
| **run_e2e** | **true** |
| **run_integration** | **true** |
| **run_playwright** | **false** |
| run_order_ops | false |
| upload_diagnostics | false (true só para investigar falha) |

Semântica verificada no YAML final: o job `e2e` só roda em `workflow_dispatch` com `run_e2e` e repositório privado; cria PostgreSQL 18 efêmero no runner, aplica as 6 migrations só nele (`APPLY_CARDAPIO_DIGITAL_TEST`), provisiona roles sintéticas e fixtures, executa `inspect` inicial, depois **`npm run test:integration:db`** (passo `if: run_integration`), pula ambos os passos Playwright (`if: run_playwright == true`), captura o estado final, valida resíduo zero e descarta banco e segredos. `RUSTIKA_E2E_ORDER_OPS: enabled` existe apenas no passo "Playwright E2E ampliado" (exige `run_playwright` e `run_order_ops`). Sem gatilho de integração/E2E em push/PR.
Rodadas seguintes (somente após a primeira passar): `run_playwright=true` (jornada original) e depois `run_order_ops=true`.

## 16. Só o CI poderá comprovar
Serializable + CAS reais (8 requisições simultâneas: 1×200, 7×409), rollback, ACL por coluna efetiva na role de runtime e negações (DELETE/TRUNCATE/outras colunas), aplicação das 6 migrations no PostgreSQL 18, histórico consistente, resíduo zero, e se as suítes de integração antigas (nunca rodadas no CI) passam. O workflow ainda não foi disparado; o painel e a jornada E2E ampliada seguem sem execução real.
