# Incidente — cancelamento acidental do pedido #1 no ambiente Dev

**Ambiente:** `cardapio_digital_dev` (PostgreSQL 18.6, `127.0.0.1:5432`)
**Data do incidente:** 14/11/2026, 16:02:30 UTC (13:02:30, horário local)
**Estado:** registrado e preservado; nenhuma correção ou reescrita de histórico executada.

## O que ocorreu

Durante a validação funcional do RF007, o operador acionou **Cancelar** no card do **pedido #1** (comanda `5`) quando
pretendia atuar sobre o **pedido #2** (comanda `000123`, criado para o teste do RF004). O pedido #2 ainda não existia
no momento do cancelamento: ele foi criado 88 segundos depois, às 16:03:58 UTC.

## Evidência (somente leitura)

| Campo | Pedido #1 |
| --- | --- |
| `order_number` | 1 |
| Status anterior | `RECEIVED` |
| Status atual | `CANCELLED` |
| Comanda | `5` (permanece `OPEN`) |
| Cliente | `admin` |
| Total | `7.00` |
| Item | `ÁGUA SEM GÁS` ×1, unitário `7.00` |

Histórico preservado:

1. `null → RECEIVED` — 2026-11-10T11:39:00.392Z
2. `RECEIVED → CANCELLED` — 2026-11-14T16:02:30.452Z

## Impacto

- Restrito ao ambiente **Dev** e a um pedido de teste histórico; nenhum dado de produção foi afetado.
- Itens, valores, comanda e histórico original permanecem íntegros; apenas o status mudou.
- Nenhum schema, produto, credencial ou migration foi alterado pelo incidente.
- O RF007 foi validado com o pedido #2, que percorreu os quatro estados e foi entregue.

## Decisão

- **Não restaurar** o status nem apagar/reescrever a entrada `CANCELLED` sem autorização explícita.
- Uma eventual restauração exigiria `UPDATE` em `orders` e tratamento da linha de histórico, com backup e janela
  autorizada; não é necessária para a entrega acadêmica.
- O incidente deve constar do relatório como falha operacional de teste, não como defeito do sistema.

## Prevenção

- Conferir o número do pedido no card **e** na mensagem de confirmação antes de confirmar qualquer transição.
- Usar o filtro por status para isolar o pedido em teste.
- O cancelamento é irreversível pela interface; a própria mensagem do painel alerta para isso.
