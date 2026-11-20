# RÚSTIKA — ENTREGA 3D.2.13.4

Correção definitiva do bloqueio DESTINO relacionado a `sslmode=disable`.

Data: 02/11/2026, conforme contexto do cliente (America/Sao_Paulo).

**Resultado: bloqueio conhecido corrigido no validador. A configuração persistida foi aceita offline, preservando `sslmode=disable`, sem alterar `.env` ou credenciais. Nenhuma conexão PostgreSQL foi efetuada.**

**1. Compatibilidade com o mecanismo efetivamente utilizado**

O inspetor cria `PrismaClient` passando `datasources.db.url`, sem adapter JavaScript. Os arquivos locais confirmam:

- `@prisma/client` instalado: **6.19.3**.
- Cliente gerado em `backend/node_modules/.prisma/client/index.js`: `engineType: library`, `activeProvider: postgresql`.
- Revisão do motor registrada pelo cliente gerado e pelo pacote `@prisma/engines-version`: **c2990dca591cba766e3b7ef5d9e8a84796e47ab7**.

A documentação oficial do Prisma v6 inclui `disable` entre os valores reconhecidos de `sslmode`, indicando que esse modo não utiliza TLS. [Documentação Prisma v6 — PostgreSQL](https://www.prisma.io/docs/orm/v6/overview/databases/postgresql#configuring-an-ssl-connection).

A verificação também utilizou o código-fonte da revisão exata do motor instalado: em `PostgresNativeUrl::parse_query_params`, a chave `sslmode` com valor `disable` é convertida explicitamente em `SslMode::Disable`. Assim, o suporte não foi presumido a partir do sucesso obtido ao remover o parâmetro na entrega anterior. [Parser PostgreSQL da revisão instalada, linhas 293–302](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/postgres/url.rs#L293-L302).

**2. Compatibilidade com a configuração PostgreSQL local, verificada sem conexão**

A consulta somente de metadados do serviço Windows identificou `postgresql-x64-18`, usando o diretório `C:\Program Files\PostgreSQL\18\data`. Foram lidos apenas os elementos pertinentes de configuração e opções de inicialização:

- `postgresql.conf`: `listen_addresses = 'localhost'` e `port = 5432`.
- Nenhum override pertinente foi encontrado em `postgresql.auto.conf`.
- As opções de inicialização registradas indicam o mesmo diretório, sem override de SSL.
- `pg_hba.conf`: regras `host all all 127.0.0.1/32 scram-sha-256` e `host all all ::1/128 scram-sha-256`.

Regras `host` permitem conexões TCP tanto com SSL quanto sem SSL; elas diferem de regras exclusivamente `hostssl`. Portanto, as regras locais lidas não exigem TLS para esses endereços. [PostgreSQL 18 — pg_hba.conf](https://www.postgresql.org/docs/18/auth-pg-hba-conf.html).

Foi executado o comando local de leitura de configuração:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\postgres.exe' -D 'C:\Program Files\PostgreSQL\18\data' -C ssl
```

Resultado: **`off`**, código de saída 0. A opção `-C` imprime o valor calculado a partir da configuração e encerra; não é uma consulta ao servidor nem uma sessão de banco. Ela não substitui a confirmação dos parâmetros efetivos de uma sessão em execução. [PostgreSQL 18 — opção -C](https://www.postgresql.org/docs/18/app-postgres.html).

**Conclusão de compatibilidade:** o motor utilizado reconhece `sslmode=disable`, e a configuração local inspecionada permite esse transporte. Não foi observada incompatibilidade que exigisse interrupção ou alteração de `.env`. Autenticação, privilégios efetivos e identidade da sessão permanecem sem validação real, pois nenhuma conexão foi aberta.

**3. Correção mínima aplicada**

Em `assertDevTarget`, no script existente `backend/scripts/inspect-reconciliation.ts`:

1. Adicionada uma exceção estrita à validação dos parâmetros: somente a chave `sslmode` com valor exatamente `disable` é aceita.
2. Preservada a presença desse parâmetro na URL devolvida ao cliente, após a reconstrução dos demais parâmetros controlados pelo inspetor.
3. Quando `sslmode` está ausente, continua ausente; nenhum modo SSL é inserido por fallback.

Trecho alterado:

```typescript
for (const [key, value] of url.searchParams) {
  if (key === 'schema' ? value !== 'public' : key === 'sslmode' ? value !== 'disable' :
    !['connection_limit', 'connect_timeout', 'pool_timeout'].includes(key) || !/^\d+$/.test(value)) throw new Error();
}
const sslDisabled = url.searchParams.has('sslmode'); // Todos os valores já foram validados.
url.search = '';
if (sslDisabled) url.searchParams.set('sslmode', 'disable');
```

Os parâmetros `schema`, `connection_limit` e `connect_timeout` continuam sendo definidos pelo código existente na sequência. A URL fornecida pela configuração não é modificada no arquivo ou objeto de origem.

Todos os valores de parâmetros são verificados antes da reconstrução. `require`, `prefer`, `verify-full`, `DISABLE`, valor vazio e valores arbitrários continuam rejeitados por este inspetor, mesmo que alguns sejam reconhecidos pelo Prisma. Duplicatas contendo um valor proibido são rejeitadas independentemente da ordem. Parâmetros desconhecidos e `options` continuam bloqueados.

Essa mudança substitui, para a retomada, a proposta da entrega 3D.2.13.3 de remover `sslmode` da configuração: **não é mais necessário nem foi realizado esse ajuste no arquivo de segredos**.

**4. Arquivos modificados**

| Arquivo | Alteração |
|---|---|
| `backend/scripts/inspect-reconciliation.ts` | Ajuste mínimo de aceitação e preservação de `sslmode=disable`. |
| `backend/tests/scripts/inspect-reconciliation.test.ts` | Atualizados dois testes do comportamento anterior e adicionados 11 casos para ausência de SSL, valores proibidos, duplicatas e parâmetros desconhecidos. |
| `RELATORIO-ENTREGA-3D.2.13.4.md` | Criado este relatório. |

O build regenerou os artefatos locais de `backend/dist`. Nenhum outro arquivo-fonte, perfil de banco, configuração do PostgreSQL, `.env`, credencial, role, privilégio ou schema foi alterado. Não houve mudança na classificação dos 168 candidatos ou no tratamento de `PA062240`.

**5. Testes, typecheck e build**

Comandos executados no diretório `backend`:

```powershell
node node_modules/vitest/vitest.mjs run tests/scripts/inspect-reconciliation.test.ts tests/scripts/seed-real.test.ts tests/scripts/seed-real-corrected.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.build.json --pretty false
```

| Verificação | Resultado efetivamente observado |
|---|---|
| Testes relacionados | **149 aprovados em 3 arquivos**: 100 do inspetor e 49 de classificação/preço. |
| Typecheck específico | **0 diagnósticos**, com as opções existentes de `tsconfig.json`. |
| Build | **Aprovado**, código de saída 0. |
| Diagnósticos gerais | **Os mesmos 10 erros externos preexistentes**, não corrigidos. |

O typecheck específico foi executado pela API TypeScript via entrada padrão, usando `readConfigFile`, `parseJsonConfigFileContent`, `createProgram` e `getPreEmitDiagnostics`, com entradas `scripts/inspect-reconciliation.ts` e `tests/scripts/inspect-reconciliation.test.ts`. Um segundo programa coletou os diagnósticos gerais. O sucesso do programa específico não representa aprovação do typecheck global.

Erros externos preservados:

| Arquivo | Quantidade / códigos |
|---|---|
| `scripts/analyze-excel.ts` | 2: TS2538 e TS2769 |
| `scripts/analyze-excel2.ts` | 1: TS2538 |
| `scripts/executor-seed-real.ts` | 5: TS2363 e quatro TS2322 |
| `tests/access.test.ts` | 1: TS2353 |
| `tests/scripts/seed-dev.test.ts` | 1: TS2307 |

A suíte comprova aceitação com e sem `sslmode`, preservação do parâmetro no argumento entregue ao cliente simulado, rejeição de valores SSL não autorizados, parâmetros desconhecidos, destino incorreto, perfil incompatível, credenciais ausentes e sanitização. As barreiras existentes contra construtor Prisma real, carregamento real de segredos dentro dos testes e conexões TCP permaneceram ativas e passaram nas verificações finais.

**6. Resultado do dry-run offline com a configuração existente**

O dry-run foi limitado ao carregamento do perfil `app-dev` e à chamada de `assertDevTarget` sobre a URL existente. Não chamou `runInspection`, não construiu PrismaClient e não removeu `sslmode` da entrada.

Foi comparada a configuração em memória antes/depois e conferida a igualdade dos bytes dos arquivos externo `app-dev.env` e `backend/.env` durante essa verificação, sem divulgar seu conteúdo.

Saída efetivamente observada:

```json
{
  "mode": "OFFLINE_CONFIGURATION_ONLY",
  "approved": true,
  "sslmodeOriginal": true,
  "sslmodePreserved": true,
  "databaseExact": true,
  "roleExact": true,
  "credentialsUnchanged": true,
  "secretFileUnchanged": true,
  "workspaceEnvUnchanged": true,
  "clientCreated": false,
  "connectionOpened": false
}
```

`sslmodeOriginal` e `sslmodePreserved` indicam que o valor é exatamente `disable`. `databaseExact` e `roleExact` verificam `cardapio_digital_dev` e `cardapio_dev_app`, respectivamente. Não foi impressa URL completa, senha, token ou conteúdo de `.env`.

**7. Proteções preservadas**

- Igualdade exata do nome `cardapio_digital_dev`; nenhum aceite por prefixo ou correspondência parcial.
- Perfil `app-dev`, finalidade `runtime`, role `cardapio_dev_app`, host local permitido e porta 5432.
- Bloqueio de Test, Shadow, RF004, perfis alternativos e parâmetros de redirecionamento.
- Nenhuma tentativa automática com outras credenciais ou perfis.
- Verificação obrigatória de `current_database()`, `current_user`, `session_user` e modo somente leitura antes de consultar catálogo na execução futura.
- Controle de transação somente leitura, ausência de DML/DDL e mensagens de erro sanitizadas.

Somente a combinação de parâmetro SSL explicitamente autorizada nesta entrega foi acrescentada. A restrição de destino e a proteção contra escrita não foram relaxadas.

**8. Futura inspeção real e pendências**

Comando previsto, a partir de `backend`, **não executado nesta entrega**:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/inspect-reconciliation.ts --inspect-dev-read-only
```

**Parecer:** o bloqueio local conhecido `DESTINO` foi resolvido com a configuração persistida intacta. A inspeção PostgreSQL pode ser retomada quando houver nova autorização expressa para leitura; não depende mais de remover `sslmode` do `.env`.

Permanecem pendentes a confirmação da identidade e dos privilégios numa sessão real, o inventário e a reconciliação do PostgreSQL, os dez erros gerais externos e a incompatibilidade já documentada de `PA062240`. Nenhuma dessas pendências foi tratada com alterações automáticas.

Inspeções reais, conexões a bancos, Seed, migrations e escritas SQL nesta entrega: **zero**. O serviço não foi reiniciado ou reconfigurado. Trabalho encerrado após este relatório, aguardando instruções.
