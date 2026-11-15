# Evidências do RF008 — acompanhamento automático

Demonstração executada em **14/11/2026**, no ambiente local de desenvolvimento do snapshot
`cardapio-digital-snapshot`, com duas janelas separadas: CLIENTE em `http://localhost:5173/` e ADMIN em
`http://localhost:5173/#admin`.

## Pedido utilizado

- Pedido **#5**, comanda **000126**, cliente `Cliente RF008`.
- Produto `TESTE_RF004_PEDIDO` ×1, total **R$ 1,00**.
- Criado às **20:38:03** (horário local; `23:38:03Z`), após convite emitido pelo painel e resgatado na janela do
  cliente.
- Estado final `DELIVERED`; histórico com quatro entradas.

## Atualizações observadas na janela CLIENTE

A janela permaneceu em `http://localhost:5173/`, sem F5, sem remontagem do React e sem edição manual do DOM. O
componente `#order-tracking-title` permaneceu montado. Os estados foram lidos diretamente do DOM:

| Horário local | Estado no DOM | Texto exibido |
| --- | --- | --- |
| 20:38:03 | `RECEIVED` | Status atual: Recebido |
| 20:38:54 | `IN_PREPARATION` | Status atual: Em preparação |
| 20:38:59 | `READY` | Status atual: Pronto |
| 20:39:04 | `DELIVERED` | Status atual: Entregue |

As transições foram feitas exclusivamente pelo fluxo administrativo legítimo, com confirmação no painel. O
histórico retornado pelo servidor contém as quatro entradas com os mesmos horários.

## Arquivos

- `rf008-01-tracking-final.png` — janela CLIENTE, estado final `Entregue` e histórico completo com as quatro
  entradas.
- `rf008-02-admin-delivered.png` — painel administrativo com o pedido #5 em `ENTREGUE` e o aviso da última
  transição.
- `nao-utilizadas/rf008-01-received.png` a `nao-utilizadas/rf008-04-delivered.png` — capturas feitas após a tela
  voltar ao topo do catálogo; **não enquadram o componente de acompanhamento** e por isso não são usadas como prova
  de estado. Ficam preservadas apenas para transparência.

## Limitação registrada

Os estados intermediários **não têm captura de tela enquadrada**. A comprovação do tempo real é o registro de DOM
acima, obtido durante a execução, mais a captura final com o histórico completo. Nenhum pedido novo foi criado para
refazer a captura, respeitando o limite de uma única tentativa adicional autorizada.
