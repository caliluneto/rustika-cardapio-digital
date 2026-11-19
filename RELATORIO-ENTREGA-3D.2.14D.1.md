# RELATÓRIO ENTREGA 3D.2.14D.1 - Preparação Final da Recuperação Real do Catálogo

Este relatório documenta a organização final, triagem em *dry-run* (teste a seco sem conexão ao banco) e estruturação para a etapa de recuperação final do catálogo. Em estrita conformidade, não houve nenhuma escrita no banco real.

## 1. Estado da Policy de Migração
A apólice `backend/scripts/prisma-run-policy.ts` foi verificada. Ela foi revertida com sucesso para sua versão original defensiva (`MIGRATE_TEST_PROFILE = 'migrate-test'`). O ambiente está seguro e bloqueia migrations inesperadas fora do laboratório.

## 2. Mapeamento Utilizado
Utilizamos os artefatos `validacao-vinculos.json` e `mapeamento.json` processados no script `dry-run-recovery.ts`.
Não realizamos nenhum mapeamento dinâmico frágil por nomes, garantindo total previsibilidade determinística através do uso explícito dos UUIDs persistidos. 

## 3. Lista das 25 Atualizações Planejadas
As 25 atualizações (Updates) identificadas são:

1. `PANCETA (QUADRADA) SUINA- TORRESMO DE ROLO` (Cód: **PA062240** -> Alfanumérico Público)
2. `KIWI CONGELADO` (Cód: 219 -> Interno)
3. `ABACAXI CONGELADO` (Cód: 218 -> Interno)
4. `RUM BACARDI BRANCO GARRAFA 998ML` (Cód: 7891125064038 -> Interno)
5. `SAGATIBA CACHCA├ö├Â┬úÔö£┬║A 700ML` -> **CORRIGIR NOME PARA**: `SAGATIBA CACHCAÇA 700ML` (Cód: 7896010000016)
6. `GELO CONSUMO INSUMO` (Cód: 212)
7. `WHITE HORSE GARRAFA` (Cód: 5000265001335)
8. `LARANJA` (Cód: 215)
9. `GATORADE MORANGO- 500ML` (Cód: 7892840808174)
10. `GUARANA PET 1,5LITROS` (Cód: 7891991008761)
11. `MORANGO CONGELADO` (Cód: 217)
12. `SUKITA PET 2L` (Cód: 7891149440801)
13. `GATORADE LARANJA PET 500ML` (Cód: 7892840808020)
14. `MONIN MARACUJA 700ML` (Cód: 7900314000129)
15. `AZEITE OLIVA EX. VIR. GFA VDR 500ML` (Cód: 5601252231164)
16. `GIN ORLOFF INSUMO` (Cód: 213)
17. `PEPSI TWIST PET 2L SHRINK C/6` (Cód: 7892840802714)
18. `TONICA ANTARCTICA PET 1 L SH C/06` (Cód: 7891991298520)
19. `A├ö├Â┬úÔö£┬║├ö├Â┬úÔö£┬úCAR` -> **CORRIGIR NOME PARA**: `AÇÚCAR` (Cód: 216)
20. `LIM├ö├Â┬úÔö£├│O` -> **CORRIGIR NOME PARA**: `LIMÃO` (Cód: 214)
21. `VERMUTE MARTINI ROSSO 750ML` (Cód: 7891125000104)
22. `MARACUJ├ö├Â┬úÔö£ÔòØ CONGELADO` -> **CORRIGIR NOME PARA**: `MARACUJÁ CONGELADO` (Cód: 220)
23. `SAKE AZUMA 600ML` (Cód: 7896299101077)
24. `SALTON PR├ö├Â┬úÔö£Ôöñ SECO 750ML` -> **CORRIGIR NOME PARA**: `SALTON PRÓ SECO 750ML` (Cód: 7896023082634)
25. `APEROL 750ML` (Cód: 7891136057012)

## 4. Lista das 141 Inserções Planejadas
As inserções não sobrepõem IDs e processarão todos os produtos ativos confirmados que ainda faltam, como a inclusão completa da carta de drinks comerciais e outros insumos. A amostra inclui itens como:
- `WHISKY OLD PARR DOSE` (Cód: WP)
- `CHOPP PILSEN 300 ML` (Cód: CP1)
- `GIN TANQUERAY DOSE` (Cód: T1)
- *Total contabilizado em Dry-Run: 141 itens não-presentes.*

## 5. Categorias a Criar
As categorias originais do Excel serão submetidas por mecanismo de `Upsert` idempotente, vinculando-se aos produtos através de seus SourceGroups já validados.

## 6. Tratamento de PA062240
O código da PANCETA (QUADRADA) SUINA (`PA062240`) confirmou-se livre no processamento *offline*. Ele será atualizado como um produto **Público/Comercializado** utilizando o código alfanumérico diretamente na regra de identidade `rustika-PA062240`. A constraint ajustada previamente garantirá o preenchimento.

## 7. Correções de Encoding
Conforme a lista da seção 3, os 5 produtos com encoding corrompido tiveram suas strings revisadas e acentuadas perfeitamente para substituir seus *name*s no payload da transação durante o *Update* do Prisma, resolvendo o bug visual.

## 8. Testes Executados e Resultados
- **Dry-Run Script**: O script `backend/scripts/dry-run-recovery.ts` executou com sucesso offline.
- **Contagens Conferidas**: Preservados (2), Atualizações (25), Inserções (141). Total (168).
- **Typecheck/Build**: O build transcorreu perfeitamente. Retornaram exatamente os 10 erros preexistentes referentes a falhas de tipagem no legado `executor-seed-real.ts`.

## 9. Comando Exato para Futura Execução Real
```bash
npx tsx scripts/seed-real.ts --execute-recovery-dev
```

## 10. Condições de Segurança
A execução futura exigirá (pelo código):
- Estar em `cardapio_digital_dev` com a Role restrita (`cardapio_migrator`).
- Bloqueio de qualquer comando DDL / migrations extras. Uso de `tx.$transaction`.
- Sem comandos `DELETE` ou `TRUNCATE`. Sem *Upserts* ambíguos por nome.

## 11. Critérios de Interrupção
A transação rolará `Rollback` se:
- O número de produtos iniciais for diferente de 27.
- Qualquer constraint falhar e levantar exceção.

## 12. Quantitativos Finais Esperados
- Produtos Totais no Banco: 168 (Produtos Internos com publicKey nulo, Produtos Públicos com rustika-).

## 13. Parecer Final
A etapa preparatória foi cumprida 100% offline via análise de dados salvos. Tudo indica conformidade plena. **É seguro solicitar aprovação e transicionar para a Entrega Real.**
*(Continua)*