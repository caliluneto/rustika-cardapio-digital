# Gestão administrativa de pedidos — Etapa 3D.4.1

Escopo: o estabelecimento visualiza os pedidos ativos e move cada pedido pelos estados do domínio. **Estado desta
entrega:** implementado e testado localmente **sem banco**; a migration de privilégio está **preparada e não aplicada**;
os testes com PostgreSQL real e o E2E estão **preparados e não executados**. Nada aqui afirma prontidão para produção.

Pré-requisito do uso real: produtos com disponibilidade `AVAILABLE` (hoje o padrão é `UNKNOWN`, e o pedido exige
`AVAILABLE`). A gestão de disponibilidade é a etapa seguinte (3D.4.2) e **não** faz parte desta.

## Estados e transições (fonte única: `src/domain/rules.ts`)

```text
RECEIVED       -> IN_PREPARATION | CANCELLED
IN_PREPARATION -> READY          | CANCELLED
READY          -> DELIVERED
DELIVERED, CANCELLED: finais
```

O serviço reutiliza `canTransitionOrder`; `ORDER_STATUSES` e `nextOrderStatuses` foram derivados da mesma tabela
(não existe segunda máquina de estados). `READY` não pode ser cancelado.

## `GET /api/admin/orders`

- Exige sessão administrativa (cookie `rustika_admin`). Sem sessão/cookie inválido/admin desativado: `401`.
- **Sem parâmetros**: o roteador administrativo recusa qualquer query string (`400`). Por isso não há paginação.
- Retorna pedidos **ativos** (`RECEIVED`, `IN_PREPARATION`, `READY`), mais antigos primeiro (`createdAt`, desempate
  por `orderNumber`), no máximo **100**; `truncated: true` quando há mais.
- `Cache-Control: no-store`. Limite de taxa: 120 requisições/min por origem do limitador de acesso.
- Campos mínimos: `id, orderNumber, status, comandaNumber, customerName, tableOrReference, notes, totalInCents,
  createdAt, updatedAt, allowedTransitions[], items[{productNameSnapshot, quantity, unitPriceInCentsSnapshot,
  subtotalInCents, notes}]`. **Não** retorna telefone, `requestDigest`, `idempotencyKey`, `trackingTokenHash` nem
  identificadores de sessão.

```json
{ "success": true, "data": { "truncated": false, "orders": [ { "id": "…", "orderNumber": 12, "status": "RECEIVED",
  "allowedTransitions": ["IN_PREPARATION", "CANCELLED"], "…": "…" } ] } }
```

## `PATCH /api/admin/orders/:orderId/status`

Corpo estrito (campos extras são rejeitados):

```json
{ "expectedStatus": "RECEIVED", "toStatus": "IN_PREPARATION", "notes": "opcional, 1–300 caracteres, sem controle" }
```

Proteções de escrita iguais às dos demais POST: `Origin` exato, `X-Rustika-Request: 1`, `Content-Type: application/json`
(`403` / `415`). Resposta `200`: `{ "success": true, "data": { "order": { …mesma visão da listagem… } } }`.

| Situação | HTTP | `error.code` |
| --- | --- | --- |
| Sem sessão administrativa | 401 | (código de autenticação existente) |
| `orderId` não é UUID | 400 | `INVALID_ORDER_ID` |
| Status desconhecido | 400 | `INVALID_STATUS` |
| Campo ausente/extra/tipo errado, `notes` inválida | 400 | `INVALID_INPUT` |
| Pedido inexistente | 404 | `ORDER_NOT_FOUND` |
| `expectedStatus` ≠ status atual (ou perdeu a corrida) | 409 | `STATUS_CONFLICT` |
| Não conseguiu serializar após 3 tentativas | 409 | `ORDER_CONFLICT` |
| Transição proibida pelo domínio | 422 | `INVALID_TRANSITION` |
| Falha interna | 500 | `INTERNAL_ERROR` (mensagem genérica, sem detalhes) |

## Controle de concorrência

Uma única transação **Serializable** (`maxWait` 5 s, `timeout` 10 s):

1. reautentica o administrador **dentro** da transação (admin desativado no meio não grava nada);
2. lê o status atual; compara com `expectedStatus` (`409` se diferente) e valida a transição (`422`);
3. **compare-and-set**: `UPDATE … WHERE id = :id AND status = :expectedStatus`; se não atualizar exatamente 1 linha, `409`;
4. insere **uma** linha em `order_status_history` (`fromStatus`, `toStatus`, `changedByAdminId`, `notes`) na mesma transação;
5. relê e devolve o pedido.

Conflitos de serialização (`P2034`) são repetidos até 2 vezes; depois, `409 ORDER_CONFLICT`. Qualquer erro desfaz a
transação inteira (status e histórico juntos). Duas atualizações simultâneas do mesmo pedido: uma vence, a outra recebe `409`,
e há um único histórico. Repetir a mesma requisição (duplo clique) recebe `409` e não duplica o histórico.

## Privilégios PostgreSQL e migration (preparada, **não aplicada**)

Arquivo: `prisma/migrations/20261105000000_order_status_update_privilege/migration.sql`
(SHA-256 `3d6a7a6d0ce3f595501dc6343c19858beb2b9fecd1ebe1fd1fbecf5603031d84`, fixado em `EXPECTED_MIGRATIONS`).

- Concede à role de runtime **somente** `UPDATE (status, updated_at) ON public.orders`. Nenhum `UPDATE` em nível de tabela,
  `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, `GRANT OPTION` ou outra tabela/coluna.
- Mesmos guardas da migration anterior: banco permitido, identidade `cardapio_migrator`, versão ≥ 17, atributos/memberships das
  roles. Exige o estado da `20261104000000_runtime_least_privilege` (sem ACL de coluna, sem `UPDATE`/`DELETE` em `orders`);
  caso contrário, aborta.
- Pós-condição verificada na mesma transação (qualquer desvio aborta e desfaz o `GRANT`).
- `has_table_privilege` continua `SELECT,INSERT` em `orders` (privilégio de coluna não conta como de tabela); a matriz
  `PERMISSIONS_SQL` passou a aceitar **exclusivamente** essa ACL de coluna (sem `PUBLIC`, sem fixtures, sem `GRANT OPTION`,
  sem outras colunas) e a rejeitar qualquer outra.
- Validação feita: sintaxe pelo parser do PostgreSQL (libpg-query, offline) e testes estáticos. **Nenhuma conexão com banco.**
- Até ser aplicada, o preflight da suíte de integração aborta por "migrations pendentes" (por desenho).

## Painel administrativo (frontend)

Seção **Pedidos** no painel existente (`#admin`), só montada com sessão administrativa válida. Mostra comanda, cliente,
referência, itens e quantidades, total, status e horários; ações oferecidas = `allowedTransitions` devolvido pela API;
confirmação explícita antes de enviar (cancelar pede motivo opcional e avisa que não é reversível); `409/422/404` mostram
mensagem de conflito e recarregam a lista; falhas de rede/5xx não vazam detalhes; `401` encerra a sessão local.
Atualização por **polling de 10 s** encadeado (a próxima consulta só é agendada ao terminar a anterior), sem sobreposição,
cancelado ao desmontar. Sem WebSocket/Socket.IO/EventSource.

## Testes

| Arquivo | O que cobre | Estado |
| --- | --- | --- |
| `backend/tests/order-admin.test.ts` (+ `fixtures/orderOps.ts`) | autenticação, listagem, ordenação, limite, vazamento, PATCH (inválidos, 404, 409, 422, concorrência simulada, rollback, histórico, 500 genérico) | executado localmente, sem banco |
| `backend/tests/scripts/order-status-privilege-migration.test.ts` | migration estática, checksum, matriz ACL | executado localmente |
| `backend/tests/e2e-order-ops.test.ts` | verificação do estado final da jornada E2E | executado localmente |
| `frontend/tests/admin-orders.test.mjs` | cliente HTTP, polling, visão, estrutura | executado localmente |
| `backend/tests/integration-db/order-operations.integration.ts` | transação/serialização/ACL por coluna em PostgreSQL real | **preparado para CI; não executado** |
| `frontend/tests/e2e.spec.ts` (passo 7) | jornada: pedido → admin vê → muda status → conflito/transição inválida; teardown confere histórico | **preparado; não executado** |

O duplo em memória testa a **orquestração**; isolamento Serializable e rollback reais só são provados pelos testes de integração.

## E2E (opt-in)

`RUSTIKA_E2E_ORDER_OPS=enabled` no ambiente do setup liga o passo 7 da jornada; o manifesto registra `journey.orderOps` e o
`verifyJourney` do teardown passa a exigir `IN_PREPARATION` e exatamente duas linhas de histórico (a segunda feita pelo
administrador da execução). Sem a variável, a jornada e a verificação originais permanecem idênticas. O `ci.yml` **não** foi
alterado nesta etapa; habilitar a variável é decisão da etapa de validação no GitHub Actions.

## Limitações conhecidas

- Sem paginação nem filtros (restrição do roteador administrativo); teto de 100 pedidos ativos, com aviso de truncamento.
- Sem busca de pedidos finalizados/histórico na interface; o histórico fica no banco.
- Sessões administrativas continuam em memória (uma instância); o rate limit também.
- Cancelar não notifica o cliente; não há rastreamento público do pedido (`trackingTokenHash` reservado e não usado).
- Disponibilidade de produtos depende da etapa 3D.4.2.
