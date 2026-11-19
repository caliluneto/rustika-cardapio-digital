# RELATÓRIO DE ENTREGA — ETAPA 3D.4.2
Gestão administrativa da disponibilidade de produtos (arquivo local; não publicado)

Autorização cumprida: implementar a etapa 3D.4.2 e preparar seus testes, **sem executar migrations ou publicar alterações**.
Sem commit, push, workflow, Playwright, integração, seed, importação ou escrita em PostgreSQL local. Repositório original:
HEAD `3b857ad`, índice vazio, 82 refs, sem remoto; os quatro testes sensíveis sem diff. Aguarda auditoria do ChatGPT antes da transferência ao snapshot.

## 1. Estado inicial
Última publicação: `7765098f74237c12b6d2f42195f4957bcaa13b86` (3D.4.1 validada no CI: integração, Playwright original e ampliado, 6 migrations, resíduo zero). Snapshot em `7765098`, árvore limpa.

## 2. Política de disponibilidade (investigação)
`Product.availabilityState` (`UNKNOWN|AVAILABLE|UNAVAILABLE`) é a **única fonte de verdade**: o catálogo público já mapeia `UNKNOWN→null`, `AVAILABLE→true`, `UNAVAILABLE→false` e o pedido exige `AVAILABLE` (`409 PRODUCT_UNAVAILABLE`). O campo legado `isAvailable` (boolean, padrão `true`) não é lido por `src` e **não é escrito nem recebe privilégio**. Sem enum/campo novo. Nada converte `UNKNOWN` em `AVAILABLE` sozinho; sem atualização em massa dos 174 ativos.
Só é gerenciável o que o catálogo pode publicar (predicado único `publicProductWhere`, agora exportado por `catalog.service.ts` e reutilizado): ativo, `publicKey`, `sourceCode/Name/Group`, categoria ativa com `publicKey`. Inativo, insumo interno e categoria não pública → `422 PRODUCT_NOT_MANAGEABLE`. Preço, categoria, chaves, `isActive`, estoque, importação, pedidos e snapshots nunca são tocados; não há histórico de pedidos para disponibilidade.

## 3. Backend
- `src/services/productAvailability.service.ts` (novo): `list` e `updateAvailability`. Transação **Serializable**, reautenticação dentro da transação, leitura → 404/422/409 → **compare-and-set** (`updateMany` com `publicKey + availabilityState = expectedState`, uma coluna escrita) → releitura; `P2034` até 2 retentativas, depois `409 PRODUCT_CONFLICT`. Autenticação antes da validação (401 antes de 400).
- `catalog.mapper.ts`: `adminProductSelect`/`mapAdminProduct` (id = chave pública; sem UUID interno, descrição, imagem, estoque, `isAvailable`).
- `access.routes.ts`: `GET /api/admin/products` (sem query string, 120/min) e `PATCH /api/admin/products/:productId/availability` (`writeGuard`, 60/min, JSON estrito). Compartilham `auth` com as demais rotas administrativas; Origin/CSRF e a proibição de query string do roteador preservados.
- Decisão de contrato: sem parâmetros de consulta; lista completa (limite 500, `truncated`), filtros no cliente. Documentação: `backend/docs/product-availability.md`.

## 4. Transições
Qualquer estado → `AVAILABLE` ou `UNAVAILABLE`, diferente do atual. `UNKNOWN` nunca é alvo (`422 INVALID_TRANSITION`). Corpo com campo extra, estado desconhecido, id fora de `rustika-<código>` → `400`. Inexistente → `404`. `expectedState` divergente → `409 AVAILABILITY_CONFLICT`.

## 5. Migration (preparada, NÃO aplicada)
`backend/prisma/migrations/20261106000000_product_availability_update_privilege/migration.sql` — SHA-256 `3665ed812c4033527d17c6de3a7c66a623d659d676c719fc1b6f6477f7e69308`, LF. Único efeito: `GRANT UPDATE (availability_state, updated_at) ON public.products TO <runtime>`. Sem `UPDATE` de tabela, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, `GRANT OPTION`, outras colunas (preço, `is_active`, `category_id`, chaves, `is_available`…) ou tabelas. Guardas: banco, identidade `cardapio_migrator`, PG ≥ 17, atributos/membros das roles, colunas existentes, estado anterior exato (a única ACL de coluna em `public` é a da migration 6, que continua com a guarda original `attacl IS NOT NULL` por rodar antes). Pós-condição na mesma transação. Sintaxe validada offline pelo parser do PostgreSQL (SQL + PL/pgSQL). `updated_at` entra no grant porque o Prisma (`@updatedAt`) o grava a cada `updateMany`.

## 6. Preflights e ACL
`EXPECTED_MIGRATIONS` com 7 entradas (nome + checksum das 6 anteriores intactos); diretório em disco == conjunto esperado. `PERMISSIONS_SQL`: tolera somente as duas ACLs de coluna revisadas (orders e products, sem `GRANT OPTION`, só a role de runtime) e exige que nenhuma outra coluna de `products` seja atualizável pela role de runtime. Contagens atualizadas em testes e docs (README local, `e2e-real.md`, `integration-db.md`, comentário de `lifecycle.ts`).

## 7. Frontend — painel "Produtos"
`services/adminProducts.ts` (cliente, validação de resposta, filtros, mensagens de erro), `pages/AdminProducts.tsx` (view pura + container), montado em `AdminDashboard` (desmontado durante o logout), CSS responsivo no tema existente. Lista com nome, código, categoria, preço (somente leitura) e estado; busca por nome/código sem acento; filtros por categoria e disponibilidade; ação com **confirmação** (Confirmar/Voltar); aviso de sucesso/erro/conflito; atualização controlada (botão e após cada mudança), requisição cancelada ao desmontar, sem polling. Sem edição de preço, exclusão, importação ou upload. 401 → volta ao login; 409/422/404 → recarrega a lista.

## 8. Experiência do cliente
Já existente e preservada: produto `false` não entra no carrinho (reducer) e o modal diz "indisponível para adicionar"; `null` é rotulado "Disponibilidade não confirmada" e o servidor decide (testes existentes exigem que `null` possa entrar no carrinho; o reducer **não foi alterado**); `PRODUCT_UNAVAILABLE` mostra "Algum item não está mais disponível. Revise o carrinho." e **não limpa o carrinho** (limpeza só após pedido confirmado). Testes de regressão novos fixam esse comportamento. Nenhum código público foi alterado.

## 9. Pedido e concorrência
`order.service.ts` inalterado: valida `AVAILABLE` dentro da transação Serializable. Indisponibilização confirmada antes do commit do pedido → pedido rejeitado (ou retentado e rejeitado), sem pedido parcial. A corrida real só é comprovável no PostgreSQL (teste preparado).

## 10. Testes backend (executados localmente, sem banco)
`tests/product-admin.test.ts` (**30**): sem sessão/cookie inválido/cookie de comanda; lista (ordem, campos mínimos, sem vazamento, limite+truncamento, vazia, query string recusada, 500 genérico); id inválido; inexistente; corpo inválido/campos extras; UNKNOWN→AVAILABLE gravando **só** `availabilityState`; AVAILABLE↔UNAVAILABLE; UNKNOWN como alvo; mesmo estado; `expectedState` divergente; 6 casos não gerenciáveis (inativo, categoria inativa, insumo interno, sem código/nome/grupo); 2 e 8 concorrentes; conflito de serialização; falha antes do commit; admin desativado; Origin/CSRF. Fixture: `tests/fixtures/productOps.ts`.
Também: `e2e-product-availability.test.ts` (14), `ci-config` (42), `integration-db-support`, `order-status-privilege-migration`, `least-privilege-migration`.
**Resultado: `npm run test:ci` = 41 arquivos passando, 861 testes passando, 7 ignorados (suíte de integração, sem banco); `tsc --noEmit` sem erros novos (apenas o arquivo legado `verify-fixtures-rotation.ts`, preexistente e não versionado); `npm run build` ok.**

## 11. Testes frontend
`tests/admin-products.test.mjs` (**19**, registrado em `package.json`): cliente HTTP (GET sem query string, PATCH só com `expectedState/toState`, cabeçalhos de escrita, cancelamento), contrato de resposta, filtros combinados, ações oferecidas, confirmação, erros, renderização (carregando/vazio/erro/truncado/avisos), integração com o painel e logout, ausência de polling, CSS responsivo, regressão do cliente. **Resultado: `npm test` = 136/136 (117 existentes + 19), `tsc` limpo, `vite build` ok.** Nenhum teste existente foi modificado.

## 12. Integração PostgreSQL real (preparada, NÃO executada)
`backend/tests/integration-db/product-availability.integration.ts` (CI, 7 migrations): lista só publicáveis; UNKNOWN→AVAILABLE persistindo só o estado (demais colunas idênticas); catálogo público coerente (`true/false/null`); transições inválidas; 401/404/400; inativo → 422; **2 e 8 concorrentes**; pedido com indisponível rejeitado sem pedido parcial; cliente vê → admin indisponibiliza → pedido rejeitado → volta a disponível → aceito; **corrida indisponibilizar × pedir**; **ACL por coluna** (preço, `is_active`, nome, `public_key`, `source_*`, `is_available`, `category_id`, descrição negados; DELETE/TRUNCATE/INSERT negados; UPDATE em `categories` negado; CAS no banco); rollback; sessão de outra instância rejeitada; uma única `app` por suíte (lição da 3D.4.1-D).

## 13. Playwright opt-in (preparado, NÃO executado)
Entrada `run_product_availability` (padrão `false`; 8 inputs booleanos). Quatro passos Playwright mutuamente exclusivos (comum / pedidos / disponibilidade / ambos), cada variável constante no `env` do passo, nunca no job nem em backend/frontend. Jornada (`RUSTIKA_E2E_PRODUCT_AVAILABILITY=enabled`): cliente vê o produto sintético "não confirmado" → admin o torna disponível pela interface com confirmação → API rejeita 409/422/400 → cliente vê, adiciona e pede (2º pedido) → outro produto no carrinho → admin o indisponibiliza → envio rejeitado `409 PRODUCT_UNAVAILABLE`, mensagem visível, carrinho preservado → catálogo mostra "Indisponível" e bloqueia a adição. O teardown (`verifyAvailability`, somente leitura) exige 2 pedidos, estados finais esperados, nenhum pedido com o produto bloqueado, e depois a limpeza cirúrgica (resíduo zero). A jornada original e a de pedidos seguem intactas (passo 7 virou função; mesma lógica). Nenhum gatilho automático.

## 14. Catálogo RÚSTIKA
204 total / 174 ativos / 30 inativos, classificação INSUMO/DIVERSOS, preços, códigos, categorias, `publicKey`s, regras de visibilidade e histórico de importação **não foram tocados** (nenhuma importação, reclassificação, seed ou conexão a banco).

## 15. Segurança
Admin obrigatório em ambas as rotas; Origin/CSRF e `X-Rustika-Request` na escrita; JSON estrito; sem query string; erros genéricos sem detalhes internos; resposta sem `isAvailable`/descrição/estoque/UUID; privilégio mínimo por coluna. Varredura de segredos nos 31 arquivos do manifesto: apenas dois placeholders/fixtures de redação preexistentes (`<senha-urlencoded>` em doc; `super-secret` em fixture de teste de redação). Os quatro testes sensíveis não foram alterados nem entram no manifesto.

## 16. Manifesto de transferência
`manifest-3d42-transfer.txt`: **31 caminhos** (21 modificados + 10 novos, comparados ao snapshot `7765098`; sem relatórios, manifestos, `.env`, cópias do OneDrive ou testes sensíveis). Copiar normalizando CRLF→LF (índice do snapshot é LF; a migration já é LF e `-text`). `README.md` do original **não** está no manifesto (diverge muito do snapshot); a única mudança local foi a contagem de migrations/testes, que o README do snapshot não contém.

## 17. Arquivos alterados
Modificados: `ci.yml`; `docs/{e2e-real,integration-db,order-operations}.md`; `catalog.mapper.ts`; `access.routes.ts`; `catalog.service.ts`; `ci-config.test.ts`; `integration-db-support.test.ts`; `e2e/{lifecycle,manifest}.ts`; `support/{fixtures,permissions,preflight}.ts`; `least-privilege-migration.test.ts`; `order-status-privilege-migration.test.ts`; `frontend/{package.json,index.css,AdminDashboard.tsx,e2e.spec.ts,globalSetup.ts}`.
Novos: `product-availability.md`; migration 7; `productAvailability.service.ts`; `product-admin.test.ts`; `e2e-product-availability.test.ts`; `fixtures/productOps.ts`; `product-availability.integration.ts`; `AdminProducts.tsx`; `adminProducts.ts`; `admin-products.test.mjs`.
Ajustes em testes existentes (necessários e declarados): contagens/pinagem de 6→7 migrations, ordem "última migration", `slice(5)`, 7→8 inputs e condições dos passos Playwright em `ci-config`.

## 18. Riscos e pontos para a auditoria
1. O que só o PostgreSQL real prova segue **não provado**: ACL por coluna efetiva, CAS/Serializable, corrida contra pedido, rollback, aplicação da migration 7. O teste de integração foi tipado mas nunca executado — pode conter falhas próprias, a analisar separadamente.
2. A jornada Playwright nunca rodou; seletores e tempos (recarga da página, segunda página do mesmo contexto como admin) são hipóteses até a primeira execução.
3. Produtos `UNKNOWN` ainda entram no carrinho (testes existentes exigem), sendo recusados só no envio; é decisão herdada, não nova.
4. Lista limitada a 500 (catálogo atual: 174 ativos); acima disso aparece `truncated` e a busca no cliente fica parcial.
5. Mudança de `isAvailable` legado fora de escopo: permanece divergente e inofensivo.
6. As migrations 6→7 dependem da ordem: a guarda de `attacl` da migration 6 continua estrita (roda antes).

## 19. Pendências
Auditoria do ChatGPT; transferência ao snapshot pelo manifesto; commit/push (autorização específica); primeira rodada de CI com `run_e2e=true`, `run_integration=true`, `run_playwright=false`; depois Playwright original; depois `run_order_ops`; depois `run_product_availability`. Aplicação da migration 7 em qualquer banco persistente só com autorização própria.

## 20. Listas de status
**IMPLEMENTADO:** serviço, rotas, mapper, predicado público compartilhado, migration 7, preflights/ACL, painel Produtos, CSS, harness E2E, workflow, documentação.
**TESTADO LOCALMENTE:** backend 861 passando/7 ignorados; frontend 136/136; `tsc` e builds; migration validada offline; YAML/shell do workflow; varredura de segredos; estado Git do original.
**PREPARADO PARA CI:** integração PostgreSQL de disponibilidade; Playwright opt-in `run_product_availability`; verificação `verifyAvailability`.
**NÃO EXECUTADO:** qualquer migration, integração, Playwright, workflow, commit, push, importação, seed, escrita em PostgreSQL.
**PENDENTE DE VALIDAÇÃO REAL:** ACL por coluna, CAS e concorrência (inclusive contra pedido), rollback, 7 migrations no PG 18, jornada de navegador, resíduo zero.

## 21. Conclusão
Etapa implementada e validada localmente dentro do escopo autorizado. Não afirmo que a disponibilidade funciona em banco real nem no navegador: isso depende do CI. Próximo passo: auditoria e, se aprovada, transferência ao snapshot conforme o manifesto.
