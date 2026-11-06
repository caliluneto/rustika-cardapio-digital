# RELATÓRIO — 3D.5.2-C FIX02
**Falso positivo de role preexistente no PostgreSQL efêmero**

A homologação **não** está aprovada: ela só será considerada aprovada quando o ensaio completo passar no GitHub Actions. Este FIX não executou PostgreSQL, migrations, Playwright nem o workflow.

## 1. Causa raiz
Execução `42252210921`: TLS e inicialização OK; a suíte falhou em `provisioning.ephemeral.ts` (~linha 181) com `expected [{ rolname: 'rustika_eph_admin' }] to deeply equal []`. A consulta de "roles do projeto" usava `LIKE 'cardapio\_%' OR LIKE 'rustika\_%'`, que também casa `rustika_eph_admin`, o superusuário temporário criado pelo próprio workflow na inicialização do container. O mesmo falso positivo existia na verificação final do `afterAll` (~linha 194).

## 2. Consulta SQL
A consulta é uma só, para o início e o cleanup, e continua ampla (não exclui nada em SQL):
```sql
SELECT rolname FROM pg_roles WHERE rolname LIKE 'cardapio\_%' OR rolname LIKE 'rustika\_%' ORDER BY rolname
```
A classificação é feita em código (`tests/homolog-ephemeral/roleGuard.ts`): `assertOnlyEphemeralAdminRole(roles, ADMIN_USER)` exige que `ADMIN_USER === 'rustika_eph_admin'`, que essa role exista exatamente uma vez e que **nenhuma outra** apareça. Bancos: `assertOnlyPostgresDatabase` (somente `postgres`).

## 3. Justificativa da exceção exata
* Igualdade de nome (`===`), nunca prefixo, `LIKE` ou `NOT IN`; vale apenas para a identidade validada contra a constante.
* A role administrativa é obrigatória enquanto o servidor está ativo (ausência falha), não é removida nem renomeada pelo cleanup interno (`ALL_ROLES` não a contém; teste estático garante) e é descartada junto com o container pelo cleanup externo.
* Todas as roles do ensaio (`cardapio_*`, `rustika_homolog_marker`) mantêm resíduo zero.

## 4. Regressões testadas (`tests/homolog-ephemeral-roleguard.test.ts`, 10 testes)
Só a admin: permitido (início e pós-cleanup) · admin ausente: falha · identidade inesperada: falha · outra `rustika_*`: falha · outra `cardapio_*`: falha · cada role residual do ensaio (8): falha · nomes que apenas começam/terminam como a admin: falham · banco residual: falha · consulta sem exclusão genérica · suíte efêmera usa o guard em início e cleanup e não remove a admin.

## 5. Arquivos alterados
`backend/tests/homolog-ephemeral/provisioning.ephemeral.ts` (consultas/asserções, import, remoção de `PROJECT_LIKE`), `backend/tests/homolog-ephemeral/roleGuard.ts` (novo), `backend/tests/homolog-ephemeral-roleguard.test.ts` (novo), este relatório. SQL, TLS, gates de host, identidade do cluster e workflow: inalterados.

## 6. Resultados locais
`tsc --noEmit`: apenas os 2 erros legados de `tests/scripts/verify-fixtures-rotation.ts` · `npm run build` OK · `test:ci`: 990 aprovados, 8 ignorados (antes 980; +10) · varredura de segredos: sem ocorrências novas.

## 7. Commit publicado / 8. Remoto
Informados na mensagem final da entrega (o hash não pode constar no próprio commit).

## 9. Estado das migrations
As sete migrations originais não foram tocadas, executadas nem copiadas com alteração. Nenhuma migration foi aplicada localmente.

## 10. Próxima execução recomendada
Actions → `homolog-ephemeral` → *Run workflow* (`main`) → `run_homolog_ephemeral = true`. A aprovação do ensaio depende de o job completo ficar verde, com cleanup externo confirmado.
