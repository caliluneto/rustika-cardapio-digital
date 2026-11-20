# RELATÓRIO — 3D.5.2-C FIX03
**Exigência indevida de default ACLs não vazias**

A homologação **não** está aprovada: só estará quando o ensaio completo passar no GitHub Actions. Este FIX não executou PostgreSQL, migrations, Playwright nem o workflow.

## 1. Causa raiz comprovada
Execução `42258041912`: 13 testes aprovados, 1 reprovado (`seção defaultAcls não pode estar vazia: expected 0 to be greater than 0`, `provisioning.ephemeral.ts` ~l.317). A suíte exigia ≥1 registro em 15 seções, incluindo `defaultAcls`.
* **Coletor** (`schemaSnapshot.ts`): a consulta lê `pg_default_acl` com `aclexplode(defaclacl)`, que só produz linhas quando existe entrada. Está correta: devolve exatamente o que o catálogo contém; zero linhas = nenhuma default ACL.
* **Migrations**: a única que toca default privileges (`20261104000000_runtime_least_privilege`) executa apenas `ALTER DEFAULT PRIVILEGES … REVOKE ALL … FROM PUBLIC, <roles>` (global e `IN SCHEMA public`). Nenhuma migration faz `GRANT` default. O PostgreSQL elimina de `pg_default_acl` a linha cujo ACL volta ao padrão embutido, portanto o estado esperado é **vazio**. O resto da suíte (rename, equivalência A×B, fingerprints) passou, confirmando que o vazio é idêntico antes e depois.

## 2. Seções obrigatórias e opcionais
* **Obrigatórias não vazias** (14): `schemas, tables, columns, constraints, indexes, enums, sequences, owners, tableAcls, columnAcls, schemaAcls, databaseAcls, roles, databaseProps` (mesma lista de antes, menos `defaultAcls`).
* **Podem ser legitimamente vazias** (7): `defaultAcls, functions, views, triggers, policies, memberships, settings`. (`migrations` segue coberta pela comparação de `_prisma_migrations`.) As opcionais continuam coletadas, comparadas e dentro do fingerprint.

## 3. Alteração realizada
* `scripts/homolog/schemaSnapshot.ts`: novas `REQUIRED_NON_EMPTY_SECTIONS`, `OPTIONAL_SECTIONS`, `ROLE_BEARING_SECTIONS` e `snapshotCompletenessProblems()` (seção obrigatória vazia ou role desconhecida `?`). Coletor, `SECTIONS`, `diffSnapshots` e `fingerprint` inalterados.
* `tests/homolog-ephemeral/provisioning.ephemeral.ts`: os dois laços de verificação foram substituídos por `expect(snapshotCompletenessProblems(snapshotB)).toEqual([])`.

## 4. Garantias preservadas
Comparação antes/depois do rename (`diffSnapshots` = `[]`), igualdade de fingerprint, detecção de qualquer diferença em `defaultAcls`, rejeição de roles desconhecidas (inclusive em `defaultAcls`, `memberships`, `settings`, `policies`), `_prisma_migrations` idêntica, matriz de privilégios e `09-verify-acl.sql`. `defaultAcls` continua no snapshot.

## 5. Novos testes (`tests/scripts/schema-snapshot-completeness.test.ts`, 9, sem banco)
Default ACLs vazias antes/depois: equivalente · criada só depois: divergência · removida após rename: divergência · alterada: divergência · ordem diferente: estável · cada seção obrigatória ausente: falha · role desconhecida em cada seção que cita roles: falha · conjunto opcional exato (não virou tudo opcional) · coletor ainda lê `pg_default_acl` e a suíte usa a verificação e mantém diff/fingerprint.

## 6. Resultados locais
`tsc --noEmit`: apenas 2 erros **preexistentes** de `tests/scripts/verify-fixtures-rotation.ts` (nenhum introduzido) · build OK · `test:ci`: 999 aprovados, 8 ignorados (antes 990; +9) · varredura de segredos sem ocorrências novas · diff revisado.

## 7. Arquivos alterados
`backend/scripts/homolog/schemaSnapshot.ts`, `backend/tests/homolog-ephemeral/provisioning.ephemeral.ts`, `backend/tests/scripts/schema-snapshot-completeness.test.ts` (novo), este relatório. Migrations, SQL de renomeação, bootstrap, TLS, gates, workflow e credenciais: inalterados.

## 8. Commit publicado / 9. Remoto
Informados na mensagem final (o hash não pode constar no próprio commit). Repositório Git original não alterado.

## 10. Próxima execução recomendada
Actions → `homolog-ephemeral` → *Run workflow* (`main`) → `run_homolog_ephemeral = true`. Aprovação somente com o job completo verde e cleanup externo confirmado.
