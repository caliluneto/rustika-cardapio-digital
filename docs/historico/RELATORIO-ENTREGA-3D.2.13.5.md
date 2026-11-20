# RELATÓRIO ENTREGA 3D.2.13.5 - Inspeção de Reconciliação Real

Este relatório documenta os resultados da inspeção de reconciliação real executada no banco de dados PostgreSQL de desenvolvimento, em modo exclusivo de leitura, com base nos scripts validados na Entrega 3D.2.13.4.

## 1. Comando Realmente Executado
`npx tsx scripts/inspect-reconciliation.ts --inspect-dev-read-only`
*Nota: A saída foi redirecionada para um arquivo JSON para análise estruturada sem expor o terminal diretamente a saídas longas.*

## 2. Identidade e Conexão
- **Banco de Dados (`current_database()`)**: `cardapio_digital_dev`
- **Usuário da Sessão (`current_user` / `session_user`)**: `cardapio_dev_app`
- **Transação**: Exclusivamente Leitura (`SET TRANSACTION READ ONLY` confirmada)

## 3. Resultado da Conexão
**Sucesso Absoluto**. As credenciais, sem a flag de imposição do `sslmode`, funcionaram perfeitamente através das manipulações do validador de destino (`sslmode=disable` ativado em código). Não houve modificações em arquivos `.env`.

## 4. Quantitativos Reais do Banco
- **Total de Categorias**: 2 (`DIVERSOS`, `INSUMO`)
- **Total de Produtos**: 27

## 5. Perfil dos Produtos Existentes (Banco)
- **Produtos Públicos**: 2
- **Produtos Internos**: 25
- **Registros sem `sourceCode` / `publicKey`**: 25

## 6. Reconciliação com o Catálogo (168 Candidatos Esperados)
Após o cruzamento do catálogo esperado do Excel (168 ativos viáveis de 204 no total) contra os 27 produtos persistidos no banco, o cenário consolidado é:

- **EXISTENTE_CORRETO**: 2
- **AUSENTE**: 141
- **EXISTENTE_DIVERGENTE**: 0
- **EXISTENTE_SEM_CORRESPONDENCIA**: 25
- **Correspondências Ambíguas (Candidatos Pendentes)**: 25

## 7. Análise das Ambiguidades e Sem Correspondência
Temos 25 produtos atualmente persistidos no banco de dados. Contudo, eles não possuem um `sourceCode` cadastrado (estão como `null`). No catálogo Excel, há candidatos que parecem corresponder a eles (mesmo nome ou nomes muito semelhantes), mas como o script da reconciliação usa correspondência estrita sem assumir identidade falsa e arriscar updates equivocados, eles foram classificados simultaneamente como:
- **Sem Correspondência Segura** (pelo lado do BD).
- **Ambíguos** (pelo lado do Excel que procura correspondência de nome, mas carece de um ID ou código robusto correspondente no BD).

## 8. Verificações Específicas
1. **BALY 2L**
   - **ID**: `98548b3b-2ff1-44a7-8f1a-d48dc771aaf5`
   - **Status**: Perfeito (EXISTENTE_CORRETO).
   - Possui `sourceCode` (`44`) e `publicKey` (`rustika-44`).

2. **GELO (BALDE)**
   - **ID**: `83528c03-7831-4252-868b-93604208cc09`
   - **Status**: Perfeito (EXISTENTE_CORRETO).
   - Possui `sourceCode` (`47`) e `publicKey` (`rustika-47`).

3. **PA062240 — PANCETA (QUADRADA) SUINA - TORRESMO DE ROLO**
   - **ID**: `04151a17-ed46-411d-84ac-cbac9d7d9037`
   - **Status atual no banco**: Está inserido **SEM** `sourceCode` e **SEM** `publicKey`.
   - **A Incompatibilidade com a Constraint**: O banco de dados possui uma constraint validada e ativa (`products_source_identity_consistent`) que determina a validação do `source_code` via Regex `^[0-9]+$`. O código `PA062240` contém letras. Se uma tentativa de inserção ou atualização for feita alimentando este `sourceCode`, o PostgreSQL abortará a transação. Atualmente ele só pôde ser inserido porque a constraint permite valores `NULL` simultâneos.

## 9. Diferenças entre o Excel e o PostgreSQL
A diferença estrutural principal é a **ausência massiva de dados no banco**. Faltam 141 produtos que estão aprovados no Excel. Além disso, os 25 produtos presentes no banco não dispõem de rastreabilidade unívoca (`sourceCode` preenchido) exigida pela arquitetura atual.

## 10. Plano Mínimo de Recuperação Incremental
Nenhuma exclusão indiscriminada (`TRUNCATE` ou deleção em massa) será sugerida. O fluxo de recuperação sugerido é:
1. **Sanear a Constraint (Migration)**: Expandir a Regex do `source_code` na tabela `products` para aceitar caracteres alfanuméricos, ou ao menos resolver especificamente a prefixação alfabética (como de "PA062240"), caso contrário, a persistência do catálogo falhará.
2. **Resolução de Ambiguidades**: Realizar um Update via script de migração ou um seed inteligente para "anexar" o `sourceCode` e `publicKey` aos 25 produtos ambíguos existentes (casando pelo nome, garantindo integridade visual).
3. **Upsert Seguro**: Inserir os 141 produtos totalmente ausentes e as categorias pendentes respeitando a nova estrutura.

## 11. Parecer sobre a Próxima Fase
A Inspeção demonstrou que a infraestrutura, permissões e validadores de destino do Dev estão estabilizados e seguros. Os impasses do Catálogo vs Banco foram plenamente identificados sem comprometer a base.
Para prosseguirmos com a Entrega 3D.2.14 (Recuperação), é necessário **autorizar formalmente**:
1. A alteração da constraint `products_source_identity_consistent`.
2. A vinculação automatizada (nome-a-nome) para resolução dos 25 ambíguos.
3. A criação do Seed de Recuperação com permissão DML para inserção dos ausentes.

*Operação de inspeção de leitura concluída. Ambiente de desenvolvimento intocado.*