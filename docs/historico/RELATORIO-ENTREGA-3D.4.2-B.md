# RELATÓRIO DE ENTREGA — ETAPA 3D.4.2-B
Revisão final, transferência e publicação privada da gestão de disponibilidade (arquivo local; não publicado)

## 1. Política de disponibilidade
Revisada e confirmada: `availabilityState` é a fonte de verdade; `UNKNOWN` e `UNAVAILABLE` bloqueiam pedido (`409 PRODUCT_UNAVAILABLE`, validado dentro da transação do pedido); `AVAILABLE` só vale para produto elegível (predicado público único `publicProductWhere`); `isAvailable` legado não é lido nem escrito nem recebe privilégio; inativos, categoria inativa e insumos internos → `422 PRODUCT_NOT_MANAGEABLE`; preço, chaves e demais colunas intactos (testes unitários e de integração preparados); nada torna produto disponível após importação. Mapper público `UNKNOWN→null / AVAILABLE→true / UNAVAILABLE→false`, carrinho (`false` bloqueado, `null` rotulado) e checkout (`PRODUCT_UNAVAILABLE` sem limpar o carrinho) coerentes. Nenhum campo novo.

## 2. Contratos das rotas
Sem alteração. `GET /api/admin/products` e `PATCH /api/admin/products/:id/availability`: sessão admin (401 antes de validar), Origin + `X-Rustika-Request` + JSON na escrita, corpo estrito (400), 404 inexistente, 422 não gerenciável/transição inválida, 409 conflito (compare-and-set), 500 genérico, Serializable. Autenticação de produção não foi tocada.

## 3. Consistência catálogo × pedidos
Verificada por leitura de código e testes: o pedido continua lendo `availabilityState` na sua própria transação Serializable (`order.service.ts`, inalterado).

## 4. Concorrência administrativa
Duas/oito requisições do mesmo `expectedState`: uma vence, as demais `409` (teste unitário com barreira; teste real preparado para o CI).

## 5. Concorrência com pedidos
Inspeção: pedido e alteração administrativa são ambos Serializable; a leitura de disponibilidade do pedido e a escrita do admin formam dependência rw, que o PostgreSQL resolve ordenando as transações ou abortando uma (`P2034`), com retentativa em ambos os serviços. Não há janela de corrida relevante nem necessidade de lock; **nenhuma alteração transacional foi feita**. O teste real (`product-availability.integration.ts`, "corrida indisponibilizar × pedir") aceita 201 (pedido serializado antes) ou 409 `PRODUCT_UNAVAILABLE`, e exige que depois do commit nenhum pedido seja aceito. Prova real: só no CI.

## 6. Migration 7 e ACL
Reinspecionada: apenas `GRANT UPDATE (availability_state, updated_at) ON public.products` à role de runtime; sem UPDATE de tabela, DELETE, TRUNCATE, GRANT OPTION, atributos administrativos nem outro banco; pós-condição na mesma transação. SHA-256 `3665ed81…7e69308`. Preflights: exatamente 7 migrations (nomes + checksums), seis anteriores intactas. Nada executado em PostgreSQL.

## 7. Limite de 500 produtos
A API já devolve `truncated` de forma confiável (`take 501`). **Defeito de interface corrigido:** a contagem "X de Y produtos" poderia sugerir catálogo completo; agora, truncada, mostra "carregados (lista parcial: existem mais produtos no servidor)", além do aviso já existente. Teste novo. Sem paginação nem query string.

## 8. Testes
Alteração desta revisão: só `AdminProducts.tsx` (+1 teste). Frontend **137/137**, `tsc` limpo. No snapshot após a cópia: backend `test:ci` **861 aprovados, 7 ignorados**, `tsc` sem erros, frontend 137/137. Sem integração real, sem Playwright, sem migration.

## 9. E2E
`run_product_availability`: booleano, padrão `false`; 4 passos Playwright exclusivos, variáveis constantes só nesses passos; compatível com `run_e2e`, `run_integration`, `run_playwright`, `run_order_ops`, `upload_diagnostics`; fixtures sintéticas; teardown e prova de resíduo zero preservados; sem gatilho em push/PR (`ci-config` 42 testes).

## 10. Arquivos transferidos
Exatamente os 31 do manifesto (21 modificados + 10 novos), CRLF→LF; staged == manifesto; `git add` com caminhos explícitos. `AdminProducts.tsx` e `admin-products.test.mjs` já refletem a correção do item 7 (o manifesto não muda de lista). Não copiados: `.git`, `.env`, secrets, relatórios, manifestos, README, cópias do OneDrive, os quatro testes sensíveis.

## 11. Diff do snapshot
31 arquivos, +1813/−95. FIX01/FIX02, correções da 3D.4.1-D, migrations anteriores e CI validado preservados (ci.yml só recebeu adições e as condições dos passos Playwright). `git diff --check` limpo.

## 12. Segredos
Varredura das linhas adicionadas (chaves privadas, `ghp_`, `AKIA`, URLs com credencial): sem achados.

## 13. Commit
`b6bd4dafa6388b7173567d83b645cddd87bb4bf9` — `feat(admin): add product availability management`.

## 14. Hash remoto
`git push --no-tags origin main:main` → `7765098..b6bd4da`; `ls-remote`: `refs/heads/main` = `b6bd4dafa6388b7173567d83b645cddd87bb4bf9`. O remoto não havia avançado antes. Sem force, tags, mirror ou merge.

## 15. Estado do original
HEAD `3b857ad`, índice vazio, 82 refs, sem remoto, não modificado por Git; quatro testes sensíveis sem diff.

## 16. Estado do snapshot
`main` em `b6bd4da`, árvore limpa, igual ao remoto. Workflow não disparado.

## 17. Primeira execução CI (NÃO disparada — aguarda autorização)
Ordem, parando na primeira falha:
- **CI A — integração:** Actions → CI → Run workflow em `main`: `run_backend=false`, `run_frontend=false`, **`run_e2e=true`**, **`run_integration=true`**, **`run_playwright=false`**, `run_order_ops=false`, `run_product_availability=false`, `upload_diagnostics=true` só se falhar. Prova: 7 migrations em PostgreSQL 18 efêmero, ACL por coluna, CAS, concorrência (2 e 8), rollback, disponibilidade × pedido, resíduo zero.
- **CI B — jornada existente:** `run_e2e=true`, `run_integration=false`, `run_playwright=true`, `run_order_ops=false`, `run_product_availability=false`.
- **CI C — disponibilidade:** `run_e2e=true`, `run_integration=false`, `run_playwright=true`, `run_order_ops=false`, **`run_product_availability=true`**.

## Pendências de validação real
Tudo o que só o PostgreSQL/navegador prova (ACL efetiva, CAS, corrida com pedido, rollback, 7 migrations, jornada de navegador, resíduo zero). O teste de integração e a jornada Playwright nunca rodaram e podem ter falhas próprias; migration 7 não aplicada em nenhum banco persistente.
