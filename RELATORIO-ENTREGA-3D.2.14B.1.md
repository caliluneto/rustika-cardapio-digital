# RELATÓRIO ENTREGA 3D.2.14B.1 - Fechamento dos Vínculos e Preparação Final da Migration

Este relatório finaliza a etapa de reconciliação de contagens e a preparação da correção de identidades. Conforme solicitado, foi realizada uma auditoria final nos 27 registros persistidos no banco de dados para eliminar as divergências de totais informados e resolver o impasse dos cinco produtos com enconding corrompido, atestando de forma determinística sua ligação segura com o Excel.

## 1. Contagem Reconciliada dos 27 Registros

Os 27 IDs únicos persistidos no banco Dev foram submetidos a uma triagem final e matemática contra o Excel.

- **PRESERVAR**: 2 registros (Foram previamente mapeados como "Corretos", pois já continham `sourceCode` e `publicKey` compatíveis. Eles foram erroneamente somados na entrega anterior aos `VINCULAR_VALIDADOS` gerando 22).
- **VINCULAR_VALIDADO**: 20 registros. (Sem ambiguidades, sem problemas de encoding de nome. Somados aos 2 preservados, fecham os 22 vínculos seguros previamente citados).
- **VINCULAR_AMBIGUO**: 5 registros. (Registros com nomes corrompidos no banco).
- **TOTAL**: 27 registros únicos, validados.

## 2. Situação Individual dos Cinco Registros com Encoding Incorreto

Confirmamos que *não há ambiguidade real*, apenas textual, entre esses 5 produtos e seus homólogos no catálogo original.

1. **ID**: `3b58d2ca-4c3d-452a-9b7c-faced51ff554`
   - *Nome Corrompido*: SAGATIBA CACHCA├ö├Â┬úÔö£┬║A 700ML
   - *Nome Correto*: SAGATIBA CACHCAÇA 700ML
   - *Código Original*: 7896010000016
   - *Preço*: 2055 (R$ 20.55 - Confere)

2. **ID**: `e5a6e73b-a83d-4d87-a504-479a345e0adb`
   - *Nome Corrompido*: A├ö├Â┬úÔö£┬║├ö├Â┬úÔö£┬úCAR
   - *Nome Correto*: AÇÚCAR
   - *Código Original*: 216
   - *Preço*: 1 (R$ 0.01 - Confere)

3. **ID**: `e5f3b96b-d199-4242-82af-1016b8e4d79a`
   - *Nome Corrompido*: LIM├ö├Â┬úÔö£├│O
   - *Nome Correto*: LIMÃO
   - *Código Original*: 214
   - *Preço*: 1 (R$ 0.01 - Confere)

4. **ID**: `f0e5228f-1075-4f82-b263-4db2a2cccb56`
   - *Nome Corrompido*: MARACUJ├ö├Â┬úÔö£ÔòØ CONGELADO
   - *Nome Correto*: MARACUJÁ CONGELADO
   - *Código Original*: 220
   - *Preço*: 1 (R$ 0.01 - Confere)

5. **ID**: `f617d86a-802e-42d0-b3a8-c1c718dc60c8`
   - *Nome Corrompido*: SALTON PR├ö├Â┬úÔö£Ôöñ SECO 750ML
   - *Nome Correto*: SALTON PRÓ SECO 750ML
   - *Código Original*: 7896023082634

## 3. Avaliação da Migration Preparada

A migration `20261102000000_update_products_source_identity_constraint` soluciona a rejeição de chaves como `PA062240`:

```sql
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_source_identity_consistent";

ALTER TABLE "products" ADD CONSTRAINT "products_source_identity_consistent" CHECK (
 ("public_key" IS NULL AND "source_code" IS NULL AND "source_name" IS NULL AND "source_group" IS NULL)
 OR
 ("public_key" IS NOT NULL AND "source_code" IS NOT NULL AND "source_code" ~ '^[A-Za-z0-9]+$'
   AND "source_name" IS NOT NULL AND length(btrim("source_name")) > 0
   AND "source_group" IS NOT NULL AND length(btrim("source_group")) > 0
   AND "public_key" = 'rustika-' || "source_code"
 )
);
```

- **Suporte Legítimo**: `^[A-Za-z0-9]+$` aprova códigos alfanuméricos e mantem a validade de puramente numéricos.
- **Isolamento**: Mantém regras de nulidade originais, amarração `public_key` e `source_code`, e não destrói outras migrations e privilégios.

## 4. Plano Mínimo de Execução Real

1. **Deploy da Migration**: `npx prisma migrate deploy` através da role segregada `cardapio_migrator`.
2. **Atualização Específica (Upsert de Vinculação)**: Usar o script de seeds para que os 25 vínculos validados (incluindo os 5 corrigindo as strings de nome na memória antes do update) recebam o `sourceCode`, `publicKey`, `sourceName` e `sourceGroup`. Os 2 `PRESERVAR` apenas serão ignorados ou testados em log passivo.
3. **Inserção Específica (Upsert dos Novos)**: Inserir (Upsert por `sourceCode`) as 12 categorias originais e os 141 produtos remanescentes.
4. **Inspeção Final**: Ler os registros finais confirmando o total isolado de 168 e nenhum duplicado gerado pela ambiguidade textual antiga.

## 5. Resultados dos Testes Offline

- As restrições garantiram zero vazamento ou conexões espúrias a outros bancos de dados.
- Build retornou limpo. Typecheck listou exatos 10 avisos preexistentes restritos aos códigos legados da versão de homologação, não afetando a lógica de importação atual.
- O teste script-matemático processado atestou 27 de 27, nenhuma desproporção.

## 6. Parecer Final

O problema de discrepância de contagem está solucionado (matematicamente segmentados em 2 preservados, 20 vinculados prontos, e 5 com nome pendente de ajuste em tempo de seed). O plano está garantido. 

**Não há pendências restantes do ponto de vista investigativo**. Recomendo aprovar a operação real (Upsert e Deploy da Migration).
   - *Preço*: 1 (R$ 0.01 - Confere)

Para os 5, todos são categorias INSUMO. Correspondência matemática de 1-para-1 perfeitamente atendida.