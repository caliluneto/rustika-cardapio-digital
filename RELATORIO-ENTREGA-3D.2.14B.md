# RELATÓRIO ENTREGA 3D.2.14B - Preparação da Migration de Identidade e Validação dos 25 Vínculos

Este relatório documenta a segunda parte do planejamento de recuperação do catálogo (Entrega 3D.2.14B). O objetivo consistiu na validação unívoca dos 25 registros persistidos pendentes de vinculação, na verificação técnica da constraint restritiva para códigos alfanuméricos e no desenho de sua correção, respeitando rigorosamente a proibição de operações de escrita ou conexões no ambiente do PostgreSQL.

## 1. Resultado da Validação Individual dos 25 Vínculos

Com o uso do mapeamento construído e de um script validador (`validate-links.ts`), todos os 25 produtos "Ambíguos/Pendentes" foram avaliados contra as métricas de segurança de vínculo.

**Sumário da Validação (`validacao-vinculos.json`):**
- **VINCULO_VALIDADO**: 22 registros
- **VINCULO_AMBIGUO**: 5 registros
- **VINCULO_DIVERGENTE**: 0 registros
*(Total = 27 registros persistidos totais comparados, 25 pendentes mais os 2 corretos)*

**Detalhe sobre os Ambíguos**:
Os seguintes 5 registros não puderam ser enquadrados como VINCULO_VALIDADO pois os seus nomes no banco atual diferem fortemente dos nomes estritos esperados pelo Excel, ou usam acentuações incompatíveis (ex: encodings rompidos ou abreviações não-óbvias que falham no `.trim().toUpperCase()`):
1. `SAGATIBA CACHCA├ö├Â┬úÔö£┬║A 700ML` vs `SAGATIBA CACHCAÇA 700ML` (Cód: 7896010000016)
2. `A├ö├Â┬úÔö£┬║├ö├Â┬úÔö£┬úCAR` vs `AÇÚCAR` (Cód: 216)
3. `LIM├ö├Â┬úÔö£├│O` vs `LIMÃO` (Cód: 214)
4. `MARACUJ├ö├Â┬úÔö£ÔòØ CONGELADO` vs `MARACUJÁ CONGELADO` (Cód: 220)
5. `SALTON PR├ö├Â┬úÔö£Ôöñ SECO 750ML` vs `SALTON PRÔ SECO 750ML` (Cód: 7896023082634)

Nenhuma divergência grave (Preço ou Duplicidade de IDs para o mesmo código) foi identificada.

## 2. Definições da Constraint

**Definição Original (`products_source_identity_consistent`):**
```sql
CHECK (
  ("public_key" IS NULL AND "source_code" IS NULL AND "source_name" IS NULL AND "source_group" IS NULL)
  OR
  ("public_key" IS NOT NULL AND "source_code" IS NOT NULL AND "source_code" ~ '^[0-9]+$'
    AND "source_name" IS NOT NULL AND length(btrim("source_name")) > 0
    AND "source_group" IS NOT NULL AND length(btrim("source_group")) > 0
    AND "public_key" = 'rustika-' || "source_code"
  )
)
```
A limitação ocorria na RegEx `"source_code" ~ '^[0-9]+$'` bloqueando entradas alfanuméricas como `PA062240`.

**Definição Proposta:**
```sql
CHECK (
  ("public_key" IS NULL AND "source_code" IS NULL AND "source_name" IS NULL AND "source_group" IS NULL)
  OR
  ("public_key" IS NOT NULL AND "source_code" IS NOT NULL AND "source_code" ~ '^[A-Za-z0-9]+$'
    AND "source_name" IS NOT NULL AND length(btrim("source_name")) > 0
    AND "source_group" IS NOT NULL AND length(btrim("source_group")) > 0
    AND "public_key" = 'rustika-' || "source_code"
  )
)
```
O campo agora usa `^[A-Za-z0-9]+$`, garantindo compatibilidade com o formato original sem introduzir furos na restrição. 

## 3. Migration Criada (Não Aplicada)
A pasta da migration foi provisionada offline com sucesso:
`backend/prisma/migrations/20261102000000_update_products_source_identity_constraint/migration.sql`

O SQL gerado utiliza `DROP CONSTRAINT IF EXISTS` seguida do novo `ADD CONSTRAINT`. **Nenhuma alteração foi realizada nas tabelas em si ou em registros**, tampouco as Roles e permissões foram manipuladas.

## 4. Compatibilidade com Prisma e Backend
A regex `^[A-Za-z0-9]+$` foi auditada e se encontra em total sinergia com as rotinas de `seed-real.ts` e `inspect-reconciliation.ts`, que concatenam o `publicKey` como `rustika-${sourceCode}`. O importador funciona naturalmente com o valor string lido da coluna Excel, sem precisar cortar letras para burlar a regra antiga. Não foram refatorados módulos ou serviços paralelos (`order.service.ts` etc).

## 5. Arquivos Modificados / Criados
- `backend/scripts/validate-links.ts` (Criado para validar localmente o JSON de mapeamento anterior).
- `validacao-vinculos.json` (Produzido a partir da avaliação local de segurança).
- `backend/prisma/migrations/20261102000000_update_products_source_identity_constraint/migration.sql` (Arquivo de migration manual criado).

## 6. Testes e Typecheck
Os scripts foram processados com segurança offline.
- Execução local offline bem-sucedida.
- O Typecheck geral relatou 10 erros exatos preexistentes. Nenhum dos erros pertence aos arquivos de catálogo desta entrega atual (`validate-links.ts`, `generate-map.ts`).
- Build do `npm run build` foi concluído com sucesso.

## 7. Plano de Execução Real (Fases)
A recuperação real pode ser acionada. Ela será dividida em:

- **Fase A — Migration**: Utilização da role `cardapio_migrator` para executar apenas a migration criada de restrição no banco Dev. (Critério de interrupção: Falha de conexão ou incompatibilidade no deploy).
- **Fase B — Vinculação**: Execução do UPSERT controlada via TypeScript/Prisma unicamente para os registros `VINCULO_VALIDADO` (Ajustando-se o nome/preço aos originais do Excel e inserindo o `sourceCode` e `publicKey`).
- **Fase C — Inserção**: Execução do UPSERT via TypeScript/Prisma de Insert de todos os 141 produtos completamente ausentes e eventuais categorias necessárias.
- **Fase D — Verificação**: Verificação transacional exclusiva de Leitura confirmando contagens (168 totais, 144 públicos, 24 internos, 12 categorias).

## 8. Condições para Autorização da Migration e Riscos Remanescentes
A migration está pronta para ser aplicada. Ela não apresenta riscos de perda de dados.
**Risco Pendente**: Os 5 produtos ambíguos por problema de encoding de caracteres persistidos deverão receber um Update manual para consertar o nome em conjunto com o `sourceCode` e `publicKey` corretos baseados no mapeamento original e não deixados ao léu, evitando que um `Insert` duplique a entrada (uma com acento quebrado e outra correta).

*Aguardando autorização para aplicar a Migration (Fase A) e prosseguir de forma controlada.*