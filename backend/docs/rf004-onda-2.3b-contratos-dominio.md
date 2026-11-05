# RF004 — Onda 2.3B: proposta de contratos e domínio

**Estado:** proposta para revisão; sem endpoints, migrações, seed ou acesso a PostgreSQL nesta onda. Os tipos e as regras puras estão em `src/domain/contracts.ts` e `src/domain/rules.ts`. Mudanças de persistência e decisões marcadas como pendentes exigem aprovação antes da onda seguinte.

## 1. Contratos reais e compatibilidade

| Origem | Contrato efetivo | Consequência |
| --- | --- | --- |
| `frontend/src/types/catalog.ts` | `Category.id` é slug; `Product.id` é string, `categoryId` aponta para o slug, preço é `priceInCents`; `isAvailable?: boolean` e ausência significa desconhecido. | Manter chaves e preços em centavos na API; na adaptação futura, `isAvailable: null` do backend vira `undefined` no modelo visual, nunca `true` por padrão. |
| `frontend/src/mocks/catalog.ts` | Dez slugs na ordem `porcoes`, `cervejas`, `drinks`, `sem-alcool`, `energeticos`, `drinks-prontos`, `doses`, `garrafas`, `combos`, `gelo-de-coco`; 138 registros aprovados. `Product.id = rustika-${sourceCode}`; `sourceName` e `sourceGroup` são preservados; descrições só para códigos conferidos. | Importação futura deve reconciliar todos os 138 códigos, preservar nomes/grupos/descrições aprovados e os dez slugs; não inferir estoque, receitas ou imagens. |
| `frontend/src/contexts/cart.ts`, `CartContext.tsx` | Carrinho local guarda cópia do produto, máximo de 99 por item, bloqueia duplicata de preço diferente e calcula total em inteiros seguros; comanda é string ou `null`. | Carrinho e total exibidos não autorizam operação nem definem preço; não substituir seu comportamento nesta onda. |
| `frontend/src/contexts/comanda.ts`, `orderReview.ts`, `components/OrderReview.tsx` | Comanda numérica de 1–6 caracteres, com espaços externos removidos pela UI; revisão só verifica pré-condições locais e avisa que nenhum pedido é enviado. | Número é identificador público, **não** credencial; revisão não vira envio sem fluxo de convite, sessão e confirmação de preços. |
| `backend/prisma/schema.prisma` | Category e Product usam UUID interno; Product tem `Decimal(10,2)` e `isAvailable Boolean @default(true)`; Order exige customerName, tableOrReference, idempotencyKey global único e trackingTokenHash; OrderStatus não tem CANCELLED; não existem Comanda nem sessão. | O código puro não espelha diretamente o schema atual; adequações dependem de migration futura e aprovação de política de dados legados. |

**Chaves estáveis:** categoria usa exatamente o slug acima; produto usa exatamente `rustika-<sourceCode>` (código tratado como texto, sem conversão para número). Chave pública imutável e única; UUID interno só para relações no banco. Não renomear chaves por mudança de nome/preço/grupo. Alterações na classificação devem preservar `categoryId` público e registrar a nova relação sem recriar produto. Reimportar por chave de origem, verificar cardinalidade 138/10, unicidade, preços em centavos, integridade de vínculos e ausência de registros não aprovados; não promover todos a disponíveis por causa do default do schema. O catálogo local continua intacto até aprovação de integração visual.

## 2. Contratos TypeScript propostos

As interfaces executáveis de proposta (`Category`, `Product`, `Comanda`, `ComandaSession`, `Order`, `OrderItem`, `OrderStatusHistory`) e as uniões `ComandaStatus`/`OrderStatus` estão em `src/domain/contracts.ts`. São **modelos lógicos**, não Prisma gerado nem DTOs públicos automáticos; `Comanda.id`, `ComandaSession.id` e `credentialHash` são internos.

```ts
type CategoryKey = string;           // slug aprovado, imutável
type ProductKey = `rustika-${string}`; // origem textual aprovada
type MoneyInCents = number;          // inteiro seguro, validado em runtime
type ComandaStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';
type OrderStatus = 'RECEIVED' | 'IN_PREPARATION' | 'READY' | 'DELIVERED' | 'CANCELLED';

interface CreateOrderRequest {
  items: Array<{ productId: ProductKey; quantity: number; expectedUnitPriceInCents: MoneyInCents }>;
  notes?: string;
}
interface OrderResponse {
  id: string; orderNumber: number; comandaNumber: string; status: OrderStatus;
  totalInCents: MoneyInCents; createdAt: string;
  items: Array<{ productId: ProductKey; productNameSnapshot: string;
    unitPriceInCentsSnapshot: MoneyInCents; quantity: number; subtotalInCents: MoneyInCents }>;
}
```

`Product.isAvailable` é `boolean | null` na proposta: `null` significa não confirmado; não é evidência de estoque. `OrderItem` guarda nome e valor unitário na criação para não reescrever pedidos passados. `OrderStatusHistory` começa com `fromStatus: null`, `toStatus: RECEIVED` e ator nulo (sistema); mudanças administrativas futuras guardam o admin autor. Datas de API em ISO 8601 UTC; valores monetários nunca em ponto flutuante ou string formatada na API.

## 3. Comanda, convite e sessão

- Comanda fictícia é entidade local própria, sem integração com caixa real. `number` é texto `[0-9]{1,6}`, sem trim no backend; `000123` e `123` são números distintos até decisão em contrário. O número sozinho jamais seleciona uma sessão. Uma comanda OPEN pode ter convites emitidos pelo operador autenticado; convites têm identificador aleatório, hash no banco, expiração curta (proposta: 10 minutos), uso único e vínculo com **UUID da abertura** da comanda.
- Resgate de convite válido cria `ComandaSession` vinculada àquele UUID; token da sessão com pelo menos 256 bits CSPRNG, persistido apenas como hash, entregue em cookie `HttpOnly`, `SameSite=Lax` ou `Strict`, `Secure` em HTTPS e escopo restrito. Nunca retornar hash/segredo em DTO, URL, log ou mensagem de erro. Evitar QR com token em query string; usar entrega controlada e POST no resgate. Respostas com `Cache-Control: no-store`; validação de Origin e proteção CSRF nas escritas autenticadas por cookie. Sessão proposta: 8 horas ou fechamento/revogação, o que ocorrer primeiro.
- Múltiplas sessões podem pertencer à mesma abertura se houver convites distintos; revogação individual e revogação de todas no fechamento/cancelamento. Uma sessão ativa somente se `expiresAt > now`, `revokedAt IS NULL`, comanda OPEN e vínculo correto. Sessões antigas **não** autorizam uma nova abertura que reuse o mesmo número. Números repetidos em aberturas simultâneas são proibidos por unicidade parcial no banco; reutilização após fechamento depende de nova abertura e novo convite.
- Comanda: `OPEN -> CLOSED | CANCELLED`; estados terminais não reabrem. Fechamento exige não haver pedidos pendentes (RECEIVED/IN_PREPARATION/READY); encerramento revoga convites e sessões atomicamente. CANCELLED só se não houver pedidos não cancelados ou entregues, sujeito a confirmação de operação. Pedido: `RECEIVED -> IN_PREPARATION -> READY -> DELIVERED`; `RECEIVED/IN_PREPARATION -> CANCELLED` (mediante autorização de operador); sem saltos, regressões ou cancelamento após READY. A trilha de estados é append-only e deve nascer na mesma transação do pedido.

## 4. Limites, dinheiro e alteração de preços

`src/domain/rules.ts` implementa as regras determinísticas de formato, transição, quantidade e cálculo. Limites **propostos**, para aprovação: corpo JSON até 16 KiB (medido antes do parse), 1–30 produtos distintos, 1–99 unidades por linha, 200 unidades no total, preço positivo até 999.999 centavos por unidade (R$ 9.999,99), pedido até 1.000.000 centavos (R$ 10.000,00); observação de linha até 200 caracteres e observação geral até 500 caracteres, ambas sem markup executável. Excedentes rejeitados, nunca truncados. Sem preço zero/grátis sem regra explícita; produtos inativos ou indisponíveis não são elegíveis. Disponibilidade **desconhecida** requer decisão de operação antes de habilitar pedidos (recomendação: não aceitar até confirmação).

Para cada pedido: obter produto pela chave pública no servidor, confirmar status/availability, ler preço `Decimal(10,2)` e converter para centavos de modo exato (`Decimal`/string decimal, sem `Number(decimal)*100`); comparar centavos inteiros ao `expectedUnitPriceInCents` informado **somente como confirmação do cliente**. Divergência: `409 PRICE_CHANGED`, sem pedido, com preços atualizados para revisão autenticada; novo consentimento explícito antes de reenviar. Se preço coincidir, calcular `subtotal = preçoAtualEmCentavos × quantidade`, `total = soma(subtotais)` em inteiros seguros, persistir Decimal de duas casas e snapshots de nome/preço/quantidade/total na mesma transação. Não aceitar totais, nomes, status, UUIDs internos ou `comandaNumber` do payload como autoridade. Uma alteração futura de preço nunca recalcula pedidos existentes.

Concorrência: transação serializável com retry limitado para conflitos **ou** bloqueio apropriado de linhas de produto/comanda, incluindo o caminho de atualização administrativa de preço; verificar versões dos preços/status na mesma transação do INSERT. Testar corrida entre atualização de preço, fechamento da comanda, revogação de sessão e dois envios simultâneos. Se a atualização do preço ocorrer antes do commit do pedido, o pedido não deve persistir com preço desatualizado; caso o pedido comite primeiro, seu snapshot permanece íntegro.

## 5. HTTP proposto (nenhum endpoint implementado)

Envelopes preservam padrão atual: sucesso `{ "success": true, "data": ... }`, falha `{ "success": false, "error": { "code": "...", "message": "..." } }`. Dados adicionais de conflito apenas quando seguros e autenticados. `GET /api/health`, 404 e tratamento de erros existentes permanecem.

| Método e caminho | Autorização; entrada | Sucesso | Erros principais |
| --- | --- | --- | --- |
| `GET /api/categories` | Público; sem corpo | 200, `Category[]` ativos em displayOrder | 500 genérico |
| `GET /api/products?categoryId=<slug>&cursor=<opaque>&limit=30` | Público; `limit` 1–50, cursor opaco e estável | 200, `{ items: Product[], nextCursor: string\|null }`; apenas catálogo aprovado e ativo | 400 filtro/cursor inválido |
| `GET /api/products/:productId` | Público; chave pública | 200, `Product` | 404 inexistente/inativo |
| `POST /api/comanda-sessions` | Convite em `{ inviteToken: string }` no corpo, limite de tamanho/rate limit | 201, `{ comanda: { number, status }, expiresAt }` + cookie de sessão | 400 payload, 401 convite ausente/inválido/usado/expirado (mensagem indistinguível), 429 abuso |
| `GET /api/comanda-sessions/current` | Cookie válido | 200, `{ comanda: { number, status }, expiresAt }` | 401 sessão inválida/expirada |
| `DELETE /api/comanda-sessions/current` | Cookie válido + proteção CSRF | 204, revoga sessão e limpa cookie | 401 não autenticado |
| `POST /api/orders` | Cookie + CSRF + `Idempotency-Key` UUID v4; `CreateOrderRequest` acima | 201, `OrderResponse`; replay idêntico 200 com mesma resposta | 400 payload/chave, 401 sessão, 409 preço/status/chave divergente, 413 corpo grande, 422 limites/itens, 429 abuso |
| `GET /api/orders` | Cookie válido; apenas pedidos autorizados pela comanda/sessão conforme política aprovada | 200, lista paginada com dados mínimos | 401 sessão, 400 cursor |
| `GET /api/orders/:id` | Cookie válido e mesma comanda **e** política de visibilidade de sessão | 200, `OrderResponse` | 401 sessão, 404 inexistente ou alheio (indistinguíveis) |
| `POST /api/admin/comandas`, `POST /api/admin/comandas/:id/invitations`, `POST /api/admin/comandas/:id/close` | Operador autenticado (modelo futuro); emitir número, convite e fechar | 201/200, convite exibido apenas uma vez; fechamento 200 | 401/403 admin, 409 conflito de número/estado |
| `PATCH /api/admin/orders/:id/status` | Operador autenticado; `{ toStatus, expectedStatus }` | 200, pedido e histórico atualizados | 401/403 admin, 404 alheio, 409 transição/versão |

Não expor consultas por número da comanda ou orderNumber como substituto de sessão. Erros 403 para papel inadequado já autenticado, 404 para recurso de outra comanda sem revelar existência. Status HTTP de leitura não informam detalhes de credenciais. Paginação e ordenação estáveis por `(displayOrder, publicKey)` / `(createdAt, id)`.

**Idempotência:** aplicar autorização e escopo antes de procurar replay. Chave aleatória gerada no cliente (UUID v4) para uma tentativa lógica; derivar chave persistida por digest de `(comandaId, sessionId, idempotencyKey)` e salvar hash canônico do payload, inclusive itens/quantidades/preços esperados. Mesma chave+payload devolve o mesmo pedido, sem novo débito nem histórico; mesma chave+payload diferente retorna `409 IDEMPOTENCY_CONFLICT`. Chave idêntica de outra sessão não é replay. Índice único garante uma criação mesmo com requests concorrentes; conflito PRICE_CHANGED sem criação exige nova confirmação (e nova chave). Retenção da deduplicação vinculada ao pedido deve ser definida antes de expurgo.

## 6. Testes e isolamento da integração futura

| Camada | Casos / critério de aceite | Nesta onda? |
| --- | --- | --- |
| Pura | Formato de número, zeros à esquerda, estados válidos/terminais, snapshots com 59,99 e 14,99, duplicatas, quantidade, teto e PRICE_CHANGED. | Sim, `tests/domain/rules.test.ts`, sem I/O. |
| Contrato de catálogo | Comparar chaves e cardinalidade 138/10, classificação do grupo, sourceName/Group inalterados, disponibilidade desconhecida e payloads de paginação. | Futuro, sem seed nesta onda. |
| Serviço/API com doubles | Convite inválido/expirado/usado, sessão revogada, acesso alheio, CSRF, erros HTTP, limites de corpo, preço atual, idempotência e autorização antes de lookup. | Futuro, sem conexão. |
| Integração real isolada | Somente `cardapio_digital_test`/`cardapio_test_app`; corrida de dois POSTs, alteração de preço e fechamento/revogação; snapshots/histórico transacionais; nenhum acesso a dev/shadow. | Futuro, **não executar agora**. |

Antes de importar `server.ts`, `lib/prisma.ts` ou qualquer componente que crie cliente, um runner de integração **separado** deve exigir explicitamente `process.env.NODE_ENV === 'test'` e `process.env.DB_PROFILE === 'app-test'` (ausência também é falha), sem fallback. Executar preflight no processo pai antes dos workers, e repetir nos workers. Aproveitar `assertRuntimeDatabaseProfile` e `createPrismaRuntime` da Onda 2.3A; validar identidade de perfil/banco/role no carregamento antes de conectar. Teste negativo com doubles comprova `DB_PROFILE=app-dev` e ausência impedindo até a construção; o runner não deve usar a suíte unitária como atalho para abrir banco. Isolar fixtures e autorização de limpeza em fase posterior; não criar nem resetar banco automaticamente.

## 7. Alterações futuras necessárias (não executadas)

- `backend/prisma/schema.prisma` e migration **futura e revisada**: adicionar chave pública única/imutável, sourceCode/sourceName/sourceGroup e origem de descrição em Product; slug único em Category; adequar `isAvailable` ao estado desconhecido e remover semântica enganosa do default `true`; garantir unicidade de código de origem e invariantes de preço.
- Adicionar Comanda (UUID, número, status, timestamps; índice único apenas para número OPEN), ComandaInvitation (hash, expiração, consumo, vínculo com UUID), ComandaSession (hash de credencial, expiração, revogação, vínculo com UUID); índices e FKs de isolamento. Evitar armazenar credenciais em claro.
- Vincular Order à comanda e à sessão; preservar snapshots e acrescentar digest do payload idempotente; revisar campos legados obrigatórios (`customerName`, `tableOrReference`, `trackingTokenHash`) antes de criar pedidos. Adicionar `CANCELLED` ao enum OrderStatus somente se aprovado; índice/constraint de idempotência, FK e histórico para transição atômica. Constraints SQL para preço/quantidade/total e retenção adequada de histórico.
- Planejar importação controlada dos 138 registros e dez categorias apenas após aprovar mapeamento e permissões; nenhuma migração/importação/semente é parte desta entrega.

**Arquivos planejados para a próxima onda, sujeitos à aprovação de escopo:** `backend/prisma/schema.prisma` e uma nova migration revisada; `backend/src/repositories/catalogRepository.ts`, `comandaRepository.ts` e `orderRepository.ts`; `backend/src/services/comandaSessionService.ts` e `orderService.ts`; `backend/src/routes/catalog.routes.ts`, `comandaSessions.routes.ts` e `orders.routes.ts`; `backend/tests/services/*.test.ts` (doubles) e um runner dedicado `backend/vitest.integration.config.ts` com preflight explícito. Ordenar o trabalho em incrementos de até três arquivos essenciais; autenticação administrativa e importação do catálogo precisam de autorização/planejamento próprios antes de habilitar escrita.

## 8. Decisões a aprovar antes de 2.3C

1. Disponibilidade desconhecida bloqueia pedido até confirmação do operador? Recomendação: sim; o catálogo continua visível sem prometer estoque.
2. Política para números com zeros iniciais e reutilização após fechamento; proposta: preservar texto exato e vincular acesso ao UUID da abertura.
3. Cancelamento: quem pode cancelar, em quais estágios e como conciliar com caixa real? Proposta: apenas operador em RECEIVED/IN_PREPARATION; CANCELLED exige extensão do enum.
4. Compartilhamento: uma sessão lê apenas seus pedidos ou todos os pedidos da mesma abertura autorizada? Recomendação: próprios pedidos por padrão, ampliação explícita só se necessária.
5. Limites propostos (R$ 10.000, 30 linhas, 200 unidades, 16 KiB), validade/entrega de convites e duração da sessão; confirmar com o estabelecimento.
6. Destino dos campos obrigatórios legados e do trackingTokenHash ao migrar Order; política de retenção, privacidade e exclusão de dados.
7. Autenticação/fluxo do operador emissor de convites, atualização de preços e estados; sem um emissor autorizado, não habilitar criação de pedidos.

**Aceite da onda:** contratos e regras propostos, testes de regra pura aprovados, segurança/HTTP/matriz documentados e nenhuma modificação no PostgreSQL ou frontend. Esta proposta não autoriza a Onda 2.3C.
