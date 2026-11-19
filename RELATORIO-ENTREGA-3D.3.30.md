# RELATÓRIO DE ENTREGA — Etapa 3D.3.30

**Encerramento do CI e retomada do desenvolvimento funcional**
Projeto: RÚSTIKA — Cardápio Digital · Data: 2026-11-05

> Fora dos commits. Etapa de análise e documentação: nenhum código de aplicação foi alterado, nenhum commit, push ou workflow.

## 1. Encerramento documentado da etapa 3D.3.29

| Item | Resultado confirmado (capturas do GitHub Actions informadas pelo usuário) |
| --- | --- |
| Publicação | Snapshot sanitizado em repositório privado, `main` = `b09c084fb5b1c3207a8cd1c3c5cc98cbf1eb8da7` (4 commits independentes) |
| CI #3 | Backend 747 testes aprovados; frontend aprovado; E2E não executado |
| CI #5 (E2E) | PostgreSQL 18 efêmero, migrations, fixtures sintéticas; Playwright/Chromium **1 teste em 8,6 s** (login → convite → resgate → pedido → verificação); teardown e prova de resíduo zero aprovados; banco e segredos descartados |
| Correções feitas | FIX01 (contexto `runner` em `env`), FIX02 (saída estruturada da inspeção) — ambas **só no snapshot** (ver seção 6) |

Fase GitHub Actions encerrada. Ressalva honesta: o E2E cobre **uma** jornada de caminho feliz; "CI verde" não é prontidão para produção.

## 2. Documentos atualizados (no repositório original, sem commit)

| Arquivo | Mudança |
| --- | --- |
| `README.md` | Reescrito a partir do código: tecnologias, estrutura, funcionalidades com legenda IMPLEMENTADO/TESTADO/PARCIAL/PENDENTE, CI confirmado, ambiente local, variáveis, comandos, procedimento de testes, limitações, pendências antes de produção. Sem caminhos locais do usuário. Substitui o texto "Fase 1B", que dizia que autenticação, carrinho e pedidos não existiam. |
| `backend/docs/github-actions-e2e.md` | Estado trocado de "preparado, NÃO executado" para executado e validado; resultados CI #3/#5; correções FIX01/FIX02; limites do que foi provado |
| `backend/docs/e2e-real.md` | Estado: executado no GitHub Actions; continua não executado localmente |
| `backend/docs/publication-snapshot.md` (novo) | Fluxo de desenvolvimento original → snapshot, regras de divergência e riscos |

Os documentos de API (`catalog-api.md`, `access-api.md`, `orders-api.md`) foram conferidos por amostragem contra as rotas e não foram alterados.

**Atenção:** o README e os dois docs de CI já descrevem arquivos que só existem no snapshot (`e2e-state-contract.ts`, `validate-e2e-state.ts`, scripts `e2e:validate-state`). Até o backport (seção 6) o original está defasado em relação à documentação.

## 3. Matriz de funcionalidades existentes (evidência no código)

Testes: backend `tests/` (Vitest) e frontend `tests/` (`node --test`, 99). Contagens são de casos `it` por arquivo.

| Funcionalidade | Estado | Evidência | Testes |
| --- | --- | --- | --- |
| Catálogo público: categorias e produtos | IMPLEMENTADO | `routes/catalog.routes.ts`, `services/catalog.service.ts` (só ativos, publicáveis, cursor) | `catalog.test` 11, `catalog.service.test` 13, `categoryPublication.test` 5; front `catalog-api` 17, `catalog-state` 9 |
| Catálogo na interface (nav por categoria, modal, estados de erro, modo `demo`) | IMPLEMENTADO | `components/Catalog*, ProductModal`, `services/catalogSource.ts` | lógica testada; layout só com `styles-smoke` (5), sem teste visual |
| Disponibilidade de produto | PARCIAL | enum `UNKNOWN/AVAILABLE/UNAVAILABLE`, padrão **UNKNOWN**; pedido exige `AVAILABLE` | regra testada em `order.service.test`; **nenhuma tela/rota altera a disponibilidade** |
| Carrinho (adicionar, quantidade, remover, total, preço esperado) | IMPLEMENTADO | `contexts/CartContext.tsx`, `CartDrawer.tsx` | `cart.test` 14. Estado só em memória (sem `localStorage`, intencional) |
| Comanda: convite de uso único, resgate, sessão (cookie, 8 h), expiração (convite 10 min) | IMPLEMENTADO | `services/comandaAccess.service.ts`, `routes/access.routes.ts`, `ComandaRedeem.tsx` | `access.test` 12, `access.service.test` 16, `accessLimits*` 24; E2E |
| Comanda: criação | PARCIAL | `comanda.upsert` ao emitir convite (cria se não existir) | coberto indiretamente; sem listagem/fechamento/cancelamento |
| Comanda: fechar/cancelar | PENDENTE | transições existem em `domain/rules.ts`, sem rota nem tela | só regra pura |
| Pedido: revisão e envio | IMPLEMENTADO | `OrderReview.tsx`, `Checkout.tsx`, `orderSubmission.ts`; **envio desligado por padrão** (`VITE_ORDER_SUBMISSION=enabled`) | `order-submission` 8, `order-recovery` 10, `order-review` 2, `checkout` 1 |
| Pedido: criação no servidor (preço, disponibilidade, total, Serializable, retentativa) | IMPLEMENTADO | `services/order.service.ts`, `routes/order.routes.ts` | `order.service.test` 18, `orders.test` 12, `orders-csrf` 7, `orders-rate-limit` 11 |
| Pedido: idempotência (`Idempotency-Key` + digest, 409 em conflito) | IMPLEMENTADO | `order.service.ts` | unitário + E2E (caminho feliz) |
| Pedido: histórico de status | PARCIAL | só a linha inicial `null → RECEIVED` é gravada | sem escrita de transições |
| Pedido: status (`RECEIVED → IN_PREPARATION → READY → DELIVERED`, `CANCELLED`) | PARCIAL | `canTransitionOrder` em `domain/rules.ts` **não é chamada por nenhum serviço/rota** | `domain/rules.test` 7 (regra pura) |
| Admin: login/logout/sessão (cookie HttpOnly, SameSite=Strict, 1 h) | IMPLEMENTADO | `adminAuth.service.ts`, `security/adminSessions.ts` (sessões **em memória**) | `access.test`, `access.service.test`; E2E |
| Admin: emitir convite | IMPLEMENTADO | `AdminDashboard.tsx` (única função do painel) | idem |
| Admin: listar pedidos recebidos | PENDENTE | não há rota `GET` de pedidos; painel só emite convite | — |
| Admin: atualizar status | PENDENTE | não há rota/tela | — |
| Admin: gestão de produtos/categorias | PENDENTE | nenhuma rota de escrita; role de runtime só tem `SELECT` nessas tabelas | — |
| Admin: permissões por papel | PENDENTE | todo admin ativo é equivalente | — |
| Cliente: acompanhar status | PENDENTE | `trackingTokenHash` reservado no schema, sem uso | — |
| Segurança de escrita (Origin + `X-Rustika-Request`, JSON, limites de taxa em memória) | IMPLEMENTADO | `security/writeGuard.ts`, `accessLimits.ts` | `orders-csrf`, `accessLimits*` |
| Privilégio mínimo no banco (runtime: `SELECT, INSERT` em pedidos/itens/histórico/sessões) | IMPLEMENTADO | migration `20261104000000_runtime_least_privilege` | `least-privilege-migration.test` 9, `fix-permissions-migration.test` 11 |
| CI e E2E efêmero | IMPLEMENTADO | `.github/workflows/ci.yml` | `ci-config.test` 26, `e2e-fixtures.test` 34 |

## 4. Lacunas reais do MVP

1. **Estabelecimento não vê nem opera pedidos.** Pedidos entram no banco e ficam em `RECEIVED` para sempre; o painel só emite convite.
2. **Nenhum produto pode ser pedido com o catálogo real.** Produtos importados nascem `UNKNOWN`; o pedido exige `AVAILABLE`; não existe forma de marcar disponibilidade sem escrever no banco.
3. **Envio de pedidos desligado por padrão** no frontend; falta decidir o valor para o ambiente real.
4. Comandas não podem ser listadas, fechadas ou canceladas.
5. Cliente não acompanha o pedido.
6. Sem CRUD de catálogo (produtos, preços, categorias); mudar preço depende do script de seed/SQL.
7. Sessões de admin em memória: reinício do servidor desloga todos; limitação a uma instância (mesma para os limitadores de taxa).
8. Cobertura E2E de uma jornada; sem cenários de falha.
9. Pendências não funcionais antes de produção: senhas fracas/compartilhadas (rotação), hospedagem, TLS, backup/restore, observabilidade.

## 5. Priorização

| Lacuna | Prioridade | Justificativa | Risco | Dependências |
| --- | --- | --- | --- | --- |
| Listar pedidos + atualizar status (histórico) | **P0** | Sem isso o pedido não chega à cozinha/bar | médio: concorrência e privilégio de banco | migration de privilégio, painel admin |
| Gestão mínima de disponibilidade do produto | **P0** | Sem isso nenhum pedido real é aceito | baixo/médio | privilégio de `UPDATE` em coluna de `products` |
| Decisão e documentação de `VITE_ORDER_SUBMISSION` por ambiente | P0 (configuração) | Envio desligado por padrão | baixo | — |
| Fechar/cancelar/listar comandas | P1 | Controle do consumo | médio | privilégios já existem (`UPDATE` em comandas) |
| Acompanhamento do pedido pelo cliente | P1 | Reduz perguntas ao garçom | médio (token de acompanhamento) | status operando |
| CRUD de produtos e categorias | P1 | Hoje depende de seed/SQL | médio | privilégios, validação, auditoria |
| Sessões de admin persistentes; papéis | P2 | Operação com 1 instância e 1 admin funciona | baixo | — |
| Tempo real (SSE/WebSocket) | P2 | Polling basta no MVP | — | — |
| Mais cenários E2E | P1 (qualidade, junto de cada entrega) | Caminho feliz único | — | CI |

Pagamentos online, fiscal, delivery e upload de imagens permanecem fora do escopo; nada foi proposto.

## 6. Estratégia de sincronização segura (original ↔ snapshot)

Procedimento completo em `backend/docs/publication-snapshot.md`. Resumo:

1. Desenvolver no **original**; testes locais sem escrita em PostgreSQL (`typecheck`, `build`, `test:ci`, `npm test`).
2. Revisar o diff e **fixar a lista de arquivos**.
3. Copiar **somente esses arquivos** ao snapshot (nunca a pasta, nunca `.git`).
4. Sanitizar e varrer segredos nos arquivos transferidos (senhas reais em memória, chaves, tokens, URLs com credencial, nomes proibidos, caminhos locais).
5. Rodar testes e validação do workflow no snapshot; commit; `git push --no-tags origin main:main`.
6. Executar os workflows e registrar o resultado.

Regras: os históricos nunca são unidos; o original não tem remote; correções feitas no snapshot são **portadas de volta** ao original.

**Backport pendente (primeira transferência inversa), snapshot → original:** `.github/workflows/ci.yml` (FIX01 e FIX02), `backend/scripts/e2e-state-contract.ts`, `backend/scripts/validate-e2e-state.ts`, `backend/scripts/inspect-e2e-state.ts` (opção `--out`, `collectState`/`emitState`), `backend/package.json` (script `e2e:validate-state`), `backend/tests/ci-config.test.ts`, `backend/tests/e2e-state-contract.test.ts`. Sem esse backport a próxima transferência do original sobrescreveria as correções.

**Sanitizações a repetir ao transferir:** 4 testes (`checkout.test.mjs`, `cart.test.mjs`, `order-review.test.mjs`, `rules.test.ts`) com valor sintético no lugar do valor sensível; caminhos `C:\Users\<nome>\` em documentação. **Recomendação:** aplicar essas trocas também no original (commit local futuro) para eliminar a divergência; exige autorização por ser alteração de teste do original.

Riscos: ver tabela em `publication-snapshot.md` (credencial copiada, divergência de código, push errado, falso conforto do CI).

## 7. Próxima entrega funcional recomendada

**3D.4.1 — Operação de pedidos pelo estabelecimento (listar pedidos ativos e avançar status).** É a menor entrega que elimina a lacuna P0 nº 1 e reaproveita o que existe (`canTransitionOrder`, `OrderStatusHistory`, autenticação de admin, `writeGuard`, E2E efêmero). A disponibilidade de produtos (lacuna nº 2) fica como **3D.4.2**, logo depois, porque também bloqueia pedidos reais.

### Contratos

Todas as rotas exigem sessão de admin (cookie `rustika_admin`), `Cache-Control: no-store`, e as escritas passam por `assertWriteRequest` (Origin exata + `X-Rustika-Request: 1` + JSON) e limite de taxa.

1. `GET /api/admin/orders` — sem parâmetros de consulta (o `noStore` do `adminRouter` rejeita `?…`; filtros ficam para depois ou usam caminho). Retorna os pedidos **ativos** (`RECEIVED`, `IN_PREPARATION`, `READY`), mais antigos primeiro, no máximo 200:
   `{ success: true, data: { orders: [{ id, orderNumber, status, comandaNumber, customerName, customerPhone, tableOrReference, notes, totalInCents, createdAt, updatedAt, items: [{ productNameSnapshot, quantity, unitPriceInCentsSnapshot, subtotalInCents, notes? }], allowedTransitions: OrderStatus[] }] } }`
2. `PATCH /api/admin/orders/:orderId/status` — corpo `{ "toStatus": "IN_PREPARATION" | "READY" | "DELIVERED" | "CANCELLED", "expectedStatus": <status que o admin viu> }`:
   - valida com `canTransitionOrder`;
   - transação Serializable: `updateMany` condicionado a `status = expectedStatus` (compare-and-set) + `OrderStatusHistory { fromStatus, toStatus, changedByAdminId }`;
   - `200` com o pedido atualizado; `404 ORDER_NOT_FOUND`; `409 STATUS_CONFLICT` (já mudou, devolve o status atual); `422 INVALID_TRANSITION`; `401/403` sem sessão/origem; `400` corpo inválido;
   - cancelamento aceita `notes` opcional (motivo), gravado no histórico.
3. Migration de privilégio mínimo (nova, revisada): `UPDATE` **apenas** nas colunas `status` e `updated_at` de `public.orders` para a role de runtime — nenhum outro privilégio novo.

### Arquivos afetados

Backend: `routes/orderAdmin.routes.ts` (novo) ou extensão de `access.routes.ts`, `services/orderOperations.service.ts` (novo), `mappers/order.mapper.ts` (seleção admin), `app.ts` (montagem), nova migration em `prisma/migrations/`, `docs/orders-api.md`.
Frontend: `pages/AdminDashboard.tsx` (seção "Pedidos"), `services/api.ts` (cliente), componente de lista/cartão de pedido, estilos.
Testes/CI: `tests/integration-db/support/permissions.ts` e testes de migração (`least-privilege-migration`, harness de ACL efetiva do E2E) atualizados para a nova concessão **sem afrouxar** nenhum gate; `tests/e2e-fixtures.test.ts` e o manifesto/teardown já removem pedidos e histórico por `orderId`.

### Testes e critérios de aceite

- **Unitário (Vitest):** todas as combinações de transição (válidas e inválidas); `expectedStatus` divergente → 409; pedido inexistente; histórico gravado com `changedByAdminId`; sem sessão → 401; Origin/cabeçalho inválidos → 403; query string → 400; admin inativo → 401; lista só traz pedidos ativos e sem dados sensíveis (sem hashes/digest).
- **Concorrência (integração, PostgreSQL efêmero no CI):** duas mudanças simultâneas do mesmo pedido: exatamente uma vence, a outra recebe 409, o histórico tem uma linha por mudança efetiva.
- **ACL:** a role de runtime consegue atualizar só `status/updated_at`; qualquer outra coluna ou tabela continua negada (teste no harness de permissões).
- **Frontend (`node --test`):** cliente de API (401 → logout, 409 → recarrega e avisa), regras de quais botões aparecem por status, formatação.
- **E2E (CI efêmero):** após o pedido, o admin vê o pedido, avança `RECEIVED → IN_PREPARATION → READY → DELIVERED`, o histórico tem 4 linhas, e o teardown mantém "resíduo zero".
- **Aceite:** typecheck, builds, `test:ci` e frontend aprovados localmente; CI backend/frontend/E2E aprovados no GitHub; nenhuma regressão (747 backend + 99 frontend + E2E atuais continuam passando); nenhum gate enfraquecido.
- **Fora do escopo:** acompanhamento pelo cliente, tempo real, impressão, filtros/paginação de histórico, papéis de admin, pagamentos.

### Riscos e dependências

- **Privilégio de banco:** o hardening usa `REVOKE` em tabela e concessões explícitas; nota no código ("Table REVOKE cannot remove column grants") exige cuidado com concessão por coluna. A migration precisa de revisão separada e os testes de ACL precisam ser ajustados com precisão.
- **Concorrência:** sem compare-and-set, dois atendentes podem sobrescrever o status.
- **Sessões de admin em memória e limite de taxa por instância:** aceitáveis para uma instância; reiniciar o backend desloga o painel.
- **Polling:** atualização a cada ~10 s no painel; tempo real fica para P2.
- **Divergência de repositórios:** a entrega nasce no original e precisa do backport e da transferência sanitizada (seção 6) antes do CI.
- **Autorizações necessárias:** aplicar a migration em qualquer banco real e qualquer escrita local exigem autorização; os testes de escrita rodam só no PostgreSQL efêmero do CI.

## 8. Estado final dos dois repositórios

| | Estado |
| --- | --- |
| Original (OneDrive) | Branch `main`, HEAD `3b857ad`, 82 refs, sem remote. Modificados nesta etapa (não commitados): `README.md`, `backend/docs/e2e-real.md`, `backend/docs/github-actions-e2e.md`; novo, não rastreado: `backend/docs/publication-snapshot.md`, este relatório. Nenhum commit, stage, remote ou push. |
| Snapshot | Não tocado nesta etapa: HEAD `b09c084fb5b1c3207a8cd1c3c5cc98cbf1eb8da7`, 4 commits, `origin` = GitHub privado. As atualizações de documentação ainda **não** foram transferidas. |
| Credenciais / PostgreSQL / workflows | Nada alterado, executado ou disparado. |

## 9. Pendências

1. Transferir README e docs atualizados para o snapshot (sanitizados) e publicar, junto do backport (seção 6).
2. Autorizar o commit local no original das alterações de documentação e, opcionalmente, da troca dos valores sensíveis nos 4 testes.
3. Rotacionar as senhas locais antes de qualquer uso fora do notebook (pendência de 3D.3.27).
4. Aprovar o escopo da 3D.4.1 e enviar este relatório ao ChatGPT para o prompt de implementação.
