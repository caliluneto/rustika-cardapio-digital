# RÚSTIKA — ENTREGA 3D.2.13.2

Primeira inspeção real de reconciliação do catálogo — bloqueio na verificação prévia.

Data: 02/11/2026, conforme contexto do cliente (America/Sao_Paulo).

**Resultado: execução real interrompida antes de qualquer conexão PostgreSQL.**

A verificação offline da configuração usando o próprio `assertDevTarget` do inspetor falhou com o código sanitizado `DESTINO`. Foi aplicada a instrução desta entrega: “Se qualquer condição falhar, interromper sem consultar dados do catálogo”. Não houve tentativa de conexão, consulta ao catálogo, repetição com credenciais alternativas ou alteração de configuração para contornar o bloqueio.

**1. Verificação prévia e evidências**

O script existente foi revisado, junto com seus helpers de classificação/preço, o carregador de perfis e o mapa de perfis. Sua implementação foi preservada.

SHA-256 observado do inspetor: `78E0E6EA50CF25CBAB238135576A4510A278A7BF3BAD22E7F53F2CEED98FAAE8`.

| Condição | Resultado desta entrega |
|---|---|
| Ausência de escrita, Seed e migrations no fluxo do inspetor | Confirmada por revisão. As operações são SELECT, leitura via `findMany` e controle de transação somente leitura. Importar os helpers de `seed-real.ts` não executa provisionamento. |
| Destino permitido exclusivamente Dev | Confirmado no código: banco `cardapio_digital_dev`, role `cardapio_dev_app`, perfil runtime `app-dev`, host local permitido, porta 5432 e parâmetros de URL restritos. |
| Configuração atual aceita por esse validador | **Reprovada: `DESTINO`.** Este é o bloqueio efetivamente observado. |
| Identidade efetiva antes das consultas de catálogo | Confirmado no fluxo: `current_database()`, `current_user`, `session_user` e modo somente leitura precisam ser aprovados antes de constraints, índices e catálogo. Não executado nesta entrega. |
| Credenciais existentes e privilégios compatíveis | O carregador do perfil existente foi chamado sem imprimir seus valores. A validação adicional rejeitou a configuração. Privilégios efetivos não foram confirmados. A migration versionada declara SELECT para a role de aplicação, mas isso não prova o estado atual do servidor. |
| Dez erros gerais fora do inspetor | Confirmados novamente; o typecheck específico não apresentou diagnósticos. Não foram a causa deste bloqueio. |
| Erros sem credenciais | Confirmado pelo fluxo de diagnóstico e pelos testes. O erro observado contém somente etapa, código e mensagem fixa. |

A mensagem `DESTINO` é compartilhada por diversas rejeições de configuração. **Ela não prova que a URL aponte para outro banco.** Sem divulgar valores sensíveis ou prosseguir com novas verificações após a interrupção, não foi individualizado qual requisito adicional falhou. O motivo específico permanece pendente de diagnóstico autorizado; nenhuma hipótese foi apresentada como fato.

**2. Comando efetivamente executado na verificação de configuração**

Diretório de trabalho: `backend`.

Foi executada somente esta verificação por entrada padrão, reutilizando as funções existentes, sem criar um segundo inspetor ou instanciar um cliente:

```powershell
@'
const {loadDatabaseProfile} = require('./src/config/secrets.ts');
const {assertDevTarget,safeDiagnostic} = require('./scripts/inspect-reconciliation.ts');
const fs = require('node:fs');
const crypto = require('node:crypto');
try {
 if (process.env.NODE_ENV === 'test' || (process.env.DB_PROFILE !== undefined && process.env.DB_PROFILE !== 'app-dev')) throw new Error('ambiente');
 const profile = loadDatabaseProfile('app-dev',{purpose:'runtime'});
 assertDevTarget(profile);
 console.log(JSON.stringify({preflight:'APROVADO_OFFLINE',perfil:profile.profile,bancoConfigurado:profile.database,roleConfigurada:profile.user,segredoExistente:fs.existsSync(profile.secretsFilePath),conexaoExecutada:false,scriptSHA256:crypto.createHash('sha256').update(fs.readFileSync('scripts/inspect-reconciliation.ts')).digest('hex')}));
} catch(error) {console.error(JSON.stringify(safeDiagnostic(error,'preparacao')));process.exitCode=1;}
'@ | node --import tsx
```

Código de saída: **1**. Saída efetivamente observada:

```json
{"etapa":"preparacao","codigo":"DESTINO","mensagem":"Configuração rejeitada: destino ou role fora da lista permitida."}
```

O comando de inspeção real abaixo **não foi executado**:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/inspect-reconciliation.ts --inspect-dev-read-only
```

Execuções reais do inspetor: **0**. Tentativas de conexão: **0**. Consultas de catálogo: **0**. Credenciais alternativas utilizadas: **0**.

**3. Validação offline realizada nesta entrega**

Os testes relacionados foram executados com o comando:

```powershell
node node_modules/vitest/vitest.mjs run tests/scripts/inspect-reconciliation.test.ts tests/scripts/seed-real.test.ts tests/scripts/seed-real-corrected.test.ts
```

Resultado: **128 testes aprovados em 3 arquivos**. O inspetor é testado com clientes simulados, barreiras contra o carregador/construtor reais e bloqueio de conexões TCP. Esses resultados não são dados do PostgreSQL.

Também foi executado um verificador por entrada padrão usando a API local do TypeScript. Ele leu as opções de `tsconfig.json`, criou um programa restrito a `scripts/inspect-reconciliation.ts` e `tests/scripts/inspect-reconciliation.test.ts` e outro com todos os arquivos do projeto. Foram coletados os diagnósticos com `getPreEmitDiagnostics`, sem emitir nem executar código da aplicação:

- Programa específico: **0 diagnósticos**.
- Programa geral: **10 diagnósticos**, todos externos ao inspetor e ao seu teste.

| Arquivo | Quantidade e códigos TypeScript |
|---|---|
| `scripts/analyze-excel.ts` | 2: TS2538, TS2769 |
| `scripts/analyze-excel2.ts` | 1: TS2538 |
| `scripts/executor-seed-real.ts` | 5: TS2363 e quatro TS2322 |
| `tests/access.test.ts` | 1: TS2353 |
| `tests/scripts/seed-dev.test.ts` | 1: TS2307 |

O processo desse verificador terminou com código 0 porque seu critério de saída era o programa específico. **Isso não representa aprovação do typecheck geral**, cujos dez diagnósticos foram explicitamente coletados e registrados.

Esses arquivos com erros não fazem parte do fluxo isolado importado pelo inspetor. A entrada via `tsx` pode carregar esse fluxo sem compilar o projeto inteiro; o typecheck específico e os testes sustentam essa conclusão. A rejeição observada é da validação de configuração, não de compilação. Os erros gerais continuam sendo pendências para outras entregas, especialmente o executor de recuperação, e não foram corrigidos aqui.

O build aprovado na entrega anterior não foi repetido nesta entrega. As validações offline já iniciadas em paralelo foram apenas concluídas/coletadas; após o bloqueio não foi iniciada inspeção ou nova verificação de credenciais.

**4. Identidade da conexão e resultados reais**

| Informação solicitada | Resultado efetivamente observado |
|---|---|
| `current_database()` | Não consultado; nenhuma sessão aberta |
| `current_user` | Não consultado |
| `session_user` | Não consultado |
| Modo somente leitura da sessão | Não observado em servidor |
| Categorias reais | Não apuradas |
| Produtos reais | Não apurados |
| Produtos públicos/internos | Não apurados |
| Produtos sem `sourceCode` | Não apurados |
| `EXISTENTE_CORRETO` | Não apurado |
| `AUSENTE` | Não apurado |
| `EXISTENTE_DIVERGENTE` | Não apurado |
| `EXISTENTE_SEM_CORRESPONDENCIA` | Não apurado |
| Correspondências ambíguas | Não apuradas no banco |
| Divergências de categoria, preço, publicKey, identidade e rastreabilidade | Não apuradas no banco |
| Relação nominal dos divergentes e sem correspondência | Indisponível sem a inspeção |

Não apurado não significa zero. Banco e role constantes no código são **destino exigido**, não identidade efetivamente observada.

Os testes confirmaram novamente o catálogo local de **204 registros, 174 ativos, 144 públicos, 24 internos, 6 incertos suspensos, 30 inativos excluídos e 168 candidatos**. Esses números são do Excel local. Nenhum deles foi utilizado como contagem de registros persistidos.

Sem a consulta autorizada concluída, não é possível distribuir os 168 candidatos entre corretos, ausentes, divergentes e pendentes, nem quantificar extras existentes. Também não é possível explicar diferenças efetivas entre o plano e o banco atual.

**5. Verificação dos 27 produtos anteriores e dos registros destacados**

| Referência da entrega 3D.2.9 | Confirmação atual |
|---|---|
| 27 produtos | Não confirmada |
| 2 públicos | Não confirmada |
| 25 internos | Não confirmada |
| 2 categorias | Não confirmada |

BALY 2L, código esperado `44`, e GELO (BALDE), código esperado `47`, estão contemplados pelos testes do catálogo local. Sua presença, UUID, categoria, preço e classificação de reconciliação no PostgreSQL **não foram verificados**. Não é válido reiterar que sejam sem correspondência, ausentes ou corretos com base apenas nos relatórios anteriores. Nenhum desses registros foi modificado.

**6. PA062240: análise limitada às evidências offline**

O catálogo local classifica `PA062240`, PANCETA (QUADRADA) SUINA- TORRESMO DE ROLO, como `COMERCIALIZADO`. A constraint versionada `products_source_identity_consistent` exige código numérico para a identidade pública, com `public_key = 'rustika-' || source_code`. Esse conflito foi novamente coberto pelos testes. A definição instalada no servidor e os dados persistidos desse produto **não foram consultados**.

Alternativas técnicas para estudo posterior, sem implementação nesta entrega:

1. **Admitir códigos alfanuméricos no contrato de identidade pública.** Preservar `PA062240` como código de origem e sua classificação comercial, ajustando de maneira coordenada constraint, formação/validação de publicKey, importador e consumidores. Exige análise de unicidade, compatibilidade das APIs e migration futura expressamente autorizada. Não basta remover uma validação apenas no inspetor.
2. **Separar identidade pública de código original de origem.** Manter `PA062240` integralmente em um campo ou vínculo de rastreabilidade dedicado e atribuir uma identidade pública estável distinta. Exige desenho explícito de mapeamento, unicidade e auditoria, além das alterações de schema/contratos que se mostrarem necessárias. Não substituir o código original por um número sem preservar seu significado e vínculo.

Antes de escolher qualquer alternativa, é necessário inspecionar o registro persistido e a constraint efetiva. Reclassificar o produto comercial como interno apenas para contornar a constraint não atende ao objetivo. Nenhuma alternativa acima constitui autorização de alteração ou plano pronto para execução.

**7. Plano mínimo de retomada e recuperação incremental**

1. Em uma próxima etapa autorizada, diagnosticar offline qual requisito de `assertDevTarget` rejeitou a configuração, reportando apenas nomes de verificações e resultados booleanos, sem URL completa, senha ou outros segredos. Não trocar credenciais nem enfraquecer a validação automaticamente.
2. Resolver a incompatibilidade por ação explicitamente autorizada, preservando a restrição a Dev, e revalidar offline. A presente execução foi encerrada e não será repetida automaticamente.
3. Após nova instrução, realizar a inspeção única com o script existente. Confirmar identidade e leitura antes dos dados e registrar constraints, categorias, todos os produtos e ambiguidades.
4. Com evidência real, preparar um plano por registro: preservar corretos; incluir somente ausentes comprovados e elegíveis; revisar divergentes; preservar extras e internos sem vínculo confiável até decisão; manter incertos fora da importação. Separar candidatos e extras para evitar duplicidade.
5. Resolver o contrato de identidade de `PA062240` e verificar a ferramenta de recuperação, inclusive seus erros de tipagem, antes de propor qualquer escrita. Quantidades e ações de recuperação permanecem indeterminadas nesta entrega.

**8. Riscos, pendências e parecer sobre a entrega 3D.2.14**

O bloqueio `DESTINO` impede considerar a configuração aprovada. Faltam identidade real, privilégios efetivos, definição instalada das constraints, inventário atual e reconciliação. Permanecem os dez erros gerais, a incompatibilidade conhecida de `PA062240` e a pendência de declaração de `xlsx` nos manifests documentada na entrega anterior.

**Parecer: não há evidência suficiente para autorizar a entrega 3D.2.14 como execução de recuperação incremental.** A próxima atividade recomendada é o diagnóstico restrito do bloqueio e, quando autorizado, a conclusão da inspeção somente leitura. Nenhuma autorização de escrita é inferida.

O único arquivo de entrega criado foi este relatório. O inspetor, arquivos `.env`, credenciais, roles, permissões, schema e registros do banco permaneceram sem alterações por esta tarefa. Nenhuma Seed, migration, reset ou SQL de escrita foi executado. Trabalho encerrado, aguardando novas instruções.
