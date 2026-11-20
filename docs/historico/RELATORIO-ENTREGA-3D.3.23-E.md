# RELATÓRIO DE ENTREGA — 3D.3.23-E

Execução autorizada da limpeza restrita (`--scope blocker`) e validação pós-operação.

## 1. Data e horário

05/11/2026, fuso -03:00. Backup e arquivos críticos verificados às 10:51; preflight 10:51:54; dry-run 10:52:05; **execução 10:52:22–10:52:24**; validação 10:52:35.

## 2. Banco e role

Banco `cardapio_digital_test` em 127.0.0.1, PostgreSQL 18.6. Escrita pela role de fixtures do projeto (via `openIntegrationDatabases`, que valida a identidade); leituras pela role `cardapio_migrator` em transação `READ ONLY`. Nenhuma URL ou senha registrada.

## 3. Backup antes/depois

`C:\RustikaBackups\TestDB_Secure\cardapio_digital_test_pre-cleanup_20261105-130911.dump`
- Antes e depois: 37.910 bytes, SHA-256 `5159C9D4…5E1BD7` **idêntico ao esperado** nas duas medições; `pg_restore --list` exit 0 (10 entradas TABLE DATA) antes; exit 0 depois.
- ACL da pasta `TestDB_Secure`: herança desativada; apenas SISTEMA, Administradores e o usuário local (FullControl).
- Não restaurado, movido, sobrescrito ou apagado.

## 4. Preflight (somente leitura)

- Identidade: `cardapio_digital_test`, 127.0.0.1, transação read-only.
- Migrations: 5/5 finalizadas, 0 revertidas.
- Sem outras sessões, sem advisory locks, sem transações preparadas.
- Comanda `cc000000-…0999` / número `999999`: exatamente 1 (status OPEN).
- Convite `3d3a7928-…bc33`: 1, da comanda correta e emitido pelo administrador legado `ca000000-…0000`.
- Sessão `45866608-…da0bad75d25`: 1, da comanda e do convite corretos.
- Convites ligados à comanda/admin: 1; sessões ligadas à comanda/convite: 1; pedidos da comanda: 0 (itens 0, histórico 0).
- Administrador, categoria e produto legados presentes.
- Arquivos críticos: `gate.ts`, `legacy.ts`, `launch-env.ts`, `cleanup-legacy.ts`, `databases.ts`, `preflight.ts`, `prisma.ts`, `env.ts` com data de modificação anterior ao dry-run aprovado da 3D.3.23-D (nenhum alterado depois); `.trim()` de `NODE_ENV`, `createPrismaRuntime`, scripts `e2e:*` e `guardedLaunch` presentes; nenhuma nova cópia de conflito do OneDrive.

## 5. Dry-run imediatamente anterior (10:52:05)

Exit 0; `problems: []`; `executed: false`; `deleted: {}`; comanda presente; 1 convite; 1 sessão; 0 pedidos, itens e histórico.

## 6. Comando executado

Em `backend/`, com `NODE_ENV=test`, `DB_PROFILE=app-test`, `RUSTIKA_DB_INTEGRATION=1`, as três confirmações do projeto (`RUSTIKA_DB_INTEGRATION_CONFIRM`, `RUSTIKA_E2E_CONFIRM`, `RUSTIKA_E2E_LEGACY_CLEANUP`) apenas nessa execução, e sem `DATABASE_URL`/`SHADOW_DATABASE_URL`:

`node node_modules/tsx/dist/cli.mjs tests/integration-db/e2e/cleanup-legacy.ts --scope blocker --execute --expect-invitation 3d3a7928-328c-47ae-ad47-b8780411bc33 --expect-session 45866608-27e6-4747-b5a0-8da0bad75d25`

Uma única tentativa. Sem SQL manual, sem escopo `full`, sem alteração de código.

## 7. Código de saída

**0.**

## 8. Quantidades excluídas

`{"order_status_history":0,"order_items":0,"orders":0,"comanda_sessions":1,"comanda_invitations":1,"comandas":1}` — exatamente 3 registros, conforme o autorizado. `executed: true`.

## 9. Validação pós-execução (leitura, 10:52:35)

| Tabela | Esperado | Obtido |
|---|---:|---:|
| admins | 1 | 1 |
| categories | 1 | 1 |
| products | 1 | 1 |
| comandas | 0 | 0 |
| comanda_invitations | 0 | 0 |
| comanda_sessions | 0 | 0 |
| orders | 0 | 0 |
| order_items | 0 | 0 |
| order_status_history | 0 | 0 |
| _prisma_migrations | 5 | 5 |

Os três UUIDs e o número `999999` não existem mais (consultas por id e por número retornam vazio). `e2e:inspect`: `comanda_999999 = 0`, `comandas_faixa_9 = 0`, fixtures residuais 0, sem sessões concorrentes nem locks. O preflight do E2E real deixou de ter a colisão conhecida.

## 10. Registros preservados

Administrador `ca000000-…0000` (`e2e@rustika.local`), categoria `cc000000-…0000` e produto `cc000000-…0001` presentes (1/1/1). Nenhum outro registro foi alterado (contagens iguais às anteriores nas demais tabelas).

## 11. Migrations

5 finalizadas, 0 revertidas, nenhuma reexecutada.

## 12. Nenhum outro banco modificado

Contadores do PostgreSQL (`pg_stat_database`) após a operação: `cardapio_digital_dev`, `cardapio_digital_shadow`, `cardapio_restore_3d316` e `cardapio_restore_precheck` com 0 transações, 0 inserções, 0 atualizações, 0 exclusões. `cardapio_digital_test`: 0 inserções, 0 atualizações e **3 exclusões** (as três linhas autorizadas). Nenhum acesso a PLATAFORMA_SITES_IA.

## 13. Erros ou divergências

Nenhum. A exclusão ocorreu e foi confirmada por contagens reais, não só pelo exit code.

## 14. Estado do Git

Branch `main`, 0 em stage, nenhum commit/push/reset/clean. 148 entradas em `git status` (esta etapa só adicionou este relatório). Nenhum arquivo do projeto foi alterado nesta etapa.

## 15. Pendências técnicas

1. Cópias de conflito `*-Calil-Notebook.*` (22 fontes, 10 em `dist`, 9 em `.prisma`) e `verify-fixtures-rotation.ts` (único impedimento do `tsc --noEmit` limpo do backend): aguardam decisão; nada feito.
2. Risco de novo conflito do OneDrive: recomendável pausar a sincronização durante o E2E e fazer checkpoint em Git após a auditoria.
3. Memória livre baixa (~1 GB) para o Playwright; guarda de ≥1,8 GB mantida.
4. Playwright E2E real continua não autorizado; depende de autorização específica e da guarda de memória.

## 16. Parecer final

**3D.3.23-E — CONCLUÍDA COM SUCESSO.** Verificações prévias e dry-run aprovados; execução real com exit 0 e rollback não necessário; exatamente 3 registros removidos; administrador, categoria, produto e 5 migrations intactos; backup íntegro antes e depois; nenhum outro banco alterado. Playwright não foi iniciado.
