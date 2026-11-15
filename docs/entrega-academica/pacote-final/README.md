# Pacote final de entrega acadêmica — RÚSTIKA

**Caminho do pacote:** `docs/entrega-academica/pacote-final/`  
**Documento-base:** [`../RELATORIO-FINAL.md`](../RELATORIO-FINAL.md)  
**Data de referência:** 14/11/2026  
**Branch:** `main`  
**HEAD publicado:** `1d71979`  
**Repositório:** privado, sem alteração de visibilidade nesta etapa.

Este pacote organiza a entrega acadêmica sem alterar código, banco, pedidos, produtos ou configurações. Ele reúne o checklist final, o guia de gravação, a estrutura do relatório, a lista de dados do estabelecimento e o manifesto de arquivos.

## Situação atual

| Item | Situação |
| --- | --- |
| RF001–RF009 | Implementados e validados, com ressalvas documentadas |
| Pedido #5 | `DELIVERED`, comanda `000126`, histórico com 4 entradas |
| Pedidos #1–#4 | Preservados; #1 `CANCELLED`; #2–#4 `DELIVERED` |
| Produto `TESTE_RF004_PEDIDO` | `UNAVAILABLE`, fora do catálogo público |
| Testes backend | 1.237 aprovados / 9 ignorados |
| Testes frontend | 174/174 |
| Typecheck e builds | Aprovados |
| Documentação | Atualizada em `docs/entrega-academica/` |
| GitHub | `origin/main` em `1d71979`, privado |
| Vídeo | Ainda não gravado |
| Documentos humanos | Ainda pendentes |

## O que está pronto

- Código e banco local validados; nenhuma nova escrita foi feita nesta etapa.
- Matriz de requisitos, relatório, checklist, guia de execução, roteiro e evidências.
- Evidências reais de RF007, RF008 e RF009 em [`../evidencias/`](../evidencias/).
- Commits e push normal já concluídos até `1d71979`.

## O que depende de pessoa

- Nomes completos, matrículas e docente.
- Consentimento e questionário assinados.
- Foto autorizada do cardápio físico.
- Pesos oficiais da rubrica.
- Gravação e upload do vídeo.
- Definição do acesso do avaliador ao repositório privado.

A lista detalhada está em [`CHECKLIST-FINAL.md`](CHECKLIST-FINAL.md) e [`DADOS-ESTABELECIMENTO.md`](DADOS-ESTABELECIMENTO.md).

## Como usar

1. Leia [`CHECKLIST-FINAL.md`](CHECKLIST-FINAL.md) para separar o que já está pronto do que falta.
2. Grave o vídeo seguindo [`GUIA-GRAVACAO-VIDEO.md`](GUIA-GRAVACAO-VIDEO.md) e o roteiro [`../ROTEIRO-VIDEO-5MIN.md`](../ROTEIRO-VIDEO-5MIN.md).
3. Preencha o relatório existente sem reescrever o conteúdo técnico: use [`ESTRUTURA-RELATORIO-FINAL.md`](ESTRUTURA-RELATORIO-FINAL.md).
4. Colete os dados e documentos do estabelecimento com [`DADOS-ESTABELECIMENTO.md`](DADOS-ESTABELECIMENTO.md).
5. Organize a pasta final conforme [`MANIFESTO-ARQUIVOS.md`](MANIFESTO-ARQUIVOS.md).

## Evidências e limitações

- **RF007:** [`../evidencias/rf007-01-filtro-entregue.png`](../evidencias/rf007-01-filtro-entregue.png) mostra o filtro `ENTREGUE` e a lista; o polling foi observado com carimbo de atualização. O painel não possui toast destacado de “novo pedido”.
- **RF008:** [`../evidencias/rf008-01-tracking-final.png`](../evidencias/rf008-01-tracking-final.png) mostra o estado final e o histórico; [`../evidencias/README-RF008.md`](../evidencias/README-RF008.md) registra os horários. As capturas intermediárias não enquadraram o componente e estão em `evidencias/nao-utilizadas/`. Não há novo pedido autorizado para regravar a sequência.
- **RF009:** [`../evidencias/rf009-01-docs.png`](../evidencias/rf009-01-docs.png) mostra o índice `/api/docs`. Ele consome o OpenAPI 3.1, mas **não é o Swagger UI clássico**.

## Segurança

- Nenhuma senha, token, cookie ou connection string foi incluída neste pacote.
- O arquivo de segredos, dumps, `_not-for-publication/` e scripts locais de provisionamento permanecem fora do repositório.
- Não altere a visibilidade do repositório nem faça deploy sem autorização.

## Critério de entrega

A entrega só deve ser declarada completa quando o checklist humano estiver preenchido, o vídeo estiver gravado e o acesso do avaliador estiver definido. O estado técnico já está pronto.
