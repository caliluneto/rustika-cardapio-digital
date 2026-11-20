# RELATÓRIO DE ENTREGA — 3D.3.23-D

Correção definitiva do ambiente E2E e auditoria de integridade do OneDrive. Alternativa A adotada. Nenhuma escrita no PostgreSQL, nenhum `--execute`, nenhum Playwright, nenhuma senha/secret/`.env` tocada, nenhum commit/push/reset/clean, nenhuma cópia de conflito removida.

## 1. Causa raiz do carregamento indevido do `.env`

`import '@prisma/client'` (Prisma 6) lê o `backend/.env` legado e injeta `DATABASE_URL` em `process.env`. Os pontos de entrada importam o Prisma (via `databases.ts` → `prisma.ts`) antes de `main()` chamar o gate, e o `assertE2eGate` proíbe `DATABASE_URL`/`SHADOW_DATABASE_URL`. Evidência: sonda `tests/helpers/launch-probe.ts` com o ambiente real devolveu `injectedBeforeGate: true` sem que o operador definisse nada. O defeito já existia desde a 3D.3.21-B e só apareceu agora porque o import quebrado (3D.3.23-C) mascarava o fluxo real e os testes unitários usam ambiente simulado.

## 2. Solução e justificativa

Novo módulo `backend/tests/integration-db/e2e/launch-env.ts`, **primeiro import** de `cleanup-legacy.ts`, `run-setup.ts` e `run-teardown.ts`:

- Fotografa, no carregamento, as duas chaves vigiadas (`DATABASE_URL`, `SHADOW_DATABASE_URL`) antes de qualquer efeito colateral.
- `guardedLaunch(gate)` executa o gate sobre o **ambiente de lançamento** (chaves vigiadas como o operador as passou). URL do operador continua bloqueando.
- Só se o gate passar, remove **por nome** exatamente as chaves vigiadas ausentes no lançamento. Nenhuma outra variável é tocada (sem remoção indiscriminada). Os gates seguintes (`openIntegrationDatabases`, `lifecycle`) rodam inalterados sobre o ambiente limpo.
- `gate.ts`, `preflight.ts`, `assertE2eGate`, `assertIntegrationGate`, `.env`, credenciais e perfis: **não alterados**. A URL injetada nunca escolhe o banco (os acessos usam só os perfis protegidos e `cardapio_digital_test`). Produção/desenvolvimento: sem alteração (mudança restrita a `tests/`).

## 3. Evidências dos testes de segurança

`tests/e2e-launch-env.test.ts` (9 testes, todos aprovados) + sonda em processo real:

1. URL definida pelo operador antes do lançamento → bloqueio, e nada é removido.
2. `SHADOW_DATABASE_URL` e URL de banco externo/outro banco → bloqueio (inclusive no gate de limpeza).
3. `.env` implícito: processo real com o import do Prisma → gate passa, `DATABASE_URL` não sobra no processo; o gate puro continua recusando a mesma variável.
4. Perfil restrito: `app-dev`, `migrate-test`, `app-test ` e `NODE_ENV='test '` recusados.
5. Falta de `RUSTIKA_E2E_CONFIRM`/`NODE_ENV`/`DB_PROFILE`/`RUSTIKA_E2E_LEGACY_CLEANUP` → bloqueio.
6. Dry-run sem escrita: coberto por `e2e-fixtures.test.ts` (83 testes, inclui "dry-run não escreve" e "deletes só com ids exatos") e pelo dry-run real (`executed:false`).
7. Produção inalterada: nenhum arquivo de `src/` mudou além da restauração (seção 5).

## 4. Arquivos modificados nesta etapa

- Novos: `backend/tests/integration-db/e2e/launch-env.ts`, `backend/tests/e2e-launch-env.test.ts`, `backend/tests/helpers/launch-probe.ts`.
- Alterados: `cleanup-legacy.ts`, `run-setup.ts`, `run-teardown.ts` (import + 1 linha cada).
- Recuperados das cópias de conflito (seção 6): `backend/package.json`, `backend/package-lock.json`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/services/api.ts`, `frontend/src/vite-env.d.ts`. Versões anteriores salvas em `...\scratchpad\pre-3d323d\`.
- Removido por mim: o script `e2e:setup` que eu havia inventado na 3D.3.23-C (não consta nas cópias nem na documentação).

## 5. Auditoria dos 20 arquivos restaurados do HEAD (3D.3.23-C)

Comparação entre working tree antigo (backup do scratchpad), HEAD e cópias `*-Calil-Notebook.*`:

- **Idênticos ao HEAD na cópia de conflito (sem perda detectável): 14** — `.gitignore`, `README.md`, `backend/.env.example`, `prisma/schema.prisma`, `src/app.ts`, `src/lib/prisma.ts`, `src/middleware/errorHandler.ts`, `src/server.ts`, `tests/health.test.ts`, `tsconfig.json`, `tsconfig.build.json`, `frontend/src/App.tsx`, `index.css`, `main.tsx`, `tsconfig.json` (a lista inclui os pedidos: `.gitignore`, `.env.example`, `health.test.ts`).
- **Cópia de conflito MAIS NOVA que o HEAD (edições legítimas da 3D.3.21-A/B): 6, todas recuperadas:**
  - `backend/src/config/env.ts` — `.trim()` de `NODE_ENV` (já reaplicado na 3D.3.23-C; a cópia é idêntica ao resultado).
  - `backend/package.json` — scripts `e2e:teardown`, `e2e:cleanup-legacy`, `e2e:inspect`, `secrets:audit` e dependências `xlsx` e `pg`.
  - `backend/package-lock.json`, `frontend/package-lock.json` — coerentes com os `package.json`.
  - `frontend/package.json` — `@playwright/test` e `playwright` 1.64.1, e `vite-env-injection`/`e2e-guard` no `test`.
  - `frontend/src/services/api.ts` — `configuredApiUrl` exportada com `import.meta.env` literal (exigida por `vite-env-injection.test.mjs`).
  - `frontend/src/vite-env.d.ts` — interface `ImportMetaEnv` (`VITE_*`).
- Origem comprovada: mtimes de 04/11 17:52–22:03, marcadores "3D.3.21-A" no conteúdo, e testes existentes que dependem desse conteúdo. O sentido do conflito foi o inverso do que se supunha: o OneDrive manteve a versão antiga no nome original e renomeou a nova.
- Arquivos do histórico Git (`RELATORIO-ENTREGA-3D.3.15/16.md`): sem divergência relevante.
- Alterações de negócio **ambíguas ou não recuperáveis: nenhuma identificada.** Limite honesto: só é possível detectar perdas que deixem cópia ou teste dependente. Edição pós-HEAD num dos 14 arquivos sem cópia diferente não seria visível.

## 6. Inventário das cópias de conflito (`*-Calil-Notebook.*`)

32 arquivos no total, **nenhum removido, movido ou consolidado**:
- **22 fontes rastreáveis** (não rastreadas pelo Git): 16 idênticas ao HEAD (obsoletas, sem valor adicional); 6 mais novas que o HEAD, **já aproveitadas** (seção 5). Seus originais passaram a ter o mesmo conteúdo.
- **10 em `backend/dist/`** (saída de build, ignorada): descartáveis, a critério do usuário.
- **9 em `backend/node_modules/.prisma/client/`** (artefatos de geração): descartáveis.
- Classificação: legítimas e já recuperadas = 6; versões antigas/duplicadas = 16 + 19 de artefatos; indeterminadas = 0. Remoção exige autorização.

## 7. Alterações ainda não recuperadas

Nenhuma conhecida. Ver o limite descrito na seção 5.

## 8. Resultados backend e frontend

- Backend `vitest run`: **32 arquivos, 687/687 aprovados** (inclui os 9 novos).
- Frontend (`node --test`, 11 arquivos): **99/99 aprovados**.

## 9. Typecheck e build

- Frontend: `tsc --noEmit` exit 0; `vite build` ok (3,4 s).
- Backend: `tsc -p tsconfig.build.json --noEmit` exit 0; `tsc --noEmit` com **2 erros apenas em `tests/scripts/verify-fixtures-rotation.ts`** (arquivo legado não rastreado: `pg` sem tipos e caminho `./src/config/secrets` inexistente). Nenhum script ou documento o referencia, exceto relatórios. Continua impedindo o typecheck limpo; não foi excluído, movido, nem `tsconfig` alterado.

## 10. Resultado integral do dry-run (exit 0)

Inspeção somente leitura prévia (`e2e:inspect`): banco `cardapio_digital_test`, role `cardapio_migrator`, `read_only: on`, 5 migrations concluídas, `legacy_e2e_residue` = admin 1, categoria 1, produto 1, comanda 999999: 1; `fixture_residue` = 0 admins, 0 categorias, 1 comanda em faixa 9; sem outras sessões; sem advisory locks nem transações preparadas.

Dry-run (`cleanup-legacy.ts --scope blocker --expect-invitation 3d3a7928-…bc33 --expect-session 45866608-…da0bad75d25`, sem `--execute`):

```
{"inspection":{"present":{"admin":true,"category":true,"product":true,"comanda":true},
 "counts":{"invitations":1,"sessions":1,"orders":0,"orderItems":0,"history":0},
 "problems":[]},"executed":false,"deleted":{}}
[e2e] dry-run: nada foi apagado. Use --execute para remover.
exit=0
```

Todos os valores conferem com o esperado. O backup (`...pre-cleanup_20261105-130911.dump`) foi apenas lido para recalcular o SHA-256: `5159C9D4…5E1BD7`, **íntegro**.

## 11. Estado do Git

Branch `main`, 0 em stage, nenhum commit. 147 entradas em `git status`: 20 arquivos rastreados modificados (inclui os 6 recuperados e os restaurados que voltaram a coincidir com o HEAD), o restante não rastreado (inclui as 22 cópias de conflito e `verify-fixtures-rotation.ts`).

## 12. Pendências e riscos

1. Cópias de conflito e `verify-fixtures-rotation.ts` aguardam decisão (quarentena/remoção só com autorização).
2. O OneDrive pode repetir o conflito: recomendável pausar a sincronização da pasta durante a execução do E2E e fazer um commit de checkpoint depois da auditoria.
3. Memória livre baixa (~1 GB) para o Playwright; guarda de ≥1,8 GB mantida.
4. `pg` entrou no `package.json` sem `@types/pg`: só o arquivo legado o usa.

## 13. Recomendação de próxima etapa

Auditoria do ChatGPT deste relatório. Se aprovado: você autoriza expressamente `cleanup-legacy --scope blocker --execute` (com `RUSTIKA_E2E_LEGACY_CLEANUP`) usando o backup validado; depois `e2e:inspect` e, só então, guarda de memória e Playwright, em autorizações separadas.

## 14. Parecer final

**3D.3.23-D — CONCLUÍDA.** Causa do `.env` resolvida sem enfraquecer gates; regressão do OneDrive auditada e as 6 perdas comprovadas recuperadas; backend 687/687, frontend 99/99, builds ok; dry-run real aprovado (exit 0). Único bloqueio residual: o arquivo legado que impede o `tsc` limpo (não afeta o E2E). Ambiente pronto para **solicitar** a autorização da limpeza, que não foi executada.
