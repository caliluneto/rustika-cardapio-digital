# E4-ALT — bootstrap administrativo excepcional via migrator

## Estado e decisão

**Viabilidade local: GO. Execução remota: NO-GO até autorização explícita e aprovação humana do manifesto de fingerprint 9/9.**

O `cardapio_homolog_migrator` é o proprietário esperado do banco `cardapio_digital_homolog` e da tabela `public.admins`. Portanto, ele já pode realizar a única inserção necessária sem `GRANT`, `REVOKE`, membership, alteração de role ou abertura de `LOGIN` para `cardapio_homolog_bootstrap`.

O executor E4-ALT é separado do bootstrap original e existe somente para este alvo Neon. Ele não integra a API, o processo de inicialização da aplicação, migrations, deploy ou os gates 05–08. O gate 09 original permanece inalterado.

## Comparação de segurança

| Controle | Bootstrap original | Executor E4-ALT |
|---|---|---|
| Credencial | `cardapio_homolog_bootstrap`, temporária e restrita | `cardapio_homolog_migrator`, proprietária dos objetos e mais poderosa |
| Janela operacional | Gates 05–08 concedem, habilitam, fecham e revogam | Nenhuma mudança de ACL, membership ou atributo de role |
| Escopo do código | Primeiro administrador via role dedicada | Primeiro administrador via migrator, somente neste alvo fixo |
| Identidade | Banco, role, cluster e migrations | Banco, OID, role, cluster, projeto, branch, PostgreSQL 18+, owners, bootstrap OID/NOLOGIN/atributos, matriz de ACL/ownership/memberships, 9/9 migrations e manifesto de fingerprint |
| TLS no Neon | Fluxo original não foi criado para esta exceção | URL estrita e endpoint direto; prova independente do socket TLS externo |
| Concorrência | Transação `Serializable` e contagem zero | Preflight `Serializable READ ONLY` e nova verificação dentro da transação `Serializable` de escrita; conflito é recusado |
| Resultado incerto | Sem contrato específico para queda durante o COMMIT | `OUTCOME_UNKNOWN`, exit 3 e proibição de repetição antes da reconciliação |
| Disponibilidade | Entry point manual próprio | Entry point manual separado, sem script de start/deploy |

O E4-ALT elimina a necessidade de ampliar privilégios, mas **não torna a credencial migradora menos privilegiada**. Seu uso só é aceitável como operação excepcional, supervisionada e única.

## Interlocks implementados

- perfil fixo `migrate-homolog`, carregado com purpose `migration`, sem fallback;
- alvo fixo: projeto `aged-scene-47291697`, branch `br-frosty-fire-bd4xw2sc`, banco `cardapio_digital_homolog`, OID `57355` e role `cardapio_homolog_migrator`;
- PostgreSQL 18 ou superior, `current_user` e `session_user` exatos;
- `neon.project_id` e `neon.branch_id` conferidos pelo servidor;
- marca de cluster comparada a `EXPECTED_CLUSTER_ID` do perfil;
- endpoint Neon **exato** `ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech`, sem `-pooler`, com `sslmode=require`, `sslaccept=strict` e `channel_binding=require`, cada parâmetro uma única vez;
- prova TLS externa independente com CA, hostname/SNI e protocolo; a mesma URL validada é usada pelo Prisma;
- no Prisma/Quaint 6.19.3, `verify-full` é valor não suportado e cai silenciosamente em `prefer`; `require` obriga TLS, `strict` valida cadeia/hostname via `native-tls`, e `channel_binding=require` é repassado ao `tokio-postgres`. A sonda separada `pg` 8 usa host, credenciais e objeto `ssl` explícitos (não `connectionString`, que poderia substituir as opções TLS); **não** prova o channel binding da sessão Prisma. O teste local `tests/bootstrap/e4-alt-tls-behavior.test.ts` prova handshakes e recusas no motor real com servidor sintético, sem autenticar nem consultar o Neon. A primeira sessão real ainda exige verificação autorizada.
- migrator sem `SUPERUSER`, `CREATEROLE`, `CREATEDB`, `REPLICATION` ou `BYPASSRLS` e proprietário do banco e de `public.admins`;
- role bootstrap com OID `57350`, `NOLOGIN`, sem atributos elevados, zero ownership, zero memberships ativas/saintes/de terceiros envolvendo roles `cardapio_*` (permitindo apenas até 4 linhas `ADMIN`-only de criador `neondb_owner` nativas do PostgreSQL 18 no Neon);
- matriz de ACL separando grants diretos (`0` exigido exceto `CONNECT` não-delegável no próprio `cardapio_digital_homolog` mantido pelo script oficial 02 enquanto `NOLOGIN`), ownership e privilégios efetivos; ACL nula não é tratada como ausência universal de privilégio;
- snapshot canônico com aliases fechados para as 3 roles de infraestrutura do Neon (`neondb_owner`, `cloud_admin`, `neon_superuser`) restritos por `neonProviderRoleScopeProblems()` exclusivamente a `defaultAcls` de `cloud_admin -> neon_superuser` e `memberships` `ADMIN`-only de `neondb_owner`;
- exatamente 9 migrations conhecidas, concluídas, não revertidas e com checksums locais esperados (`migrationSetDigest = 2a447389c62c1d7eb0178952ea53f5995b3bf9f044abeb5e8dcc36617f373fbd`);
- manifesto de fingerprint com status `APPROVED`, vinculado ao `sourceDigest` calculado **na revisão atual** (o valor histórico `a4321b63…122c12fe48` foi invalidado pela correção TLS), alvo, OID e conjunto de 9 migrations; candidato `CANDIDATE_UNAPPROVED` nunca é aceito;
- zero administradores no dry-run e novamente dentro da transação de escrita;
- senha somente em TTY oculto, digitada duas vezes, validada pela política existente e processada pelo hash scrypt existente;
- única mutação no código: `admin.create`, dentro de transação `Serializable`;
- confirmação específica por `CARDAPIO_E4_ALT_CONFIRMATION` somente no modo `--execute`;
- dry-run em transação PostgreSQL `SERIALIZABLE READ ONLY`, comprovada por `current_setting('transaction_read_only')`, com cliente congelado sem métodos de escrita;
- dry-run não solicita senha, não calcula hash e não chama a operação de inserção;
- nenhum retry automático.

## Dry-run READ ONLY

O diagnóstico (`readFacts`) abre uma transação Prisma `Serializable` e, antes de qualquer consulta, executa `SET TRANSACTION READ ONLY`. Em seguida lê do próprio servidor `current_setting('transaction_read_only')` e `current_setting('transaction_isolation')`; se o resultado não for `true` e `serializable`, falha fechado. O coletor recebe um cliente congelado que expõe apenas `$queryRaw` e `admin.count`, sem `create`, `update`, `delete`, `$executeRaw` ou transação aninhada. O PostgreSQL continua sendo a barreira real: uma tentativa de escrita seria recusada com SQLSTATE `25006`, independentemente da tipagem. A coleta de dezenas de consultas possui agora timeout interativo Prisma explícito e finito de 120 s (o padrão de 5 s foi identificado como causa provável, não comprovada, da falha `Transaction not found` na tentativa E4-ALT.1-D); não há retry automático.

A transação de escrita (`insertFirstAdmin`) permanece `Serializable` sem `READ ONLY` e revalida os fatos dentro dela. Falhas no diagnóstico encerram a transação e a conexão pelo `try/finally` do Prisma e do entry point.

Na coleta de fingerprint E4-ALT.1-D-R, o executor registra exclusivamente nome fixo da etapa e duração em milissegundos (sem SQL, dados, senha ou URL), além da versão TLS externa; exige TLS 1.3 antes de abrir a transação. A falha anterior não identifica qual SELECT expirou e não gerou artefato. Cada tentativa remota exige autorização própria vinculada ao `sourceDigest` calculado após essas alterações; não há retry automático.

Prova local opt-in, sem Neon:

```powershell
$env:E4_ALT_LOCAL_READ_ONLY_URL = "<postgresql://...@localhost:5432/cardapio_digital_test>"
npx vitest run tests/bootstrap/read-only-local.test.ts
Remove-Item Env:E4_ALT_LOCAL_READ_ONLY_URL
```

O teste usa a mesma função do dry-run e tenta um `INSERT` de zero linhas por CTE modificadora; o PostgreSQL recusa com `25006` antes de qualquer gravação.

## Matriz de ACL

| Escopo | Grants diretos | Ownership | Privilégio efetivo |
|---|---|---|---|
| database | `datacl` | `datdba` | `CONNECT`, `TEMPORARY` (informacionais), `CREATE` (bloqueia) |
| schemas | `nspacl` | `nspowner` | `USAGE` (informacional), `CREATE` (bloqueia) |
| tables/views | `relacl` | `relowner` | SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER (bloqueiam) |
| columns | `attacl` | — | SELECT/INSERT/UPDATE/REFERENCES por coluna (bloqueiam) |
| sequences | `relacl` (`relkind='S'`) | `relowner` | USAGE/SELECT/UPDATE (bloqueiam) |
| functions/procedures | `proacl` | `proowner` | EXECUTE perigoso (SECURITY DEFINER, volátil ou procedure) bloqueia |
| types | `typacl` | `typowner` | USAGE é informacional |
| default ACLs | `defaclacl` | — | entram na contagem de grants diretos |

Memberships que envolvam qualquer role `cardapio_*` e atributos `SUPERUSER`, `CREATEROLE`, `CREATEDB`, `REPLICATION` ou `BYPASSRLS` também bloqueiam. `ACL NULL` significa apenas “sem ACL explícita neste objeto”; por isso os privilégios efetivos, incluindo os herdados de `PUBLIC` e de memberships, são medidos separadamente. Grant direto, ownership ou privilégio efetivo inseguro retorna `UNSAFE_ROLE`.

## Fingerprint independente 9/9

O hash antigo de 7 migrations (`0f9413…29c97`) é inválido para esta finalidade e não é aceito, renomeado ou promovido. O mecanismo novo tem dois artefatos:

1. `CANDIDATE_UNAPPROVED`: gerado por `scripts/e4-alt-fingerprint-candidate.ts` em sessão READ ONLY, contém alvo, perfil, `generatedAt`, HEAD Git, `sourceDigest`, versão do servidor, 9 migrations, snapshot canônico de 22 seções (`SECTIONS` em `schemaSnapshot.ts`), fingerprint do schema e matriz ACL. O digest é calculado pela implementação principal e conferido por implementação independente sobre WebCrypto; divergência aborta a geração.
2. `APPROVED`: manifesto humano separado, com `candidateDigest`, `schemaFingerprint`, `sourceDigest`, projeto, branch, banco, OID, `migrationSetDigest`, revisor, evidência e data UTC. O executor só aceita esse status e compara todos os vínculos com o código, o alvo e as 9 migrations atuais.

O `sourceDigest` cobre os arquivos do executor, o parser de aprovação, a implementação independente, as migrations esperadas, o snapshot, os dois scripts operacionais **e os módulos de perfil/TLS e versões de dependências envolvidos** (`SOURCE_FILES` em `e4AltFingerprintApproval.ts`); não cobre o repositório inteiro. O executor nunca gera nem aprova sua própria referência; `scripts/e4-alt-fingerprint-approve.ts` exige revisão humana explícita (`--confirm-approved`, revisor e evidência) e recusa candidato cujo digest não confira nas duas implementações. Nenhum fingerprint é declarado aprovado nesta entrega.

Procedimento, ainda não executado:

```powershell
npx tsx scripts/e4-alt-fingerprint-candidate.ts --out "<candidato.json>" --git-head "<SHA40_DO_HEAD>" --authorize-read-only
npx tsx scripts/e4-alt-fingerprint-approve.ts --candidate "<candidato.json>" --out "<aprovacao.json>" --reviewer "<REVISOR>" --evidence "<REFERENCIA>" --confirm-approved
```

O candidato deve ser comparado com a identidade e as ACLs do gate 09 antes da aprovação. O manifesto aprovado é insumo externo: não é gerado pelo executor, não é inferido do banco e não substitui a autorização remota literal.

## Plano operacional de execução única

### Pré-condições

1. Obter por processo controlado o **manifesto de aprovação** do fingerprint do estado esperado de 9 migrations. Não usar um valor calculado durante a própria tentativa como aprovação retroativa, nem o hash de replay de 7 migrations.
2. Confirmar que não houve migration, alteração de schema, ACL, role, membership ou criação de administrador desde a aprovação desse fingerprint.
3. Obter a autorização remota literal descrita abaixo, com nome, e-mail e fingerprint preenchidos.
4. Usar terminal interativo local protegido, sem gravação de sessão, compartilhamento de tela ou histórico contendo credenciais.

### Preflight remoto somente leitura

Não executar nesta entrega. Depois de autorizado, em PowerShell, substituir os campos entre `<...>` e executar sem `--execute`:

```powershell
npx tsx scripts/bootstrap-admin-migrator.ts `
  --profile migrate-homolog `
  --name "<NOME_DO_ADMINISTRADOR>" `
  --email "<EMAIL_DO_ADMINISTRADOR>" `
  --fingerprint-approval "<CAMINHO_DO_MANIFESTO_APPROVED.json>"
```

Somente `resultado=dry-run-ok` permite considerar a escrita. Qualquer recusa ou erro é **NO-GO**.

### Escrita única

Na mesma estação, com o mesmo checkout, perfil e manifesto aprovados:

```powershell
$env:CARDAPIO_E4_ALT_CONFIRMATION = "CREATE_FIRST_ADMIN_VIA_MIGRATOR_AGED_SCENE_47291697_BR_FROSTY_FIRE_BD4XW2SC"
npx tsx scripts/bootstrap-admin-migrator.ts `
  --profile migrate-homolog `
  --name "<NOME_DO_ADMINISTRADOR>" `
  --email "<EMAIL_DO_ADMINISTRADOR>" `
  --fingerprint-approval "<CAMINHO_DO_MANIFESTO_APPROVED.json>" `
  --execute
Remove-Item Env:CARDAPIO_E4_ALT_CONFIRMATION
```

A senha é solicitada duas vezes no TTY e nunca deve ser fornecida em argumento, variável de ambiente, arquivo ou pipe. Sucesso exige exit code `0` e `resultado=created`. Depois disso, não executar novamente.

## Recuperação e reconciliação

| Resultado | Ação obrigatória |
|---|---|
| Recusa antes da senha ou inserção | Corrigir somente a causa externa; não mudar interlocks para forçar aprovação |
| Erro definido antes do COMMIT | Não presumir sucesso; reconciliar em sessão somente leitura antes de qualquer nova decisão |
| `OUTCOME_UNKNOWN` / exit 3 | **Não repetir.** A conexão pode ter caído depois de o servidor confirmar o COMMIT |
| `resultado=created` | Fazer verificação somente leitura de contagem, e-mail normalizado e hash em formato scrypt; encerrar o procedimento |

Reconciliação mínima, por ferramenta somente leitura já aprovada:

1. conferir `count(*)` de `public.admins`;
2. se for `1`, conferir que o e-mail normalizado corresponde ao autorizado, sem exibir o hash;
3. se for `0`, tratar a tentativa como não aplicada, remover a confirmação do ambiente e solicitar **nova autorização** antes de outra execução;
4. se for maior que `1` ou se a identidade divergir, interromper, preservar evidências e iniciar resposta a incidente;
5. nunca redefinir senha PostgreSQL, habilitar a role bootstrap, alterar ACLs, executar migrations ou gates 05–08 como recuperação.

## Critérios GO / NO-GO

### GO para uma futura execução remota

Todos os itens devem ser verdadeiros ao mesmo tempo:

- revisão e testes locais permanecem aprovados no mesmo conteúdo de código;
- fingerprint do schema e manifesto `APPROVED` conferem com o código, o alvo e as 9 migrations;
- autorização literal foi emitida para nome, e-mail, alvo e fingerprint específicos;
- dry-run remoto em READ ONLY retorna `dry-run-ok`;
- identidade, TLS, owners, OIDs, atributos, ownership, matriz ACL, memberships, 9/9 migrations, fingerprint e zero admins passam;
- operador está em TTY protegido e entende o procedimento de `OUTCOME_UNKNOWN`.

### NO-GO

Qualquer divergência, fingerprint ausente, candidato sem aprovação, manifesto de outra revisão ou conjunto de migrations, administrador existente, confirmação ausente, endpoint pooler, TLS não comprovado, role diferente, owner divergente, membership, grant/ownership/privilégio efetivo inesperado, migration inesperada, falha de conexão ou falta de autorização mantém a escrita bloqueada.

## Riscos residuais

1. A credencial migradora pode modificar muito mais que `admins`; o limite é imposto pelo executor e pelo procedimento, não por privilégios PostgreSQL reduzidos.
2. A prova TLS externa ocorre em uma conexão independente porque o Prisma não expõe o socket; ambas usam a mesma URL validada, mas não são o mesmo socket.
3. Uma perda de conexão na fronteira do COMMIT impede distinguir localmente COMMIT aplicado de não aplicado; por isso existe `OUTCOME_UNKNOWN` sem retry.
4. O manifesto aprovado é um insumo operacional externo. Sem ele, o executor falha fechado e o GO remoto permanece bloqueado.
5. Mudanças no Neon, no schema ou nas roles após o dry-run podem invalidar a evidência; a transação revalida os fatos, mas a autorização deve ser revogada se houver mudança conhecida.
6. O READ ONLY impede escrita dentro da transação de diagnóstico, mas não impede que outro processo altere o banco entre a coleta e a execução; por isso o fingerprint e a autorização têm validade operacional curta e o executor revalida tudo na transação de escrita.
7. A prova de SQLSTATE `25006` foi executada em PostgreSQL local opt-in; o mesmo comportamento é esperado no Neon, mas a evidência remota só existirá após um dry-run autorizado.

## Texto exato da autorização remota

Substituir os três campos e emitir o texto completo. A autorização não é válida com placeholders:

> Autorizo explicitamente uma execução remota supervisionada do E4-ALT no projeto Neon `aged-scene-47291697`, branch `br-frosty-fire-bd4xw2sc`, banco `cardapio_digital_homolog` OID `57355`, usando exclusivamente o perfil `migrate-homolog` e a role `cardapio_homolog_migrator`, para criar exatamente o primeiro administrador com nome `<NOME_DO_ADMINISTRADOR>` e e-mail `<EMAIL_DO_ADMINISTRADOR>`, validando o fingerprint aprovado `<SHA256_APROVADO_DE_64_HEXADECIMAIS>`. Autorizo primeiro o dry-run somente leitura e, somente se ele retornar `dry-run-ok` sem divergências, uma única execução com `--execute` e a confirmação `CREATE_FIRST_ADMIN_VIA_MIGRATOR_AGED_SCENE_47291697_BR_FROSTY_FIRE_BD4XW2SC`. Não autorizo migrations, gates 05–08, `GRANT`, `REVOKE`, memberships, alteração de roles, deploy, importação de catálogo, qualquer outra escrita ou retry após `OUTCOME_UNKNOWN` sem reconciliação somente leitura e nova autorização.

## Arquivos da implementação

- `scripts/bootstrap-admin-migrator.ts` — entry point manual;
- `scripts/bootstrap/exceptionalMigratorBootstrap.ts` — política, fatos, matriz ACL, transação READ ONLY e classificação do resultado;
- `scripts/bootstrap/exceptionalMigratorCli.ts` — argumentos, confirmação, perfil, URL/TLS e leitura do manifesto;
- `scripts/bootstrap/e4AltFingerprintApproval.ts` — candidato, canonicalização, `sourceDigest` e parser do manifesto aprovado;
- `scripts/bootstrap/e4AltFingerprintIndependent.ts` — canonicalização e SHA-256 independentes via WebCrypto;
- `scripts/e4-alt-fingerprint-candidate.ts` — geração do candidato somente leitura;
- `scripts/e4-alt-fingerprint-approve.ts` — aprovação humana separada do candidato;
- `tests/bootstrap/exceptional-migrator-bootstrap.test.ts` — cobertura local do E4-ALT;
- `tests/bootstrap/read-only-local.test.ts` — prova opt-in de SQLSTATE `25006` em PostgreSQL local.

O bootstrap original (`scripts/bootstrap-admin.ts` e módulos associados), os SQLs 05–09, o schema Prisma, os perfis e a recovery não foram alterados pelo E4-ALT.
