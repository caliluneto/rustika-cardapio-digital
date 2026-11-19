# RELATÓRIO DE ENTREGA - FASE 3D.2.14D.2 (EXECUÇÃO REAL CONTROLADA)

## 1. Resumo da Operação
A Fase 3D.2.14D.2 concluiu a recuperação real e controlada do catálogo de produtos no banco de dados `cardapio_digital_dev`. O processo seguiu estritamente as premissas do Dry-Run homologado anteriormente, operando sob uma única transação atômica (`Serializable`) via Prisma Client utilizando a role `cardapio_migrator`.

## 2. Pré-Voo (Pre-Flight Checks)
Antes da abertura da transação de escrita, o script `backend/scripts/executor-3d-2-14d-2.ts` validou com sucesso:
- **Banco de Dados Alvo:** `cardapio_digital_dev`
- **Role de Execução:** `cardapio_migrator`
- **Migration Requerida:** `20260405190500_update_products_source_identity_constraint` devidamente aplicada na tabela `_prisma_migrations`.
- **Contagem Inicial:** Exatos **27** produtos persistidos antes da intervenção.

## 3. Execução Transacional (DML)
Dentro do bloco `prisma.$transaction`, as seguintes operações foram aplicadas sem erros:
- **Categorias:** Garantida a existência das **12** categorias mapeadas na planilha operacional (`upsert`).
- **Preservação Intacta:** Os **2** produtos classificados como `CORRETO` (`290` e `1901`) foram mantidos intocados.
- **Revinculação (Updates):** Exatos **25** produtos pré-existentes tiveram seus vínculos de origem (`sourceCode`, `publicKey`, `sourceName`, `sourceGroup`, `categoryId` e `availabilityState`) restaurados. Produtos de uso interno receberam `null` nos campos de identidade de origem e `publicKey`, respeitando a constraint `products_source_identity_consistency_chk`.
- **Inserção (Creates):** Exatos **141** produtos faltantes foram inseridos a partir da planilha base, respeitando a mesma separação entre itens comercializados (públicos) e itens internos.

## 4. Validação Pré-Commit e Resultado Final
Ainda dentro da transação (antes do `COMMIT`), o estado do banco foi inspecionado e validado contra as travas de segurança:
- **Total de Produtos no Banco:** `168` (2 preservados + 25 atualizados + 141 inseridos)
- **Produtos Públicos (`publicKey IS NOT NULL`):** `144`
- **Produtos Internos (`publicKey IS NULL`):** `24`
- **Total de Categorias:** `12`
- **Caso Especial Validado (`PA062240`):** Confirmado com `sourceCode = 'PA062240'` e `publicKey = 'rustika-PA062240'`.

Após a confirmação de todas as asserções, o `COMMIT` foi efetuado com sucesso.

## 5. Artefatos Envolvidos
- `backend/scripts/executor-3d-2-14d-2.ts`: Script executor transacional com travas de pré-voo e pós-condição.
- `RELATORIO-ENTREGA-3D.2.14D.2.md`: Este relatório de auditoria e entrega.
