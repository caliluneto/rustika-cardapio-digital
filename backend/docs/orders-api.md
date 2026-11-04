# Envio de pedidos — Entrega 2A / RF004

`POST /api/orders` recebe identificação do cliente e itens, consulta o catálogo e
grava pedido, snapshots e primeiro evento de histórico numa transação Prisma.
Implementação testada com doubles; nenhuma conexão ou escrita no PostgreSQL foi
realizada nesta entrega. O frontend ainda não envia pedidos.

**Atualização 3D.3.8:** `POST /api/orders` passou a exigir `X-Rustika-Request: 1`
(mesmo contrato das rotas de acesso), ganhou limites de requisição (seção "Limites
de requisição") e o frontend tem o fluxo de envio preparado, desligado por padrão
(`VITE_ORDER_SUBMISSION=enabled` liga). A seção "CORS" descreve o comportamento real.

**Atualização 2B:** login, emissão de convite e resgate para sessão legítima agora
estão implementados no backend; ver [access-api.md](access-api.md). O contrato de
pedidos permanece inalterado. As referências abaixo a emissão/resgate ausentes
registram o estado da Entrega 2A; os bloqueios atuais são provisionamento aprovado
do administrador, banco/permissões e integração do frontend.

## Dependência de comanda e sessão

A inspeção dos arquivos de pedido identificou estas relações obrigatórias:

```text
Order.sessionId + Order.comandaId -> ComandaSession.id + comandaId
ComandaSession.invitationId + comandaId -> ComandaInvitation.id + comandaId
ComandaInvitation.issuedByAdminId -> Admin.id
```

Logo, não é possível criar um pedido válido somente com o número digitado no
carrinho sem primeiro estabelecer essa cadeia. O schema já comporta o RF004 e
não precisa ser alterado para implementar o endpoint. `CartContext` guarda
apenas uma comanda local, que não é credencial; `OrderReview` continua local.

O menor fluxo seguro restante é emitir um convite por operador autenticado e
resgatá-lo uma vez para estabelecer uma sessão na comanda. O convite precisa
ser validado e consumido atomicamente, com segredo aleatório e expiração. Não
há necessidade de criar um sistema administrativo amplo para esse resgate,
mas autenticar quem emite o convite é obrigatório. Emissão, resgate e emissão
do cookie não foram implementados nesta entrega; não existe login anônimo por
número da comanda nem criação automática de administrador/convite/sessão.

O endpoint implementado usa **uma sessão já existente e validamente emitida**:

- Cookie `rustika_session`: segredo aleatório de 32 bytes, codificado como 64
  caracteres hexadecimais minúsculos. Armazenar somente seu SHA-256 em
  `ComandaSession.credentialHash`; o segredo não é o hash, UUID ou número.
- O futuro emissor deve usar CSPRNG (`randomBytes(32)`), entregar em cookie
  `HttpOnly`, `SameSite=Lax` ou mais restritivo, `Secure` em HTTPS e path que
  alcance `/api/orders`, com prazo compatível com a sessão. Não usar localStorage,
  URL, logs nem credenciais fixas. Esta entrega não emite cookies.
- A sessão deve existir, não estar revogada, já ter iniciado, não estar expirada
  e pertencer à comanda vinculada, que deve estar `OPEN` e sem `closedAt`.
- Sessão é validada dentro da transação, antes de consultar replay ou produtos;
  expiração é conferida novamente antes da criação. Sessão revogada/fechada
  também perde acesso a replays.

## Requisição

```http
POST /api/orders
Origin: http://localhost:5173
X-Rustika-Request: 1
Content-Type: application/json
Idempotency-Key: 11111111-1111-4111-8111-111111111111
Cookie: rustika_session=<segredo-emitido-pelo-servidor>
```

```json
{
  "customerName": "Ana Silva",
  "customerPhone": "(16) 99999-0000",
  "tableOrReference": "Mesa 2",
  "notes": "Entregar junto",
  "items": [
    {
      "productId": "rustika-131",
      "quantity": 2,
      "expectedUnitPriceInCents": 5999,
      "notes": "Sem talheres"
    }
  ]
}
```

Exemplo ilustrativo. O cookie precisa existir de verdade no banco para autorizar
a operação; o placeholder acima não autentica. No navegador, a integração futura
deve usar `credentials: 'include'`; `Origin` e `Cookie` são enviados pelo navegador.

| Campo | Regra |
| --- | --- |
| `customerName` | Obrigatório; 2–120 caracteres após trim. |
| `customerPhone` | Opcional; 7–25 caracteres, números e `+ ( ) . -`/espaços. |
| `tableOrReference` | Opcional; 1–80 caracteres. É uma referência, não autorização de comanda. |
| `notes` | Opcional; 1–500 caracteres. |
| `items` | 1–30 produtos distintos; máximo de 200 unidades somadas. |
| `items[].productId` | `rustika-` seguido de 1–64 caracteres entre `A-Z` e `0-9`; preserva zeros. |
| `items[].quantity` | Inteiro de 1 a 99. |
| `items[].expectedUnitPriceInCents` | Inteiro positivo, até 999999; confirmação do preço revisado, nunca fonte do total. |
| `items[].notes` | Opcional; 1–200 caracteres. |

Textos rejeitam controles e `<`/`>`; campos opcionais devem ser omitidos quando
vazios. Campos desconhecidos são recusados, inclusive totais, nomes de produtos,
status, IDs de sessão e comanda. Não são aceitos parâmetros de query. Corpo JSON
limitado a 16 KiB antes do parse.

Proteção CSRF (implementada em `src/security/writeGuard.ts`, compartilhada com as
rotas de acesso), verificada nesta ordem e antes de qualquer acesso ao banco:

1. `Origin` exatamente igual a `CORS_ORIGIN` **e** `X-Rustika-Request: 1`
   (valor exato) → senão `403 ORIGIN_NOT_ALLOWED`;
2. `Content-Type: application/json` → senão `415`;
3. sem query string → senão `400`;
4. cookie `rustika_session` bem formado → senão `401 INVALID_SESSION`;
5. `Idempotency-Key` UUID v4 → senão `400 INVALID_IDEMPOTENCY_KEY`.

O header customizado força o preflight CORS, que só a origem configurada passa.

## CORS

Comportamento real (`src/app.ts`): um único `cors()` global com
`origin = CORS_ORIGIN` (um valor exato, sem curinga e sem reflexão da origem),
`credentials: true` e `allowedHeaders: Content-Type, X-Rustika-Request,
Idempotency-Key`. Logo, **toda a API**, inclusive catálogo e health, responde com
`Access-Control-Allow-Credentials: true` para essa origem. Isso não expõe dados a
terceiros: nenhuma outra origem recebe `Access-Control-Allow-Origin`, e o catálogo
não lê cookies. Um `CORS_ORIGIN='*'` falharia fechado (navegadores recusam `*` com
credenciais e as guardas comparam o Origin por igualdade). Restringir as credenciais
às rotas autenticadas e validar o formato de `CORS_ORIGIN` na inicialização ficam
para a fase de produção; não há risco concreto que justifique a mudança agora.
Testes de preflight: `tests/orders.test.ts`, `tests/access.test.ts`.

## Limites de requisição

Implementação: `src/routes/order.routes.ts` (`ORDER_RATE_LIMITS`) sobre
`createFixedWindowLimiter` (`src/security/accessLimits.ts`). Contadores em memória,
por processo, janela fixa, sem Redis. Toda recusa é
`429 TOO_MANY_REQUESTS` com `Retry-After` (segundos) e não chega ao serviço.

| Camada | Chave | Limite | Por quê |
| --- | --- | --- | --- |
| Teto por IP | `request.ip` | 300 / 5 min | Primeira verificação, antes até do Origin e da leitura do corpo (IP limitado recebe 429, não 413). Alto de propósito: as mesas saem pelo mesmo IP público do Wi-Fi do estabelecimento. 20 mesas × 10 pedidos em 5 min cabem com folga (testado). |
| Falhas de sessão por IP | `request.ip` | 30 / 5 min | Conta cookie ausente, malformado ou sessão inexistente/expirada (401). Ao atingir o limite, o IP só recebe 429 para sessões **ainda não confirmadas**; sessões que já concluíram pedido seguem normalmente, então um cliente legítimo não é bloqueado por um vizinho de Wi-Fi que esteja varrendo cookies. |
| Por sessão | SHA-256 do cookie | 10 / 5 min | Uma sessão é um dispositivo de uma comanda; 10 envios em 5 min já é mais do que um uso real. Replays com a mesma chave também contam. |
| Sessões confirmadas | SHA-256 do cookie | 8 h | Conjunto de sessões que já tiveram pedido aceito ou recusado por regra de negócio (404/409/422), que só ocorre depois da validação da sessão. |

Memória e expiração (revisado na 3D.3.9): cada limitador tem dois depósitos.

- **Ativos** (abaixo do limite): até 10 000 chaves, removidas em ordem de expiração a cada
  acesso. Cheio, descarta o mais antigo e aceita a chave nova; um cliente novo nunca é
  bloqueado por saturação.
- **Bloqueados** (atingiram o limite): até 10 000 chaves, que **não** são descartadas pela
  chegada de chaves novas. Na 3D.3.8, inundar a tabela com chaves descartáveis apagava o
  contador de quem já estava bloqueado; agora não apaga (testado). Se o depósito de bloqueados
  enche, vencidos são varridos e, persistindo, sai quem tem a penalidade mais perto do fim.
  Encher esse depósito custa `max` requisições por chave. Varredura de vencidos no máximo uma vez
  por segundo. Memória total: até 2 × 10 000 entradas por limitador.

Chave de IP: IPv4 como está; IPv4 mapeado (`::ffff:a.b.c.d`) vira IPv4; **IPv6 vira o prefixo
/64**, porque um único assinante costuma controlar um /64 inteiro e chaves por endereço
permitiriam criar baldes novos sem custo (testado). Cabeçalhos de encaminhamento são ignorados.

Risco residual: um contador ainda **abaixo** do limite pode ser descartado quando o depósito de
ativos enche; reiniciar o próprio orçamento assim exige mais de 10 000 IPv4 ou prefixos /64
distintos por janela. Concorrência: as operações do limitador são síncronas no laço de eventos do
Node, então requisições simultâneas não ultrapassam o limite (testado com 20 envios paralelos).

Reinício do processo zera todos os contadores e o conjunto de sessões confirmadas (memória do
processo). Aceito nesta fase: persistir exige store externo, previsto para produção.

Limitações conhecidas: sem `trust proxy`, atrás de um proxy reverso todos os
clientes compartilham o IP do proxy (configurar com número de saltos explícito na
fase de produção); com mais de uma instância os contadores não são compartilhados;
janela fixa permite até 2 × `max` numa rajada que cruze a virada da janela.
Os valores são hipóteses de uso, a recalibrar com tráfego real.

## Criação e precificação

1. Validar headers, corpo e limites; normalizar textos e ordem dos itens.
2. Abrir transação `Serializable` e autenticar a sessão por hash do segredo.
3. Consultar tentativa anterior pela chave de idempotência vinculada à sessão.
4. Consultar produtos e categorias. Produtos inexistentes/inativos/não públicos
   são recusados. Apenas `availabilityState=AVAILABLE` permite pedido;
   `UNKNOWN` e `UNAVAILABLE` são recusados, independentemente do booleano legado.
5. Converter o preço Decimal do servidor para centavos e aplicar `priceOrderItems`.
   Preço esperado divergente retorna `409 PRICE_CHANGED`, sem criação. O cliente
   deve recarregar o catálogo e pedir nova revisão; o servidor nunca aceita o
   preço do corpo como autoridade. O total máximo é 1000000 centavos (R$ 10.000).
6. Criar `Order` com `RECEIVED`, itens/snapshots e histórico inicial em uma única
   escrita aninhada na mesma transação. O primeiro evento tem `fromStatus=null`,
   `toStatus=RECEIVED`, administrador nulo (evento do sistema) e data do banco.
7. Usar `orderNumber` autoincrementado pelo banco e só confirmar após a transação
   retornar com sucesso. A sequência identifica pedidos, sem promessa de números
   consecutivos sem lacunas.

Nomes e valores históricos são snapshots. Valores persistidos são Decimal a
partir dos centavos calculados; a resposta monetária usa inteiros em centavos.

## Idempotência e conflitos

`Idempotency-Key` é UUID v4 gerado uma vez por tentativa lógica. O banco recebe
SHA-256 de `[comandaId, sessionId, chave]`, compatível com a constraint existente
de 64 caracteres hexadecimais. `requestDigest` é SHA-256 do corpo normalizado,
incluindo identificação, observações e preços esperados. Itens são ordenados por
chave pública antes de calcular o digest.

- Mesma sessão, chave e corpo: `200`, mesmo pedido, sem novo INSERT nem nova
  precificação. Outra sessão não recupera esse pedido.
- Mesma chave e corpo diferente: `409 IDEMPOTENCY_CONFLICT`.
- Erro de rede ou confirmação perdida: reutilizar a mesma chave e corpo.
- Revisão após alteração de preço: usar nova chave para a nova tentativa lógica.
- Conflitos Prisma `P2034` e unicidade da chave de idempotência permitem até três
  tentativas totais; após isso, `409 ORDER_CONFLICT`. Erros internos genéricos ou
  falhas de commit não são repetidos automaticamente.

Isolamento e rollback são delegados ao PostgreSQL via Prisma. Mocks não comprovam
o comportamento real de concorrência, bloqueios ou commits. A estratégia de
escrita dos futuros serviços de alteração de preço/fechamento de comanda deverá
respeitar essa consistência; não há promessa de ordem física dos commits concorrentes.

## Confirmação

Novo pedido: **201**. Replay autorizado: **200**. Ambos usam o mesmo DTO:

```json
{
  "success": true,
  "data": {
    "id": "44444444-4444-4444-8444-000000000001",
    "orderNumber": 42,
    "status": "RECEIVED",
    "customerName": "Ana Silva",
    "comandaNumber": "000123",
    "totalInCents": 11998,
    "createdAt": "2026-10-31T12:00:00.000Z",
    "items": [
      {
        "productId": "rustika-131",
        "productNameSnapshot": "Frios",
        "unitPriceInCentsSnapshot": 5999,
        "quantity": 2,
        "subtotalInCents": 11998,
        "notes": "Sem talheres"
      }
    ]
  }
}
```

Resposta com `Cache-Control: no-store`. Não contém token, hash, digest, chave de
idempotência nem IDs internos de sessão/comanda. `id` identifica o pedido, mas
não autoriza futuras consultas por si só. Não foi criado endpoint de consulta
ou mudança de status nesta entrega.

## Erros

Envelope preservado: `{ "success": false, "error": { "code": "...", "message": "..." } }`.

| HTTP | Código | Motivo |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | Corpo/campos/quantidades/limites estruturais/query/JSON inválidos. |
| 400 | `INVALID_IDEMPOTENCY_KEY` | Header ausente ou fora de UUID v4. |
| 401 | `INVALID_SESSION` | Cookie/sessão inválido, expirado, revogado ou comanda fechada. |
| 403 | `ORIGIN_NOT_ALLOWED` | Origin ausente, `null` ou diferente do configurado, ou `X-Rustika-Request` ausente/diferente de `1`. |
| 404 | `PRODUCT_NOT_FOUND` | Algum produto não pertence ao catálogo público ativo. |
| 409 | `PRODUCT_UNAVAILABLE` | Disponibilidade não confirmada ou indisponível. |
| 409 | `PRICE_CHANGED` | Preço esperado difere do preço atual do servidor. |
| 409 | `IDEMPOTENCY_CONFLICT` | Chave reutilizada com conteúdo diferente. |
| 409 | `ORDER_CONFLICT` | Conflitos transacionais excederam as tentativas. |
| 413 | `BODY_TOO_LARGE` | Corpo acima de 16 KiB. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Corpo não é `application/json`. |
| 422 | `LIMIT_EXCEEDED` | Limite monetário das regras de domínio excedido. |
| 429 | `TOO_MANY_REQUESTS` | Limite de requisição atingido; header `Retry-After` em segundos. |
| 500 | `INTERNAL_ERROR` | Falha interna/Prisma/dados persistidos inconsistentes. |
| 503 | `ORDERS_UNAVAILABLE` | `createApp` sem Prisma injetado. |

Falhas internas não expõem SQL, credenciais ou detalhes do driver na resposta
nem no log do middleware.

## Bloqueios reais e alcance do RF004

- Não existem emissão autenticada de convite e resgate para sessão/cookie.
- A migration de comandas/sessões revoga privilégios da aplicação nessas tabelas;
  somente aplicá-la não habilita a leitura de sessão/comanda. A operação também
  depende de leitura do catálogo, SELECT/INSERT de pedidos/itens/histórico e uso
  da sequência. Permissões efetivas não foram consultadas nem modificadas.
- Schema aplicado, dados reais, catálogo `AVAILABLE` e persistência/rollback
  real permanecem não verificados. Não foram criados seeds ou dados fictícios.
- O frontend ainda precisa coletar identificação, usar a sessão legítima, enviar
  a revisão e apresentar a confirmação. Carrinho e revisão não foram alterados.

Assim, esta entrega implementa a parte backend do RF004 condicionada à sessão
válida; o requisito ponta a ponta permanece **parcialmente implementado**.

## Testes locais

`tests/orders-csrf.test.ts` (header de proteção), `tests/orders-rate-limit.test.ts`
(limites) e `tests/security/accessLimits.test.ts` (limitador) cobrem a 3D.3.8.
`tests/orders.test.ts` e `tests/services/order.service.test.ts` usam exclusivamente
Prisma simulado e não instanciam clientes ou carregam credenciais. Cobrem sucesso,
preços/quantidades, elegibilidade, sessão, confirmação, idempotência, erros HTTP,
limite de corpo, CSRF e delegação transacional. O double só confirma seu estágio
quando o callback/commit simulado conclui; isso não equivale a testar rollback SQL.

```powershell
# A partir de backend/
$env:NODE_ENV = 'test'
$env:DB_PROFILE = 'app-test'
npm test
npm run typecheck
npm run build
```
