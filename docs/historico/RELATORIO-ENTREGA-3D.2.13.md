# RÚSTIKA — ENTREGA 3D.2.13

Validação e execução controlada da inspeção do catálogo.

Data: 02/11/2026 (America/Sao_Paulo).

**Resultado: REPROVADO na validação estática. Inspeção real não executada.**

A implementação existente foi inspecionada e preservada. A instrução “Caso qualquer condição falhe, interromper e apresentar o problema” foi aplicada: não houve avanço para execução dos testes, compilação ou inspeção do banco após a reprovação. Este relatório registra evidências de código, sem apresentar estimativas ou resultados históricos como medições atuais do PostgreSQL.

**Escopo efetivamente realizado**

- Leitura de `backend/scripts/inspect-reconciliation.ts`, das dependências locais de configuração/conexão e classificação, do schema Prisma, dos testes de classificação existentes e dos relatórios anteriores.
- Nenhuma execução/importação do script de inspeção, do executor de seed ou de migrations.
- Nenhuma conexão ao PostgreSQL Dev, Test, Shadow ou aos laboratórios RF004.
- Nenhuma consulta SQL, escrita no banco, alteração de permissões, credenciais ou arquivos `.env`.
- Nenhuma correção automática. Único arquivo criado nesta entrega: este relatório.

SHA-256 do script inspecionado: `89C87EF8C22C2E3B16AA7B4ED788DA4ED180077F1EAA3BDD22E8F87024DE4139`.

**Verificação das condições obrigatórias**

| Condição | Resultado da leitura estática | Evidência |
|---|---|---|
| Conexão exclusivamente a `cardapio_digital_dev` | REPROVADO | O script chama `createPrismaRuntime()` sem fixar o perfil (linha 137). O runtime usa `env.databaseProfile`; `app-test` é um perfil runtime válido. |
| Ausência de INSERT, UPDATE, DELETE, TRUNCATE, DROP, ALTER e GRANT | APROVADO no código revisado | A única operação de dados do script é `prisma.product.findMany()` (linha 60). Não há chamadas de mutação nem SQL de escrita no fluxo local revisado. |
| Ausência de execução de Seed/migrations | APROVADO no código revisado | O módulo `seed-real.ts` fornece funções de classificação e preço; sua importação não chama um executor de seed. Não há chamada de migrations. |
| Não modificar `.env` | APROVADO no código revisado | O carregamento usa leitura/configuração do ambiente; não foram identificadas gravações nesses arquivos. |
| Quatro classificações corretas | REPROVADO | Os quatro rótulos existem, mas há falsos corretos, omissões e mistura de incertos com candidatos à recuperação, detalhados abaixo. |
| Produtos internos incluídos | PARCIAL | Ativos classificados como `INSUMO` entram nas expectativas e produtos internos com `sourceCode` são consultados. Internos sem `sourceCode` ficam de fora; sua chave pública não é validada. |
| Sem correspondência identificado sem exclusão | PARCIAL / REPROVADO quanto à cobertura | Não há exclusão, mas produtos com `sourceCode = null` são ignorados antes da reconciliação. |
| Relatórios não expõem credenciais | NÃO GARANTIDO em falhas | `databaseInfo` contém somente perfil, banco e role; entretanto, o `catch` imprime o objeto de erro integral sem sanitização (linha 198). Nenhum vazamento foi observado nesta entrega, pois o script não foi executado. |

**Bloqueios e limitações encontrados**

1. **O destino não é exclusivo de Dev.** `backend/src/lib/prisma.ts:18` usa o perfil do ambiente. `backend/src/config/env.ts:28` permite selecionar o perfil por `DB_PROFILE` e escolhe `app-test` quando `NODE_ENV=test`. O mapa `backend/config/database-profiles.json` aceita `app-test`, com banco `cardapio_digital_test`. A validação da URL contra o perfil existe, mas valida o perfil escolhido, não a exigência específica desta inspeção. Não foi necessário ler segredos ou conectar a qualquer banco para constatar esse caminho.

2. **Banco e role exibidos são configuração, não confirmação da sessão.** `databaseInfo` deriva de `database.describe()` (`backend/src/lib/prisma.ts:38` e `backend/src/config/secrets.ts:417`). Não há consulta a `current_database()`, `current_user` ou `session_user`. O perfil `app-dev` declara `cardapio_digital_dev` e `cardapio_dev_app`; isso não prova qual sessão seria efetivamente aberta. O script também não estabelece uma transação explicitamente somente leitura. A ausência de chamadas de escrita foi confirmada estaticamente, mas não há essa barreira adicional na sessão.

3. **Produtos sem código são invisíveis.** O filtro `where: { sourceCode: { not: null } }` (linha 61) exclui registros que deveriam constar do inventário completo e, quando não associados ao catálogo, da lista sem correspondência. O schema permite `sourceCode` nulo. A lista gerada não representa todos os produtos existentes.

4. **`EXISTENTE_CORRETO` não assegura categoria e condição pública/interna corretas.** `categoryId` é selecionado, mas não é comparado. A comparação de `publicKey` só ocorre para `COMERCIALIZADO` (linha 91); um `INSUMO` com chave pública indevida pode ser classificado como correto. O campo `name` do produto não é selecionado: a comparação de nome usa apenas `sourceName`. A reconciliação pode ignorar diferenças entre os metadados de origem e o cadastro utilizado pela aplicação.

5. **Preços podem produzir falsos corretos.** `parsePrice` é importado, mas não utilizado. A leitura usa `parseFloat` (linhas 45 e 50), que não interpreta corretamente vírgula decimal e pode produzir `NaN`. A condição `Math.abs(...) > 0.01` (linha 100) não exige igualdade em centavos; uma diferença de R$ 0,01 pode passar. `NaN` também não satisfaz essa comparação. O uso de `parseFloat(exist.price) || 0` ainda mascara valores inválidos como zero. Estes são problemas de lógica constatados no código, sem afirmar que ocorram nos dados atuais.

6. **Incertos não têm tratamento separado na reconciliação.** Todos os ativos, inclusive `INCERTO`, entram no laço que gera `AUSENTE`. Os relatórios anteriores descrevem incertos como suspensos da importação. Assim, a contagem de ausentes não pode ser usada diretamente como quantidade a recuperar. Além disso, todo registro sem correspondência recebe `classificacao: 'INSUMO'` (linha 125), sem evidência de que seja interno.

7. **Faltam os totais reais solicitados.** Não existe consulta a categorias nem contagem de todos os produtos. `publicos` e `internos` (linhas 146–147) são calculados a partir do Excel, e não do banco. `comparison.length` mistura expectativas ausentes com registros existentes e não equivale ao total de produtos cadastrados.

8. **Erros não são sanitizados.** A saída normal de identificação do banco evita URL e senha, mas `console.error('Erro:', error)` (linha 198) imprime conteúdo arbitrário de exceções. O helper `redactSecrets` existe em `backend/src/config/secrets.ts:422` e não é utilizado pelo script. Trata-se de ausência de garantia, não de vazamento efetivamente constatado. O encerramento do cliente também está apenas no caminho de sucesso, fora de `finally`.

**Resultados offline**

| Atividade | Resultado efetivamente observado |
|---|---|
| Revisão estática do script e dependências locais | Concluída; condições obrigatórias reprovadas |
| Leitura dos testes de classificação existentes | Realizada; exercitam funções de `seed-real.ts`, sem validar integralmente este inspetor |
| Execução de testes | Não realizada após a reprovação, em cumprimento da condição de interrupção |
| Compilação/verificação TypeScript | Não realizada após a reprovação; nenhuma aprovação de compilação é declarada |
| Leitura programática do Excel ou dry-run | Não realizada |
| Alteração/recriação do script | Não realizada |

Os números e aprovações das entregas anteriores não foram reutilizados como validação desta entrega. Para eventual retomada, os testes pertinentes e o typecheck que inclui `scripts` permanecem pendentes. O `tsconfig.build.json` inclui somente `src`; compilar apenas a aplicação não validaria o inspetor.

**Resultados do PostgreSQL real**

Número de execuções da inspeção: **0**. Não há resultados de sessão ou dados reais obtidos nesta entrega.

| Resultado solicitado | Situação |
|---|---|
| Banco e role realmente utilizados | Nenhum banco/role utilizado; nenhuma sessão aberta |
| Total de categorias existentes | Não apurado |
| Total de produtos existentes | Não apurado |
| Quantidade de produtos públicos e internos | Não apurada |
| Quantidade de `EXISTENTE_CORRETO` | Não apurada |
| Quantidade de `AUSENTE` | Não apurada |
| Quantidade de `EXISTENTE_DIVERGENTE` | Não apurada |
| Quantidade de `EXISTENTE_SEM_CORRESPONDENCIA` | Não apurada |
| Identificação dos registros divergentes | Não apurada |
| Identificação dos registros sem correspondência | Não apurada |
| Diferenças efetivas entre catálogo esperado e banco | Não apuradas; dependem de inspeção aprovada |

“Não apurado” não significa zero. Não há base nesta entrega para confirmar que BALY 2L, GELO ou qualquer outro registro esteja ausente, divergente ou sem correspondência no banco atual. Os relatórios anteriores contêm afirmações que exigem nova verificação e não substituem essa evidência.

**Plano mínimo para retomada e recuperação incremental — somente proposta**

1. Após novas instruções, ajustar a implementação existente para restringir o destino a Dev antes da conexão, confirmar banco/role pela sessão, proteger a execução como somente leitura e sanitizar erros. Não alterar credenciais ou permissões.
2. Completar o inventário de categorias e produtos, incluindo os sem código; comparar categoria, identidade pública/interna e preços em centavos; separar incertos dos candidatos à recuperação. Preservar e identificar todos os registros sem correspondência.
3. Validar offline os quatro estados com dados simulados, incluindo internos, códigos nulos, categoria divergente, preço inválido e erro com segredo fictício. Verificar TypeScript incluindo `scripts`. Não executar seed, migrations ou testes que acessem bancos.
4. Somente após aprovação das verificações e retomada autorizada, executar a inspeção de leitura e produzir os totais e listas efetivamente observados. Quantificar a recuperação a partir dessa evidência.
5. Preparar um plano específico por registro: preservar os corretos, propor inclusão apenas dos ausentes elegíveis, submeter divergentes à decisão e manter sem correspondência e incertos sem alterações automáticas. Qualquer escrita dependerá de autorização posterior; nenhuma é autorizada por este relatório.

Trabalho interrompido na validação. Aguardando instruções, sem execução de recuperação incremental.
