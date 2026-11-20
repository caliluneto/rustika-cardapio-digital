# RELATÓRIO ENTREGA 3D.2.14C - Aplicação Controlada da Migration

Em conformidade com a autorização concedida, foi executada unicamente a aplicação da migration no banco de desenvolvimento.

## 1. Verificações Prévias e Preparação
- **Banco de Destino**: Confirmado como `cardapio_digital_dev` via `.env` do app e secrets de `migrate-dev`.
- **Role de Execução**: `cardapio_migrator` autênticado com sucesso.
- **Autorização Configurada**: As variáveis de segurança no script executor de permissões foram adequadas estritamente para o tempo de deploy de `APPLY_CARDAPIO_DIGITAL_DEV`.
- **Status das Migrations**: O status acusou exclusivamente 1 migration pendente: `20261102000000_update_products_source_identity_constraint`.

## 2. Execução
Comando utilizado (envelopado na camada de segurança `prisma-run.ts`):
```bash
$env:CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION="APPLY_CARDAPIO_DIGITAL_DEV"
npx tsx scripts/prisma-run.ts migrate-dev migrate deploy
```
A migration foi registrada de forma segura no histórico e aplicou o SQL validado de alteração da constraint.

## 3. Verificações Pós-Migration (Leitura)
Um script de read-only extraiu o estado diretamente do banco `cardapio_digital_dev` conectado via permissão básica (`cardapio_dev_app`) de leitura e escrita padrão. O resultado confirmou:

- **Constraint Atualizada:**
  ```sql
  CHECK ((((public_key IS NULL) AND (source_code IS NULL) AND (source_name IS NULL) AND (source_group IS NULL)) OR ((public_key IS NOT NULL) AND (source_code IS NOT NULL) AND ((source_code)::text ~ '^[A-Za-z0-9]+$'::text) AND (source_name IS NOT NULL) AND (length(btrim(source_name)) > 0) AND (source_group IS NOT NULL) AND (length(btrim(source_group)) > 0) AND ((public_key)::text = ('rustika-'::text || (source_code)::text)))))
  ```
- **Total Produtos:** 27 persistidos e inalterados.
- **Total Categorias:** 2 persistidas.
- **Preços Preservados:** Amostra capturada apontou `BALY 2L | R$ 26` validando que valores decimais continuaram puros.
- **Rollback de Segurança**: A apólice de segurança `backend/scripts/prisma-run-policy.ts` foi retornada para proteção por default em `MIGRATE_TEST`.

## 4. Conclusão e Condições para Próxima Fase (3D.2.14D)
A migration de suporte estrutural aos códigos alfanuméricos foi concluída sem incidentes e testada em tempo real com leitura determinística. A vinculação de produtos do Excel agora conta com base sólida.

**Nenhum Seed ou alteração de dados de negócio foi acionado**. 

**Próxima Fase Liberada (3D.2.14D):** Iniciar as operações puras de Prisma Client (TypeScript) para `Upsert` de atualização dos Vínculos pendentes de encoding e `Insert` dos produtos que estão efetivamente ausentes no banco. O banco de dados agora suportará as operações sem rejeitar chaves alfanuméricas.