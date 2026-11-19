# E4-ALT.1 — auditoria final e decisão sobre dry-run

Data da auditoria: 2026-11-18.

## Decisão

**NO-GO para o dry-run remoto e para qualquer criação de administrador.** Nenhuma conexão remota foi aberta nesta etapa.

Há dois bloqueios independentes:

1. não existe fingerprint aprovado e verificável para o estado final de 9 migrations;
2. o caminho de dry-run usa uma transação Prisma `Serializable`, mas não a declara `READ ONLY`. As instruções executadas são consultas, porém a transação continua tecnicamente apta a escrita e não satisfaz o critério E4-ALT.1.

## Revisão dos cinco artefatos

### `scripts/bootstrap-admin-migrator.ts`

- Carrega somente `migrate-homolog` por meio da CLI.
- Usa a URL validada para a prova TLS externa e para o Prisma.
- A senha é encaminhada exclusivamente a `readHiddenLine`, que recusa stdin sem TTY e usa modo raw sem eco.
- Não está importado pela API, pelo start, por workflows ou por scripts de deploy.

### `scripts/bootstrap/exceptionalMigratorBootstrap.ts`

- O alvo está fixado em projeto `aged-scene-47291697`, branch `br-frosty-fire-bd4xw2sc`, banco `cardapio_digital_homolog`, OID `57355`, migrator e bootstrap OID `57350`.
- A única mutação encontrada é `tx.admin.create(...)` no caminho execute.
- Não há DDL, migration, `GRANT`, `REVOKE`, alteração de role, seed ou fallback.
- O execute relê todos os fatos na transação `Serializable`, exige `adminCount = 0` e converte `P2034` em `CONCURRENT_BOOTSTRAP`.
- Erro depois do retorno do callback da transação é `CommitOutcomeUnknown`; não existe retry automático.
- **Bloqueio do dry-run:** `readFacts()` usa `$transaction(..., { isolationLevel: Serializable })` sem modo `READ ONLY`.
- **Limite adicional:** a contagem de ACL explícita do bootstrap cobre `pg_class`, colunas, schemas, banco e default ACLs. Ela não é uma enumeração universal de todos os catálogos ACL-bearing, como `pg_proc.proacl` e `pg_type.typacl`; a alegação global “sem ACL alguma” requer ampliar ou delimitar formalmente o escopo.

### `scripts/bootstrap/exceptionalMigratorCli.ts`

- Exige literalmente `--profile migrate-homolog`; `app-homolog` e qualquer outro perfil são recusados antes da conexão.
- O loader é chamado com purpose `migration`, e o retorno é conferido novamente quanto a profile, purpose, ambiente, banco, usuário e cluster.
- Exige endpoint Neon direto, rejeita `-pooler` e exige `sslmode=verify-full`, `sslaccept=strict` e `channel_binding=require`.
- O fingerprint é obrigatório e deve ter 64 caracteres hexadecimais; não há valor padrão ou cálculo usado como aprovação.
- O modo execute exige confirmação específica. O dry-run não pede senha nem chama a inserção.
- Não há fallback de perfil, banco, role ou endpoint.

### `tests/bootstrap/exceptional-migrator-bootstrap.test.ts`

- Cobre alvo correto/incorreto, runtime, TLS, owners, OIDs, memberships, bootstrap, migrations, fingerprint, zero admin, duplicidade, senha, concorrência, falha antes do COMMIT, COMMIT ambíguo, conexão, confirmação e ausência de DDL/ACL.
- Prova que o dry-run não chama o método de escrita, mas não prova uma transação PostgreSQL `READ ONLY`; esse é o gap identificado nesta auditoria.
- Usa fingerprint sintético (`"a"` repetido 64 vezes) apenas como fixture de teste, nunca como baseline operacional.

### `docs/admin-bootstrap-e4-alt.md`

- Documenta corretamente o caráter excepcional, o risco do migrator, os interlocks, a recuperação e a proibição de retry após `OUTCOME_UNKNOWN`.
- Precisa ser corrigido antes de uso operacional porque atualmente descreve o dry-run como suficiente sem registrar que a transação de preflight não é explicitamente `READ ONLY`.

## Perfil, runtime e caminhos alternativos

O entry point operacional não oferece fallback. A role runtime falha em três camadas: argumento de profile, profile carregado e `current_user/session_user` lidos do servidor. Os módulos exportam funções para teste, mas não estão conectados à API, ao start, ao Render ou a qualquer workflow. Não foi encontrado segundo entry point para o E4-ALT.

## Fingerprint localizado e proveniência

Única evidência concreta localizada:

- SHA-256: `0f941358a176c6a8ef22d9c6b897150e3fea23e7e5a5a04ab2bf1148fbb29c97`;
- relatório: `RELATORIO-RUSTIKA-C.7.4-REPLAY.md`, data declarada 2026-11-09;
- snapshot: `backend/docs/c74-replay-schema-snapshot.json`;
- ambiente: projeto Neon informado como `aged-scene-47291697`, perfil `migrate-homolog-replay`, banco `cardapio_digital_test`, role `cardapio_migrator`;
- estado: 7 migrations, antes do rename e das migrations finais;
- origem declarada: `readSchemaSnapshot` + `fingerprint`;
- validação declarada: consultas em `BEGIN READ ONLY`, checksums 7/7 e comparação A×A offline;
- limitações declaradas: snapshot incompleto por ACLs de `cloud_admin`/`neon_superuser` e memberships de `neondb_owner` sem alias;
- cadeia Git: relatório, snapshot e relatório acadêmico estão não rastreados; `git log` não fornece commit de origem. O HEAD atual é `3b857ad7e13ff4c06877235238731437c95eab66`.

Esse hash **não é aplicável** ao E4-ALT final: banco, nomes de roles, estado operacional e inventário de migrations divergem; faltam as migrations 8 e 9. Ele não foi passado ao executor e não deve ser convertido em baseline por conveniência.

## Procedimento seguro para estabelecer a baseline

1. Congelar uma revisão identificável do coletor, aliases, 9 migrations e interlocks; registrar commit ou hashes dos arquivos. Esta auditoria não autoriza commit.
2. Criar ou selecionar um ambiente de referência controlado, vazio e descartável, com exatamente as 9 migrations e o modelo final de roles/ACLs. Não usar o valor observado pelo próprio E4-ALT como aprovação automática.
3. Executar o coletor independente em transação PostgreSQL explicitamente `READ ONLY`; preservar o snapshot completo, saída, data UTC, projeto/ambiente, versão PostgreSQL, commit e checksums das migrations.
4. Exigir `snapshotCompletenessProblems = []`. Resolver roles Neon por aliases exatos revisados ou registrar uma política formal; não ignorar famílias inteiras de roles.
5. Produzir uma segunda evidência independente: comparação seção a seção com outro ambiente confiável ou revisão humana do snapshot contra migrations, schema e política ACL.
6. Submeter snapshot e SHA-256 à aprovação de uma segunda pessoa. Registrar aprovação imutável e anterior ao preflight do alvo.
7. Somente depois, corrigir o dry-run para garantir transação explicitamente `READ ONLY`, adicionar teste que prove a rejeição de uma instrução de escrita nesse modo e repetir typecheck/testes.
8. Usar o hash aprovado apenas como `--expected-schema-fingerprint`; o hash atual do alvo pode ser comparado a ele, nunca promovido automaticamente a baseline.

## Preflight e estado remoto

| Item | Resultado E4-ALT.1 |
|---|---|
| Conexão remota | Não aberta |
| Projeto/cluster/branch/endpoint | Não revalidado remotamente |
| Banco/OID/role/ownership/TLS | Não revalidado remotamente |
| Migrations 9/9 e checksums | Não revalidado remotamente |
| Fingerprint contra baseline | Bloqueado: baseline válida ausente |
| Administradores | Não recontados; o checkpoint anterior informava zero, mas isso não é evidência atual |
| Bootstrap NOLOGIN/ACLs | Não revalidado remotamente |
| Memberships | Não revalidadas remotamente |
| Dry-run | Não executado |

## Riscos residuais

1. A credencial migradora continua mais poderosa que a única operação pretendida.
2. O dry-run atual não é explicitamente `READ ONLY`.
3. A verificação de ACL bootstrap não cobre universalmente todos os tipos de objeto PostgreSQL.
4. A prova TLS externa e a conexão Prisma usam a mesma URL, mas sockets distintos.
5. A confirmação fixa não vincula criptograficamente nome, e-mail, fingerprint e revisão do código; a autorização operacional precisa fazê-lo.
6. Os arquivos E4-ALT e a evidência C.7.4 estão não rastreados, portanto não têm proveniência Git suficiente.
7. O estado remoto pode ter mudado desde o último checkpoint.

## Critérios de GO

GO somente quando todos forem atendidos:

- baseline 9/9 independente, completa, aprovada e vinculada a uma revisão identificável;
- dry-run explicitamente `READ ONLY`, com teste de tentativa de escrita recusada pelo PostgreSQL;
- escopo da verificação “bootstrap sem ACLs” completado ou formalmente delimitado e aprovado;
- testes, typecheck e auditoria de segredos verdes;
- novo preflight remoto retorna identidade, TLS, OIDs, owners, migrations, fingerprint, zero admins, NOLOGIN, ACLs e memberships conformes;
- autorização literal nova, preenchida e específica para uma única execução.

Qualquer ausência mantém **NO-GO**.

## Texto exato para futura autorização única

O texto abaixo só pode ser emitido depois da resolução dos bloqueios. Placeholders tornam a autorização inválida:

> Autorizo uma única criação remota do primeiro administrador pelo executor E4-ALT revisado em `<COMMIT_OU_DIGEST_DA_REVISAO_APROVADA>`, no projeto Neon `aged-scene-47291697`, branch `br-frosty-fire-bd4xw2sc`, banco `cardapio_digital_homolog` OID `57355`, exclusivamente com o perfil `migrate-homolog` e a role `cardapio_homolog_migrator`, para o nome `<NOME_DO_ADMINISTRADOR>` e e-mail `<EMAIL_DO_ADMINISTRADOR>`, usando como referência independente previamente aprovada o fingerprint SHA-256 `<FINGERPRINT_9_DE_9_APROVADO>`. Esta autorização é válida somente se, imediatamente antes, o dry-run explicitamente `READ ONLY` retornar `dry-run-ok` e comprovar projeto, cluster, branch, endpoint direto, TLS estrito, banco, OID, role, owners, 9/9 migrations e checksums, fingerprint idêntico, zero administradores, bootstrap OID `57350` em `NOLOGIN` sem ACLs e ausência de memberships temporárias. Autorizo exatamente um `INSERT` em `public.admins` dentro de transação `Serializable`, com senha digitada em TTY protegido. Não autorizo migrations, DDL, `GRANT`, `REVOKE`, alteração de roles, gates 05–08, seed, importação, deploy, qualquer outra escrita ou retry automático. Se ocorrer `OUTCOME_UNKNOWN`, não autorizo repetição antes de reconciliação somente leitura e nova autorização literal.

## Preservação

Nenhum arquivo E2.1 foi alterado, revertido, removido, resetado ou guardado em stash nesta auditoria. Nenhum commit, push ou deploy foi executado.
