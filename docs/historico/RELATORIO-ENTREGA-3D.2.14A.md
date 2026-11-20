# RELATÓRIO ENTREGA 3D.2.14A - Preparação Final da Recuperação Incremental do Catálogo

Este relatório documenta a preparação final para a recuperação incremental do catálogo da aplicação Rústika no PostgreSQL de Desenvolvimento (`cardapio_digital_dev`), com base nos resultados da inspeção de leitura realizada na entrega anterior. O objetivo principal é planejar o reestabelecimento seguro das identidades sem destruir registros existentes ou realizar operações de exclusão em massa.

## 1. Mapeamento dos 27 Registros Existentes e Identidades Recuperáveis

Com base nos dados reais do PostgreSQL e do catálogo esperado no Excel, conseguimos parear cada um dos 27 registros persistidos.
Abaixo a consolidação:

- **2 Registros Corretos (PRESERVAR)**:
  - `BALY 2L` (ID: `98548b3b-2ff1-44a7-8f1a-d48dc771aaf5`, Cód: `44`)
  - `GELO (BALDE)` (ID: `83528c03-7831-4252-868b-93604208cc09`, Cód: `47`)
- **25 Registros Ambíguos/Desvinculados (VINCULAR)**: Foram mapeados com o grau de confiança `PENDENTE_DE_DECISAO`. Embora seus nomes coincidam com o catálogo esperado, eles estão desprovidos de `sourceCode` e `publicKey`. Seus IDs precisarão ser atualizados de forma segura para atrelar a identidade original recuperada.
  *Exemplos notórios dos 25 a vincular:*
  - `PANCETA (QUADRADA) SUINA- TORRESMO DE ROLO` → ID Esperado: `PA062240`
  - `RUM BACARDI BRANCO GARRAFA 998ML` → ID Esperado: `7891125064038`
  - E os demais insumos como Gelo de Consumo, Frutas Congeladas, Xaropes e Licores.

*(Nota: O mapeamento individual completo encontra-se gerado no artefato `mapeamento.json` para insumo do futuro script de recuperação).*

## 2. Tratamento Técnico Proposto para PA062240 (e afins)

O código `PA062240` viola a constraint existente no banco:
`CHECK (source_code ~ '^[0-9]+$')` presente em `products_source_identity_consistent`.

**Alternativas Técnicas Analisadas:**

1. **Alterar a Constraint no PostgreSQL (Recomendada)**
   - *Ação:* Criar e rodar uma nova *migration* do Prisma ajustando a expressão regular de `^[0-9]+$` para `^[A-Za-z0-9]+$`.
   - *Implicações:* Nenhuma perda de dados. Preserva o código original como pretendido no Excel e não afeta o ecossistema atual. Impede problemas futuros se novos códigos alfanuméricos forem cadastrados.
   - *Segurança:* Não quebra compatibilidade e mantém consistência obrigatória com o `publicKey`.

2. **Sanitização Backend (Remoção do prefixo PA)**
   - *Ação:* Cortar tudo o que não for número antes de inserir/atualizar (ex.: `062240`).
   - *Implicações:* Altera o dado primário original, divergindo dos sistemas legados de origem, gerando entropia e possível falha se houver chaves puramente numéricas conflitantes.

**Proposta Final para PA062240:** Seguir com a **Alternativa 1**. A constraint deverá ser migrada formalmente em etapa apartada antes do upsert dos dados. Nesta entrega, porém, a constraint **não foi alterada**, aguardando aprovação.

## 3. Plano Mínimo de Operações Futuras

| Operação | Quantidade | Ação Técnica Necessária |
| :--- | :--- | :--- |
| **PRESERVAR** | 2 | Nenhuma alteração. Os registros `BALY 2L` e `GELO (BALDE)` estão íntegros e corretos. |
| **VINCULAR** | 25 | Um update direcionado para injetar `sourceCode`, `publicKey`, `sourceName` e `sourceGroup` aos produtos existentes via ID local, confirmando a identidade ambígua atual. |
| **INSERIR** | 141 | *Insert* padrão dos candidatos ainda ausentes no banco. |
| **CORRIGIR** | 0 | Nenhum registro foi detectado como "Divergente" e portador de identidade simultânea. |
| **BLOQUEAR** | 0 | Todos os 25 ambíguos tiveram a identidade rastreada unicamente para um candidato válido com base na correspondência dos seus nomes do Excel. |

## 4. Testes e Validações Executadas (Offline)

- ✅ **Preservação de Registros Corretos**: Os dois registros íntegros continuam mantendo confiança "CORRETO" no nosso algoritmo.
- ✅ **Vinculação Segura**: Escrito script local `generate-map.ts` que vincula de forma declarativa e previsível os dados lidos, gerando a tabela de transição.
- ✅ **Separação Público vs Internos**: Os status e classificações respeitam o motor do `seed-real.ts` que separa lógicamente insumos e produtos finalizados.
- ✅ **Não execução de escrita**: O processo completo baseou-se puramente na leitura dos artefatos extraídos pela inspeção offline da entrega anterior, validado pelo resultado em JSON local. Nenhuma conexão real de escrita foi originada para o banco `cardapio_digital_dev`.

## 5. Riscos Remanescentes e Parecer

O risco estrutural primário (perda de dados) está completamente mitigado pela estratégia incremental. O risco técnico imediato é tentar rodar a recuperação *sem* antes tratar a constraint do `PA062240`, o que imediatamente reverteria a transação (Rollback) por falha no check do schema do PostgreSQL.

**Próxima Etapa (Execução Real):**
Solicita-se a autorização formal da execução da Entrega 3D.2.14B para:
1. Criar a migration ajustando a constraint `products_source_identity_consistent`.
2. Rodar o script final de Update/Insert baseado no mapeamento providenciado.