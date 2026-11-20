# RÚSTIKA — ENTREGA 3D.2.13.3

Diagnóstico e correção do bloqueio DESTINO.

Data: 02/11/2026 (contexto do cliente, America/Sao_Paulo).

**Resultado: causa exata identificada; ajuste mínimo validado apenas em memória. A configuração persistida não foi alterada e continua bloqueada. Nenhuma conexão PostgreSQL foi realizada.**

**1. Causa exata e origem do erro**

A variável `DATABASE_URL` do perfil existente `app-dev` contém o parâmetro de consulta **`sslmode=disable`**. A função `assertDevTarget`, em `backend/scripts/inspect-reconciliation.ts:219`, aceita somente os parâmetros:

- `schema`, com valor exatamente `public`;
- `connection_limit`, `connect_timeout` e `pool_timeout`, com valores compostos por dígitos.

No laço de validação dos parâmetros, iniciado na linha 228, a chave `sslmode` não pertence à lista permitida. A condição de rejeição é verdadeira independentemente do valor dessa chave. O `catch` da linha 237 converte essa rejeição em `InspectionError('DESTINO')`, cuja mensagem externa é fixa e sanitizada.

Portanto, **o valor esperado para `sslmode` neste contrato é a ausência do parâmetro**. Não há outro valor de `sslmode` que seja aceito pela implementação atual.

O outro ponto que produz `DESTINO`, em `runInspection` nas linhas 263–264, bloqueia `NODE_ENV=test` ou `DB_PROFILE` explícito diferente de `app-dev`. Essa condição não foi a causa observada.

Arquivo de configuração efetivamente carregado, sem divulgação de seu conteúdo:

```text
C:\Users\u1n3c\AppData\Local\CardapioDigital\secrets\app-dev.env
```

O carregador `loadDatabaseProfile('app-dev', { purpose: 'runtime' })`, de `backend/src/config/secrets.ts`, valida perfil, banco, role e estrutura da URL. A validação adicional do inspetor restringe também os parâmetros de consulta. Isso explica por que o carregamento do perfil passa e `assertDevTarget` rejeita a mesma configuração.

**2. Diagnóstico offline observado, sem segredos**

O diagnóstico leu a configuração existente usando o carregador do projeto e avaliou as condições em memória. Não chamou `runInspection`, não construiu PrismaClient e não abriu conexão. Foram impressos somente nomes de verificações, resultados booleanos e parâmetros/valores não sensíveis previamente permitidos para diagnóstico.

| Verificação | Esperado | Observado offline |
|---|---|---|
| Ambiente | Não ser `test`; perfil explícito ausente ou `app-dev` | Aprovado |
| Perfil / finalidade | `app-dev` / `runtime` | Aprovado |
| Banco dos metadados e caminho da URL | Exatamente `cardapio_digital_dev` | Ambos aprovados |
| Role dos metadados e usuário da URL | Exatamente `cardapio_dev_app` | Ambos aprovados |
| Shadow | Ausente | Aprovado |
| Protocolo | `postgresql:` | Aprovado |
| Host | `localhost` ou `127.0.0.1` | Aprovado |
| Porta | `5432` | Aprovado |
| Senha | Presente, sem exibição | Aprovado; conteúdo omitido |
| Fragmento de URL | Ausente | Aprovado |
| `schema` | `public` | Aprovado |
| `connection_limit` e `connect_timeout` | Valores numéricos | Aprovados; valores omitidos |
| `sslmode` | Ausente da URL, pois não é permitido | **Reprovado: presente com valor `disable`** |

**Não existe divergência observada entre o perfil selecionado e o banco/usuário descritos pela URL.** Isso se refere à configuração local; não confirma autenticação nem identidade de uma sessão real.

**3. Decisão de correção mínima**

O bloqueio decorre de **configuração incompatível com a lista restrita do inspetor**, não de comparação incorreta do nome do banco, precedência equivocada ou seleção de perfil errada. A função está aplicando a restrição que foi implementada. Não foi necessário nem apropriado remover verificações ou ampliar a lista para fazer a configuração passar.

**Nenhuma correção de código de produção foi aplicada.** O inspetor e os utilitários importados permanecem intactos. Seu SHA-256 foi confirmado sem alteração:

```text
78E0E6EA50CF25CBAB238135576A4510A278A7BF3BAD22E7F53F2CEED98FAAE8
```

Conforme a regra desta entrega para configuração incompatível, o ajuste necessário fica documentado e pendente de autorização:

1. No arquivo externo `app-dev.env` indicado acima, editar somente o valor de `DATABASE_URL`.
2. Remover exclusivamente o par de consulta `sslmode=disable`, mantendo os separadores válidos.
3. Preservar usuário, senha, host, porta, caminho do banco e os demais parâmetros.
4. Não editar `backend/.env`, os perfis Test/Shadow/migration, roles ou privilégios.

Fragmentos ilustrativos, sem URL ou credenciais:

```text
Antes:  ?schema=public&sslmode=disable&connection_limit=<valor existente>&connect_timeout=<valor existente>
Depois: ?schema=public&connection_limit=<mesmo valor>&connect_timeout=<mesmo valor>
```

Os marcadores acima não são valores para copiar. O ajuste **não foi persistido**. Também não foi adicionado fallback, descarte automático de parâmetros no fluxo de validação ou substituição automática de credenciais.

**4. Validação da solução em memória**

Foi criada uma cópia da URL carregada, exclusivamente em memória, e removida somente sua chave `sslmode`. Essa cópia foi passada ao `assertDevTarget` existente. O resultado observado foi:

```json
{
  "adjustment": "remove sslmode only in memory",
  "approvedOffline": true,
  "databaseUnchanged": true,
  "roleUnchanged": true,
  "credentialsUnchanged": true,
  "fileUnchanged": true,
  "connectionCreated": false
}
```

A igualdade do arquivo foi verificada comparando seus bytes antes/depois da operação em memória, sem imprimi-los. Nenhum arquivo `.env` foi escrito. A URL retornada pelo validador não foi impressa.

Esse resultado demonstra que a remoção isolada do parâmetro elimina o bloqueio local conhecido. **Não demonstra conexão bem-sucedida, compatibilidade do transporte com o servidor, privilégios efetivos ou estado do catálogo**, pois não houve acesso ao PostgreSQL.

**5. Testes e regressão**

Foram adicionados **10 testes**, apenas em `backend/tests/scripts/inspect-reconciliation.test.ts`, cobrindo:

- Reprodução do bloqueio por `sslmode=disable`, antes de criar cliente ou consultar catálogo, com diagnóstico sanitizado.
- Aceitação da cópia ajustada em memória, preservando destino e credenciais fictícias; a configuração original continua rejeitada.
- Rejeição de três nomes de banco apenas parcialmente correspondentes ao nome Dev.
- URL vazia ou ausente.
- Senha ausente ou usuário ausente, sem exibir o segredo fictício.
- Configuração indisponível, simulada por erro do carregador, sem criação de cliente e sem expor os detalhes externos.

Os testes existentes continuam cobrindo destino correto/incorreto, perfil incorreto, Test, Shadow, RF004, URL incompatível, identidade não verificável, exigência de leitura, precedência da identidade sobre o catálogo e sanitização.

Comandos executados a partir de `backend`:

```powershell
node node_modules/vitest/vitest.mjs run tests/scripts/inspect-reconciliation.test.ts tests/scripts/seed-real.test.ts tests/scripts/seed-real-corrected.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.build.json --pretty false
```

| Verificação | Resultado |
|---|---|
| Testes relacionados | **138 aprovados em 3 arquivos**: 89 do inspetor e 49 de classificação/preço. |
| Typecheck específico do inspetor e seu teste | **0 diagnósticos**, com as mesmas opções de `tsconfig.json`. |
| Build da aplicação | **Aprovado**, código de saída 0; emite `src` em `dist`, sem executar a aplicação. |
| Diagnósticos gerais | **Os mesmos 10 erros preexistentes**, externos ao inspetor e seu teste. |

O typecheck foi realizado com a API TypeScript via entrada padrão: `readConfigFile`, `parseJsonConfigFileContent`, `createProgram` e `getPreEmitDiagnostics`. O programa específico teve como entradas `scripts/inspect-reconciliation.ts` e `tests/scripts/inspect-reconciliation.test.ts`. Um segundo programa coletou os diagnósticos gerais. O código de saída 0 desse verificador corresponde ao programa específico, não à aprovação global.

| Arquivo externo, sem alteração nesta entrega | Diagnósticos gerais |
|---|---|
| `scripts/analyze-excel.ts` | 2: TS2538 e TS2769 |
| `scripts/analyze-excel2.ts` | 1: TS2538 |
| `scripts/executor-seed-real.ts` | 5: TS2363 e quatro TS2322 |
| `tests/access.test.ts` | 1: TS2353 |
| `tests/scripts/seed-dev.test.ts` | 1: TS2307 |

Os testes do inspetor mantêm barreiras contra o carregador real, construtor Prisma real e conexões TCP. As verificações finais desses testes passaram. As leituras autorizadas da configuração nesta entrega foram feitas separadamente, sem construir cliente. Nenhuma Seed ou migration foi executada; as funções de classificação e preço foram exercitadas offline pelos testes.

**6. Proteções preservadas e escopo dos arquivos**

- Somente `cardapio_digital_dev` é aceito por igualdade exata; nomes parciais continuam rejeitados.
- Test, Shadow, RF004, perfil incompatível e credenciais ausentes continuam bloqueados.
- `current_database()`, `current_user`, `session_user` e modo somente leitura continuam obrigatórios antes das consultas de catálogo na futura execução.
- `SET TRANSACTION READ ONLY`, transação única e encerramento em `finally` permanecem no script, sem execução real nesta entrega.
- Nenhuma mudança na classificação dos 168 candidatos ou no tratamento de `PA062240`.
- Nenhuma alteração em schema, dados, roles, privilégios ou credenciais.

Arquivos de entrega alterados/criados:

| Arquivo | Alteração |
|---|---|
| `backend/tests/scripts/inspect-reconciliation.test.ts` | Adição dos 10 testes de regressão do bloqueio conhecido. |
| `RELATORIO-ENTREGA-3D.2.13.3.md` | Este relatório. |

O build atualizou apenas artefatos locais gerados em `backend/dist`. Não houve refatoração do inspetor, auditoria adicional de módulos ou alteração de outros arquivos-fonte.

**7. Comando para futura inspeção — não executado**

Após autorização do ajuste de configuração, sua aplicação e nova validação offline, uma futura inspeção real ainda depende de autorização expressa. Com diretório de trabalho em `backend`, o comando previsto é:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/inspect-reconciliation.ts --inspect-dev-read-only
```

**8. Pendências e parecer final**

A causa de `DESTINO` foi isolada e o ajuste mínimo foi validado offline. Não há pendência de mudança no código de produção para esse bloqueio. A alteração persistente de `DATABASE_URL` permanece pendente de autorização, conforme a proibição de modificar `.env` nesta etapa.

**A inspeção pode ser retomada após esse ajuste autorizado e sua revalidação; com o arquivo atual intacto, ela continua bloqueada.** Não há promessa de sucesso de autenticação, transporte ou consultas antes da futura verificação real.

Os dez erros gerais e a incompatibilidade conhecida de `PA062240` permanecem registrados, sem alterações e sem ampliar o escopo desta entrega.

Conexões PostgreSQL nesta entrega: **0**. Inspeções reais: **0**. Escritas SQL, Seed e migrations: **0**. Trabalho encerrado após este relatório, aguardando instruções.
