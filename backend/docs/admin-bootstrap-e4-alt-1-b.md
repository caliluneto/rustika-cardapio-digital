# E4-ALT.1-B — correção dos bloqueios finais do bootstrap

**Data:** 2026-11-18
**Escopo:** correções locais do executor excepcional E4-ALT. Nenhuma conexão com o Neon, nenhuma escrita remota, nenhuma migration, nenhum gate 05–08, nenhum commit ou deploy.
**Decisão:** **GO local / NO-GO para dry-run remoto** até que exista manifesto de fingerprint 9/9 aprovado por revisão humana e autorização remota literal.

## 1. Diagnóstico corrigido

| Bloqueio E4-ALT.1 | Correção aplicada | Evidência |
|---|---|---|
| Dry-run usava `Serializable` sem `READ ONLY` | `readFacts()` agora executa `SET TRANSACTION READ ONLY` como primeira instrução, lê `transaction_read_only` e `transaction_isolation` do servidor e falha fechado se não forem `true`/`serializable` | Teste unitário + prova real em PostgreSQL local |
| Coletor podia, em tese, usar métodos de escrita | O callback recebe objeto congelado com apenas `$queryRaw` e `admin.count`, ambos ligados à mesma transação | Teste verifica chaves expostas e ausência de `create` |
| ACL resumida a uma contagem | Matriz separando grants diretos, ownership, privilégios efetivos inseguros e privilégios informacionais, com atributos e memberships | Consultas catalográficas + testes de cada classe |
| Fingerprint de 7 migrations inválido | Mecanismo novo de candidato 9/9 + manifesto humano `APPROVED`, sem reutilizar `0f9413…29c97` | `e4AltFingerprintApproval.ts`, `e4AltFingerprintIndependent.ts` e testes |
| Executor aceitava hash cru | CLI agora exige `--fingerprint-approval <arquivo>` e rejeita candidato, revisão, alvo, OID ou conjunto de migrations divergente | Testes de CLI e parser |
| Verificação independente ausente | Canonicalização e SHA-256 via WebCrypto, comparados ao cálculo principal; divergência aborta o candidato | Testes de igualdade de digest e de candidato determinístico |

O hash de replay `0f941358a176c6a8ef22d9c6b897150e3fea23e7e5a5a04ab2bf1148fbb29c97` **não foi reutilizado, renomeado nem promovido**. Ele continua inadequado para o estado de 9 migrations.

## 2. Arquivos alterados

- `backend/scripts/bootstrap/exceptionalMigratorBootstrap.ts`
  - transação `runSerializableReadOnlyTransaction`;
  - cliente congelado sem escrita;
  - matriz ACL/ownership/privilégios efetivos;
  - atributos elevados da role bootstrap;
  - coletor exportado `collectExceptionalFacts` (fatos + snapshot da mesma transação).
- `backend/scripts/bootstrap/exceptionalMigratorCli.ts`
  - `--fingerprint-approval` no lugar de `--expected-schema-fingerprint`;
  - leitura e validação do manifesto antes da conexão;
  - falha segura se o `sourceDigest` não puder ser calculado.
- `backend/scripts/bootstrap-admin-migrator.ts`
  - injeta a leitura do manifesto via `fs`.
- `backend/scripts/bootstrap/e4AltFingerprintApproval.ts` (novo)
  - canonicalização, `sourceDigest`, payload do candidato, template de aprovação e parser `APPROVED`.
- `backend/scripts/bootstrap/e4AltFingerprintIndependent.ts` (novo)
  - canonicalização e SHA-256 independentes via WebCrypto.
- `backend/scripts/e4-alt-fingerprint-candidate.ts` (novo)
  - coleta READ ONLY, confere HEAD local, gera `CANDIDATE_UNAPPROVED` com `flag: wx`.
- `backend/scripts/e4-alt-fingerprint-approve.ts` (novo)
  - aprovação humana separada, com revisor, evidência e `--confirm-approved`.
- `backend/tests/bootstrap/exceptional-migrator-bootstrap.test.ts`
  - READ ONLY, ACL, aprovação, candidato, CLI e revisão estática.
- `backend/tests/bootstrap/read-only-local.test.ts` (novo)
  - prova opt-in de SQLSTATE `25006` em PostgreSQL local.
- `backend/package.json`
  - scripts `e4-alt:fingerprint:candidate` e `e4-alt:fingerprint:approve`.
- `backend/docs/admin-bootstrap-e4-alt.md`
  - procedimento, READ ONLY, matriz ACL e fingerprint atualizados.
- `backend/docs/admin-bootstrap-e4-alt-1-b.md` (este relatório).

Nenhum SQL oficial 05–09, schema Prisma, migration, perfil de produção, Render, recovery ou credencial foi alterado.

## 3. Evidência da transação READ ONLY

Implementação:

1. `prisma.$transaction(..., { isolationLevel: Serializable })`;
2. primeira instrução do callback: `SET TRANSACTION READ ONLY`;
3. leitura de `current_setting('transaction_read_only')` e `current_setting('transaction_isolation')`;
4. erro se o servidor não devolver `true` e `serializable`;
5. callback recebe somente `$queryRaw` e `admin.count`, congelados;
6. falhas encerram a transação pelo Prisma e a conexão pelo `finally` do entry point.

Prova em PostgreSQL real local, sem Neon:

```text
E4_ALT_LOCAL_READ_ONLY_URL -> postgresql://127.0.0.1/cardapio_digital_test (perfil migrate-test)
Teste: tests/bootstrap/read-only-local.test.ts
Resultado: 1 passed
Configuração observada no servidor: readOnly=true, isolation=serializable
Tentativa: INSERT de zero linhas via CTE modificadora
Resposta: SQLSTATE 25006 (Prisma P2010 com meta.code=25006)
Linhas gravadas: 0
```

O teste é ignorado automaticamente sem a variável e recusa qualquer host que não seja `localhost`, `127.0.0.1` ou `::1`. A transação de escrita continua `Serializable` sem `READ ONLY`.

## 4. Matriz de ACL

Cobertura formal:

| Escopo | ACL explícita | Ownership | Privilégio efetivo |
|---|---|---|---|
| database | `pg_database.datacl` | `datdba` | `CREATE` bloqueia; `CONNECT`/`TEMPORARY` informacionais |
| schemas | `pg_namespace.nspacl` | `nspowner` | `CREATE` bloqueia; `USAGE` informacional |
| tables/views | `pg_class.relacl` | `relowner` | SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER bloqueiam |
| columns | `pg_attribute.attacl` | — | SELECT/INSERT/UPDATE/REFERENCES por coluna bloqueiam |
| sequences | `pg_class.relacl` (`relkind='S'`) | `relowner` | USAGE/SELECT/UPDATE bloqueiam |
| functions/procedures | `pg_proc.proacl` | `proowner` | EXECUTE em SECURITY DEFINER, volátil ou procedure bloqueia; EXECUTE comum é informacional |
| types | `pg_type.typacl` | `typowner` | `USAGE` informacional |
| default ACLs | `pg_default_acl.defaclacl` | — | contam como grant direto |
| roles | — | — | memberships com `cardapio_*` e atributos elevados bloqueiam |

Decisões semânticas:

- `ACL NULL` significa “sem ACL explícita naquele objeto”, não “sem privilégio universal”; por isso os privilégios efetivos são medidos com `has_*_privilege`, que considera `PUBLIC` e memberships.
- `CONNECT`, `TEMPORARY`, `USAGE` de schema, `EXECUTE` comum e `USAGE` de tipo entram como evidência informacional; não são confundidos com grant direto.
- Qualquer grant direto, ownership, `CREATE` em database/schema, privilégio de tabela/coluna/sequence ou rotina perigosa resulta em `UNSAFE_ROLE`.

Limite formal declarado: os privilégios efetivos de tabelas, colunas, sequences, rotinas e types são medidos no schema `public`, que é o contrato do projeto. Grants explícitos em qualquer schema são contados; objetos funcionais fora de `public` não são inspecionados por privilégio efetivo. Se o contrato mudar, a matriz precisa ser ampliada antes de qualquer GO.

## 5. Fingerprint candidato, endurecimento Neon PG 18 e proveniência

### Endurecimento de compatibilidade real com Neon PostgreSQL 18

Com base na evidência empírica de catálogo coletada anteriormente no replay e recuperação ACL (`c74-replay-schema-snapshot.json`, `02-create-replay-database.sql`, `neon/02-revoke-set-true-migrator.sql` e `RELATORIO-RECUPERACAO-C.6-ACL.md`), três falsos positivos fatais que abortariam a geração do candidato no Neon real foram eliminados sem afrouxar fronteiras de segurança:

1. **Memberships `ADMIN`-only do criador no PostgreSQL 18 (`neondb_owner`):** no PG 18, a role criadora mantém linha automática em `pg_auth_members` com `admin_option=true, inherit_option=false, set_option=false` sobre as 4 roles `cardapio_*`. O coletor agora exige `projectMembershipCount === 0` para qualquer membership sainte, com `INHERIT`/`SET` ou de terceiros, e registra `neonCreatorAdminOnlyMemberships` (`0..4`) separadamente.
2. **`CONNECT` explícito não-delegável no próprio banco (`02-create-replay-database.sql`):** o provisionamento concede `GRANT CONNECT ON DATABASE cardapio_digital_homolog TO cardapio_homolog_bootstrap` sem `WITH GRANT OPTION`, e o gate 08 não revoga `CONNECT` de database (a barreira é `rolcanlogin = false`). A matriz separa `explicitDatabaseConnectCurrentDb` (`0..1`, aceito somente enquanto `bootstrapCanLogin === false`) de `explicitGrants.database` (`0` obrigatório para `CREATE`, `TEMPORARY`, `WITH GRANT OPTION` ou outro banco).
3. **Roles de infraestrutura Neon no `SchemaSnapshot`:** `E4_ALT_ROLE_ALIASES` mapeia apenas `neondb_owner`, `cloud_admin` e `neon_superuser`, enquanto `neonProviderRoleScopeProblems(snapshot)` falha fechado se qualquer uma delas aparecer fora dos dois únicos lugares legítimos do Neon (`defaultAcls` de `cloud_admin -> neon_superuser` e `memberships` `ADMIN`-only de `neondb_owner`).

### Vínculos criptográficos verificados localmente

- **Repositório de desenvolvimento (`Cardapio_Digital`):** `HEAD = 3b857ad7e13ff4c06877235238731437c95eab66` (reconciliado com a arquitetura de dois repositórios disjuntos documentada em `publication-snapshot.md`, onde `165719f41d68d1c4e5f69e4375a7079bf1443706` pertence exclusivamente ao snapshot público sanitizado `cardapio-digital-snapshot`).
- **`sourceDigest` atual:** `a4321b63d51a44decfe9cff3bc994d66275f715f9a914df3517c9c122c12fe48`
- **`migrationSetDigest` (9/9 migrations):** `2a447389c62c1d7eb0178952ea53f5995b3bf9f044abeb5e8dcc36617f373fbd`

**Candidato remoto não produzido nesta entrega.** Motivos:

1. Não houve autorização remota específica para conexão ao Neon nesta sessão; a geração exige `--authorize-read-only` e conexão ao endpoint direto Neon.
2. O checkout local contém as alterações da entrega final ainda não commitadas (preservadas conforme regra de não commitar automaticamente); o vínculo criptográfico exato do conteúdo é o `sourceDigest` acima.

O gerador está pronto e testado com fatos sintéticos. Quando autorizado, produzirá:

- `format: rustika-e4-alt-fingerprint-candidate-v1`;
- `status: CANDIDATE_UNAPPROVED`;
- alvo completo (projeto, branch, banco, OID, role migradora);
- `generatedAt`, `gitHead`, `sourceDigest`;
- versão do servidor;
- 9 migrations com nome, checksum, `finished` e `rolledBack`;
- snapshot canônico de 22 seções (`SECTIONS` em `schemaSnapshot.ts`, incluindo ACLs, owners, memberships, roles e propriedades);
- fingerprint do schema;
- matriz ACL da role bootstrap;
- contagem de memberships;
- `candidateDigest` e verificação WebCrypto.

O manifesto aprovado terá `status: APPROVED`, `candidateDigest`, `schemaFingerprint`, `sourceDigest`, projeto, branch, banco, OID, `migrationSetDigest`, revisor, `reviewedAt` UTC e `reviewEvidence`. O executor só aceita esse manifesto; o candidato nunca é promovido automaticamente.

Procedimento de aprovação, ainda não executado:

```powershell
npx tsx scripts/e4-alt-fingerprint-candidate.ts `
  --out "<candidato.json>" `
  --git-head "<SHA40_DO_CHECKOUT>" `
  --authorize-read-only

npx tsx scripts/e4-alt-fingerprint-approve.ts `
  --candidate "<candidato.json>" `
  --out "<aprovacao.json>" `
  --reviewer "<REVISOR_INDEPENDENTE>" `
  --evidence "<REFERENCIA_DA_COMPARACAO_COM_GATE_09>" `
  --confirm-approved
```

## 6. Revisão independente do mecanismo

- O cálculo principal usa `node:crypto` sobre JSON canônico com chaves ordenadas.
- A verificação independente usa `node:crypto.webcrypto.subtle.digest` e um canonicalizador separado.
- O candidato só é gravado se os dois digests coincidirem; os testes verificam igualdade, determinismo e rejeição de snapshot divergente.
- A aprovação recalcula o digest do payload, confere a verificação independente e faz uma última validação pelo parser do executor; se o código ou alvo mudou desde o candidato, a aprovação é recusada.
- Limite: “independente” aqui é independência de implementação no mesmo repositório/runtime, não uma segunda organização. A revisão humana do candidato contra o gate 09 continua obrigatória.

## 7. Testes e validações

| Comando | Resultado |
|---|---|
| `npx vitest run tests/bootstrap/exceptional-migrator-bootstrap.test.ts` | **49/49 aprovados** |
| `npx vitest run tests/bootstrap/read-only-local.test.ts` (com PostgreSQL local) | **1/1 aprovado**; sem a variável, ignorado |
| `npm test` | **1305 aprovados, 3 ignorados**, 73 arquivos aprovados e 1 ignorado |
| `npm run typecheck` | aprovado |
| `npm run build` | aprovado |
| `npm run secrets:audit` | `POLICY_OK`, 7 segredos conformes |
| `git diff --check` | sem erros; apenas avisos de LF/CRLF do checkout Windows |

Cobertura específica adicionada:

1. transação READ ONLY comprovada no servidor;
2. INSERT recusado pelo PostgreSQL com SQLSTATE `25006`;
3. falha de conexão segura, sem senha e sem escrita;
4. ACL inesperada (grant direto, ownership, privilégio efetivo);
5. membership inesperada;
6. fingerprint ausente;
7. fingerprint divergente do servidor;
8. manifesto sem aprovação humana, com `sourceDigest`, migrations, alvo, OID ou revisor inválidos;
9. migrations divergentes;
10. ambiente incorreto;
11. administrador preexistente;
12. confirmação humana ausente;
13. candidato determinístico e não aprovado;
14. snapshot divergente dos fatos;
15. limites estáticos do executor (sem DDL, `GRANT`/`REVOKE`, gates, HTTP ou Render).

## 8. Revisão de segurança

| Item exigido | Situação |
|---|---|
| Somente `migrate-homolog` | Confirmado no parser e no carregamento do perfil; sem fallback |
| Ausência de fallback | Confirmado; qualquer perfil diferente retorna exit 2 antes da conexão |
| Proteção contra ambiente incorreto | Banco, OID, role, projeto, branch, cluster, TLS e PostgreSQL 18+ |
| Senha em TTY protegido | `readHiddenLine`; senha nunca em argumento, ambiente, arquivo ou log |
| `Serializable` na execução real | Mantido em `insertFirstAdmin`; `READ ONLY` só no diagnóstico |
| Zero administradores | Verificado no dry-run e novamente dentro da transação de escrita |
| Concorrência rejeitada | `P2034` vira `CONCURRENT_BOOTSTRAP`; `P2002` vira `ADMIN_ALREADY_EXISTS` |
| `OUTCOME_UNKNOWN` sem retry | Exit 3 e instrução explícita de não repetir |
| Nenhuma alteração de role/ACL | Nenhum `GRANT`, `REVOKE`, `ALTER ROLE` ou membership no executor |
| Nenhuma integração com API/Render | Entry point manual; teste estático confirma ausência de Express/Router e gates |

A revisão foi feita na própria sessão, sem delegação a agente externo. O motivo é a indisponibilidade dos agentes especializados do projeto neste ambiente; a revisão cobriu ameaças, controles, testes e riscos residuais. A área não recebeu parecer organizacional independente.

## 9. Riscos residuais

1. O migrator é mais privilegiado que a role bootstrap original; o limite é o executor e o procedimento, não o PostgreSQL.
2. A prova TLS externa usa conexão separada do Prisma; ambas usam a mesma URL validada, mas não o mesmo socket.
3. Queda na fronteira do COMMIT continua indistinguível localmente; por isso existe `OUTCOME_UNKNOWN` sem retry.
4. O manifesto aprovado é insumo externo; sem ele o executor falha fechado.
5. Mudanças no Neon, schema ou roles após o dry-run invalidam a evidência; a transação de escrita revalida, mas a autorização deve ser revogada se houver mudança conhecida.
6. O `READ ONLY` protege a transação de diagnóstico, não impede alteração concorrente entre a coleta e a escrita; a janela deve ser curta e o fingerprint revalidado.
7. A prova `25006` foi local; o comportamento remoto só será comprovado em dry-run autorizado.
8. O `sourceDigest` cobre o conteúdo atual, mas o checkout não está commitado; a aprovação vale para este conteúdo exato, não para um commit publicado.
9. A independência do fingerprint é metodológica, não organizacional.
10. Privilégios efetivos fora do schema `public` não são medidos; grants explícitos continuam cobertos.

## 10. Critérios GO / NO-GO

### NO-GO atual para dry-run remoto

- não existe manifesto `APPROVED` para 9/9 migrations;
- o HEAD real diverge do HEAD de referência;
- não há autorização remota literal para esta etapa;
- o candidato ainda não foi comparado ao gate 09 por revisor humano.

### GO para o dry-run remoto

Todos os itens devem ser verdadeiros:

1. HEAD reconciliado e conteúdo do executor congelado (commit de revisão ou registro explícito do `sourceDigest`);
2. autorização explícita para gerar o candidato em sessão READ ONLY;
3. candidato 9/9 gerado, com `independentVerification.matches=true`;
4. snapshot e ACL comparados ao gate 09 e aprovados por revisor identificado;
5. manifesto `APPROVED` emitido com revisor, evidência e data UTC;
6. autorização remota literal para o dry-run;
7. dry-run remoto retorna `dry-run-ok` sem divergências;
8. nova autorização literal para `--execute` (o dry-run não autoriza escrita).

### NO-GO imediato

Qualquer fingerprint ausente ou de outra revisão, candidato sem aprovação, alvo/OID/migrations divergentes, ACL/ownership/membership inesperada, administrador existente, confirmação ausente, endpoint pooler, TLS não comprovado, falha de conexão ou tentativa de reutilizar o hash de 7 migrations.

## 11. Próxima etapa planejada (sem autorizar bootstrap)

1. Reconciliar o HEAD: confirmar se `3b857ad7e13ff4c06877235238731437c95eab66` é a revisão correta ou restaurar `165719f41d68d1c4e5f69e4375a7079bf1443706` com autorização.
2. Congelar o conteúdo do executor e registrar o `sourceDigest`.
3. Autorizar e executar **somente** o gerador de candidato READ ONLY, sem `--execute`.
4. Comparar o snapshot do candidato com a identidade e as ACLs do gate 09; revisar divergências.
5. Emitir o manifesto `APPROVED` pelo script de aprovação, com revisor e evidência.
6. Emitir autorização remota literal para o dry-run e executá-lo com `--fingerprint-approval`.
7. Parar após `dry-run-ok`; a escrita única exige nova autorização literal e continua proibida nesta entrega.

Nenhum administrador foi criado, nenhuma conexão com o Neon foi aberta e nenhuma operação remota de escrita foi executada.
