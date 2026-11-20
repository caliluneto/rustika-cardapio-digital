# RELATÓRIO — 3D.5.2-C FIX04
**Classificação de proprietários do schema PostgreSQL**

A homologação **não** está aprovada: só estará quando o ensaio completo passar no GitHub Actions. Este FIX não executou PostgreSQL, migrations, Playwright nem o workflow.

## 1. Proprietário real identificado
`pg_database_owner`, a role nativa do PostgreSQL (≥ 14) que é a dona padrão do schema `public` e representa "o dono do banco". Evidência no código: a consulta de `schemas` usa `pg_get_userbyid(nspowner)` sobre `pg_namespace` e passa o resultado por `aliasRole()`; `DEFAULT_ROLE_ALIASES` só mapeia as 7 roles `cardapio_*`, então qualquer outro nome virava `?pg_database_owner`, e `snapshotCompletenessProblems` (FIX03) rejeita `?` em `schemas`. A falha `role desconhecida em schemas` aponta exatamente para essa seção; nenhuma migration altera o dono de `public`.

## 2. Causa raiz
`aliasRole()` não conhecia roles nativas. O diff e o fingerprint passaram porque a role aparecia de forma idêntica (`?pg_database_owner`) nos dois lados; só a verificação de completude, que trata `?` como role desconhecida, reprovou.

## 3. Correção implementada
`scripts/homolog/schemaSnapshot.ts`: nova lista fechada `NATIVE_SPECIAL_ROLES = {'pg_database_owner'}`; `aliasRole()` devolve esse nome inalterado quando casa **por igualdade exata**. Nada mais mudou: coletor, `diffSnapshots`, `fingerprint`, `SECTIONS` e `ROLE_BEARING_SECTIONS` (que ainda contém `schemas`).

## 4. Garantias preservadas
Sem exceção por prefixo `pg_` (`pg_monitor`, `pg_write_all_data`, variações de maiúsculas ou sufixos continuam `?nome`) · roles desconhecidas continuam reprovando em todas as seções, inclusive `schemas` · ownership segue no fingerprint (o dono agora aparece como `public:pg_database_owner`, e qualquer mudança real de dono altera diff e fingerprint) · nada dos dados coletados foi alterado ou filtrado · regras do FIX03 intactas (`defaultAcls` vazia permitida, seções obrigatórias).
Revisão preventiva: as demais consultas de ownership (`owners` de tabelas/sequências e dono do banco, `functions`, `views`) tratam objetos que pertencem a roles do projeto, sem evidência de role nativa; `schemaAcls` pode conter `pg_database_owner` como grantee do `public` (default do PG ≥ 15), agora corretamente tratado pela mesma função, e `policies`/`settings` não têm esse caso. Escopo não ampliado.

## 5. Testes acrescentados (`tests/scripts/schema-snapshot-ownership.test.ts`, 9)
`public` de `pg_database_owner` completo · role mapeada · desconhecida comum · desconhecida com prefixo `pg_` (6 variações) · mudança de dono detectada · ownership equivalente · fingerprint muda com dono diferente · ACL com role desconhecida falha e grantee nativo aceito · `defaultAcls` vazia permitida · `schemas` em `ROLE_BEARING_SECTIONS` e ausência de regra por prefixo no código.

## 6. Testes locais
`tsc --noEmit`: somente 2 erros **preexistentes** de `tests/scripts/verify-fixtures-rotation.ts` · build OK · `test:ci`: 1008 aprovados, 8 ignorados (antes 999; +9) · varredura de segredos sem ocorrências novas · diff revisado.

## 7. Arquivos alterados
`backend/scripts/homolog/schemaSnapshot.ts`, `backend/tests/scripts/schema-snapshot-ownership.test.ts` (novo), este relatório. Migrations, SQL, TLS, gates, bootstrap, workflow e E2E inalterados.

## 8. Commit publicado / 9. Remoto
Informados na mensagem final (o hash não pode constar no próprio commit).

## 10. Próxima execução recomendada
Actions → `homolog-ephemeral` → *Run workflow* (`main`) → `run_homolog_ephemeral = true`. Aprovação somente com o job completo verde e cleanup confirmado.
