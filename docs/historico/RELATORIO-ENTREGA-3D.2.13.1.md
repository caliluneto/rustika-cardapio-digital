# RÚSTIKA — ENTREGA 3D.2.13.1

Correção dos bloqueios da inspeção de reconciliação.

Data: 02/11/2026, conforme contexto do cliente (America/Sao_Paulo).

**Resultado: correções do inspetor implementadas e verificadas offline. Nenhuma conexão ao PostgreSQL realizada.**

Os 128 testes relacionados passaram. O typecheck específico do inspetor e seus testes passou, assim como o build da aplicação. O typecheck geral permanece reprovado por 10 diagnósticos preexistentes em outros arquivos. Não há aprovação global do backend nem autorização para executar a inspeção real nesta entrega.

**1. Arquivos e escopo**

| Arquivo | Trabalho realizado |
|---|---|
| `backend/scripts/inspect-reconciliation.ts` | Corrigida a implementação existente: destino, transação somente leitura, identidade da sessão, reconciliação, contabilização e diagnóstico seguro. |
| `backend/tests/scripts/inspect-reconciliation.test.ts` | Criados 79 testes específicos, com dados e cliente Prisma simulados. |
| `RELATORIO-ENTREGA-3D.2.13.1.md` | Criado este relatório. |

O build regenerou artefatos locais em `backend/dist`, conforme a configuração existente. Não foram alterados schema, migrations, importador, executor de seed, perfis, roles, privilégios, credenciais ou arquivos `.env`. Nenhum outro executor de importação foi criado. Os arquivos acima já existentes foram trabalhados no estado do workspace, sem substituir o trabalho anterior do usuário.

Não foram executados seed, migrations ou inspeção real, nem acessados bancos Dev, Test, Shadow ou laboratórios RF004. As funções puras de classificação e preço importadas de `seed-real.ts` foram utilizadas pelos testes; nenhum provisionamento foi chamado.

**2. Proteção do destino e da operação**

- A importação do módulo não executa o inspetor, não lê segredos e não cria cliente. A chamada CLI fica protegida por `require.main === module` e exige exatamente `--inspect-dev-read-only`.
- `NODE_ENV=test` e um `DB_PROFILE` explicitamente diferente de `app-dev` bloqueiam a execução antes de carregar o perfil. O script não carrega `.env` por conta própria nem usa a `DATABASE_URL` ambiente como destino.
- O carregamento é explicitamente do perfil `app-dev`, com finalidade `runtime`. Antes da criação do cliente, a URL e os metadados precisam concordar em banco `cardapio_digital_dev`, usuário `cardapio_dev_app`, host local permitido e porta 5432. Perfis de migração, configuração de Shadow e parâmetros capazes de redirecionar conexão/role/schema são rejeitados.
- A futura operação terá uma única transação `RepeatableRead`, com timeout. Seu primeiro comando é `SET TRANSACTION READ ONLY`. Esse comando configura a transação; não modifica dados, schema ou privilégios.
- Antes de consultar constraints, índices, categorias ou produtos, a sessão deve confirmar `current_database()`, `current_user`, `session_user` e `current_setting('transaction_read_only')`. Banco/role distintos, ausência de resultado, resposta incompleta ou modo diferente de `on` interrompem a inspeção.
- Constraints e índices do catálogo serão lidos na própria transação, após a identidade ser confirmada, e incluídos no relatório. Nenhuma alteração de identidade é proposta automaticamente.
- O cliente é encerrado em `finally`, inclusive quando a identidade ou alguma consulta falhar.

Esses caminhos foram verificados com doubles de teste. O comportamento do PostgreSQL, as permissões efetivas e as constraints instaladas ainda não foram observados em uma sessão real.

**3. Reconciliação completa e identificação segura**

Todos os produtos são consultados, sem filtro que descarte `sourceCode: null`. Categorias também são inventariadas integralmente.

A correspondência utiliza código de origem, chave pública derivada do código ou UUID previamente verificado, quando fornecido à função de reconciliação. O Excel atual não contém UUID e o leitor não inventa vínculos. Chaves conflitantes, múltiplos registros para uma expectativa e um registro ligado a expectativas distintas são ambiguidades explícitas.

O nome é apenas um indício para revisão. Um produto legado com nome semelhante e sem identificador confiável permanece `EXISTENTE_SEM_CORRESPONDENCIA`; a expectativa correspondente fica pendente por ambiguidade, em vez de ser declarada ausente com segurança. Um UUID confiável permite comparar um interno sem código como correto ou divergente; esse caminho foi testado com um vínculo explicitamente simulado.

Para correspondências confiáveis são comparados nome cadastral, código e metadados de origem, chave pública, estado ativo, preço em centavos e relacionamento com a categoria esperada. Também são verificados a existência e o estado da categoria, além da validade da chave da categoria para produtos públicos. `descriptionSource` é preservado no inventário; o Excel não fornece uma expectativa para esse campo, portanto não há comparação inventada.

Foram lidas, sem execução, as constraints em `backend/prisma/migrations/20261027000000_rf004_comandas_catalogo_pedidos/migration.sql`. A regra versionada `products_source_identity_consistent` admite:

- Internos: `public_key`, `source_code`, `source_name` e `source_group` todos nulos.
- Públicos: código numérico, metadados de origem preenchidos e `public_key = 'rustika-' || source_code`.

Assim, o código lógico do Excel continua identificado no relatório, mas não é proposto preenchimento automático de `sourceCode` nos internos. Isso violaria a constraint versionada quando `publicKey` fosse nula. Nenhuma constraint foi alterada.

**4. Preços, totais e erros**

A comparação monetária utiliza `parsePrice` e centavos inteiros, com a política de arredondamento existente no importador (`Math.round(preco * 100)`). Não há tolerância de R$ 0,01. Valores inválidos ou fora de `Decimal(10,2)` são rejeitados, e preços inválidos nos registros simulados são identificados como divergência. A classificação comercial utiliza o preço original, para que o arredondamento monetário não altere a classificação.

O relatório separa:

- Quantitativos do Excel e seus candidatos elegíveis.
- Produtos e categorias existentes, públicos/internos por `publicKey`, produtos sem código e extras sem correspondência.
- Os quatro estados da reconciliação, candidatos pendentes por ambiguidade e lista de incompatibilidades do catálogo com a regra de identidade.

As identidades contábeis são:

```text
candidatos = corretos + divergentes + ausentes + candidatos pendentes por ambiguidade
produtos existentes = existentes correspondentes + extras existentes
```

O tamanho da lista de detalhes não é apresentado como total de produtos no banco. Incertos suspensos e inativos excluídos não entram na contagem de ausentes elegíveis. Se já existirem no banco e forem identificáveis, aparecem entre os extras com a razão correspondente. Públicos/internos são contagens estruturais por chave pública; não equivalem à visibilidade final na API.

Os erros externos não têm mensagem, stack, cause, metadados ou objeto completo impressos. A saída usa somente etapa, código e mensagem de uma lista fechada; falhas externas recebem diagnóstico genérico. Os testes incluem senha, URL completa, API key, token e valores de ambiente fictícios dentro de exceções, comprovando que esses valores não chegam ao diagnóstico.

**5. Resultados offline efetivamente observados**

Os comandos foram executados a partir de `backend`, usando os binários locais para evitar instalação ou hooks adicionais.

| Verificação | Resultado final |
|---|---|
| `node node_modules/vitest/vitest.mjs run tests/scripts/inspect-reconciliation.test.ts tests/scripts/seed-real.test.ts tests/scripts/seed-real-corrected.test.ts` | 3 arquivos aprovados; 128 testes aprovados: 79 do inspetor e 49 dos helpers de classificação/preço. |
| `node node_modules/typescript/bin/tsc --noEmit --pretty false` | Reprovado: 10 diagnósticos preexistentes fora do inspetor e seus testes. |
| Typecheck específico via API TypeScript, usando as mesmas opções do `tsconfig.json` | Aprovado: 0 diagnósticos no inspetor, seu teste e dependências importadas. |
| `node node_modules/typescript/bin/tsc -p tsconfig.build.json --pretty false` | Aprovado, código de saída 0. Esse build inclui `src`, não os scripts. |

O typecheck específico foi executado por Node via entrada padrão, sem criar outro arquivo de configuração ou enfraquecer as opções do projeto:

```javascript
const ts = require('typescript');
const configFile = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
if (configFile.error) throw new Error('Config read failed');
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, process.cwd());
const program = ts.createProgram([
  'scripts/inspect-reconciliation.ts',
  'tests/scripts/inspect-reconciliation.test.ts'
], parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
for (const d of diagnostics) console.log(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
console.log('Inspection typecheck diagnostics: ' + diagnostics.length);
process.exitCode = diagnostics.length ? 1 : 0;
```

Os erros remanescentes do typecheck geral também estavam presentes na execução de referência anterior às correções:

| Arquivo | Diagnósticos |
|---|---|
| `scripts/analyze-excel.ts` | 2: acesso com índice possivelmente indefinido e `Object.keys` sobre `unknown`. |
| `scripts/analyze-excel2.ts` | 1: índice possivelmente indefinido. |
| `scripts/executor-seed-real.ts` | 5: operação aritmética com Decimal e incompatibilidades de tipos Decimal/null. |
| `tests/access.test.ts` | 1: `authClock` não pertence a `AppDependencies`. |
| `tests/scripts/seed-dev.test.ts` | 1: importação de `scripts/seed-dev`, que não está presente. |

Esses arquivos não foram corrigidos porque o pedido restringe as alterações aos bloqueios conhecidos do inspetor. A aprovação específica não substitui a reprovação do typecheck global.

Os testes do inspetor substituem o construtor real do Prisma e o carregador real de segredos por barreiras que lançam erro se invocadas. Também bloqueiam conexões TCP durante os testes, preservando apenas IPC local do runner. As verificações finais confirmaram zero tentativas de conexão TCP e zero chamadas aos acessos reais bloqueados. O cliente simulado só oferece consultas e controle de transação; não oferece métodos de mutação. A sequência testada exige proteção de leitura, identidade, metadados e só depois inventário.

**6. Catálogo esperado: leitura real do arquivo local, sem PostgreSQL**

| Métrica do Excel local | Observado offline |
|---|---:|
| Registros totais | 204 |
| Ativos | 174 |
| Públicos | 144 |
| Internos | 24 |
| Incertos suspensos | 6 |
| Inativos excluídos dos candidatos | 30 |
| Candidatos | 168 |

O script valida esses quantitativos antes de criar o cliente de banco. Uma mudança nos totais interrompe a execução para revisão do catálogo.

Também foram observados offline:

- O candidato público `PA062240`, **PANCETA (QUADRADA) SUINA- TORRESMO DE ROLO**, tem código alfanumérico. A chave esperada não é compatível com a constraint versionada para públicos. O relatório de reconciliação expõe essa incompatibilidade; nenhuma identidade, classificação ou constraint foi alterada. Os 168 candidatos não significam 168 registros aptos a escrita sem decisões adicionais.
- Os inativos `139` e `142` não têm grupo. Permanecem nos 30 inativos excluídos, sem bloquear a leitura dos candidatos ativos e sem inventar categorias.
- `xlsx` 0.18.5 está instalado localmente, mas não consta como dependência em `backend/package.json` nem em seu lockfile. Nenhuma instalação ou alteração de dependências foi feita. A reprodução em uma instalação limpa permanece pendente de regularização dessa dependência.

**7. Exemplo SIMULADO de reconciliação — não obtido do PostgreSQL**

Este exemplo corresponde à fixture validada no teste “dados simulados: quatro estados, totais separados, incertos/inativos não viram ausentes”. Os IDs abaixo são fictícios.

```json
{
  "origem": "SIMULADO_TESTE_OFFLINE",
  "catalogoEsperado": {
    "total": 5, "ativos": 4, "publicos": 3, "internos": 0,
    "incertosSuspensos": 1, "inativosExcluidos": 1, "candidatos": 3
  },
  "bancoExistente": {
    "produtos": 3, "categorias": 2, "publicos": 2, "internos": 1,
    "semSourceCode": 1, "semCorrespondencia": 1
  },
  "reconciliacao": {
    "EXISTENTE_CORRETO": 1,
    "AUSENTE": 1,
    "EXISTENTE_DIVERGENTE": 1,
    "EXISTENTE_SEM_CORRESPONDENCIA": 1,
    "candidatosPendentesPorAmbiguidade": 0,
    "candidatosEsperados": 3,
    "existentesCorrespondentes": 2,
    "extrasExistentes": 1
  },
  "detalhes": [
    { "codigo": "1", "id": "p-1", "status": "EXISTENTE_CORRETO", "divergencias": [] },
    { "codigo": "2", "id": "p-2", "status": "EXISTENTE_DIVERGENTE", "divergencias": ["priceCentavos: esperado=700, encontrado=701"] },
    { "codigo": "3", "id": null, "status": "AUSENTE", "divergencias": [] },
    { "codigo": null, "id": "p-interno", "status": "EXISTENTE_SEM_CORRESPONDENCIA", "divergencias": [] }
  ],
  "ambiguidades": [{
    "codigos": [], "ids": ["p-interno"],
    "motivo": "Sem código e sem vínculo confiável; UUID preservado para decisão manual."
  }],
  "propostasAutomaticas": false
}
```

Há quatro detalhes, mas somente três produtos existentes na fixture. O registro sem código é preservado e identificado; não recebe uma correspondência por nome. Em outro teste, nome coincidente sem vínculo estável gera um candidato pendente por ambiguidade e nenhum ausente seguro.

**8. Comando previsto para futura inspeção real — NÃO executado**

Após autorização explícita posterior, a partir de `backend`:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/inspect-reconciliation.ts --inspect-dev-read-only
```

Condições para a retomada:

1. Autorização específica para a inspeção real somente leitura; a flag é uma barreira técnica e não substitui essa autorização.
2. Ambiente compatível com Dev, perfil `app-dev` já provisionado e URL/role dentro da lista permitida, sem modificar segredos, roles ou privilégios.
3. Dependências disponíveis e catálogo local com os quantitativos validados. Avaliar a pendência do typecheck geral registrada acima, sem declará-lo aprovado.
4. Na sessão real, confirmação de banco, role de conexão e role efetiva, além do modo somente leitura. Falha em qualquer confirmação interrompe a operação antes de consultar o catálogo.
5. Leitura das constraints e índices efetivamente instalados. A decisão sobre `PA062240` e os vínculos de internos legados continuará pendente para qualquer recuperação futura.

**9. Pendências e encerramento**

Permanecem pendentes o typecheck geral, a declaração reprodutível de `xlsx`, a verificação de sessão/constraints no PostgreSQL e as decisões de identidade que os dados reais vierem a exigir. Nenhum desses pontos foi resolvido com alteração automática de registros ou schema.

Banco e role efetivamente utilizados nesta entrega: **nenhum**. Totais reais de categorias/produtos e estados da reconciliação no PostgreSQL: **não apurados**. Os resultados do Excel são offline e o exemplo de banco é simulado.

Trabalho encerrado nesta entrega, aguardando autorização. Nenhuma inspeção real ou recuperação incremental será executada automaticamente.
