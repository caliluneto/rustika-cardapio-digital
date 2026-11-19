# RÚSTIKA — Relatório da Entrega 3D.3.22-C
## Rotação Controlada de Credenciais PostgreSQL

**Parecer final: CANCELADA POR DECISÃO DO USUÁRIO — CREDENCIAIS ATUAIS PRESERVADAS.**

Atualizado em 05/11/2026. A versão anterior deste relatório (04/11) registrava a etapa como "bloqueada,
aguardando procedimento manual". O usuário decidiu **manter todas as senhas atuais**. Isto não significa que
as credenciais foram rotacionadas nem que os riscos identificados desapareceram (seção 6).

## 1. Pré-voo realizado
- Cluster PostgreSQL **18.6** em `127.0.0.1:5432`; as quatro roles existem (`cardapio_dev_app`, `cardapio_test_app`, `cardapio_migrator`, `cardapio_test_fixtures`).
- `_prisma_migrations` do Test: **5 migrations concluídas**, nenhuma revertida (reconfirmado em 05/11 por consulta somente leitura).
- Permissões da pasta de segredos (`%LOCALAPPDATA%\CardapioDigital\secrets`, fora do repositório e do OneDrive): Administradores, SYSTEM e o usuário atual.
- Isolamento da 3D.3.22-B (HBA) preservado; nenhuma ACL de banco alterada.
- A rotação exigiria o `\password` interativo como `postgres`; o agente não pode fornecer essa senha sem expô-la. Um procedimento assistido manual foi preparado e **não foi executado**.

## 2. Backup dos perfis
Existente e **preservado** em `C:\RustikaBackups\secrets_backup_3D.3.22-C`. Nenhuma cópia nova de credencial foi criada nesta etapa; nenhum backup foi apagado.

## 3. Rotação não executada
Nenhum `ALTER ROLE`, nenhum `\password`, nenhuma senha gerada, nenhum `.env` de credenciais modificado, nenhum `pg_hba.conf` tocado. Evidências de 05/11: os cinco arquivos de segredos não ganharam `.new` nem `.pre-rotation`, e o `fixtures-test.env` mantém a data de modificação de 04/11 16:10 (as demais, de 24–25/10).

## 4. Decisão explícita do usuário
Mensagem de 05/11/2026: "O usuário decidiu manter todas as senhas atuais". Consequências aplicadas:
- A rotação deixa de ser pré-requisito do E2E (`backend/docs/e2e-real.md`, pré-condição 1, ajustada; nenhum código dependia dela).
- `backend/docs/secrets-rotation.md` e o script `npm run secrets:audit` permanecem como referência; nenhuma nova proposta de rotação será feita sem pedido do usuário.

## 5. Estado verificado após a decisão
- Nenhuma senha aparece neste relatório. Consultas de 05/11 omitiram colunas de hash/token.
- Nenhuma alteração de banco ou de roles nesta etapa: apenas transações `READ ONLY`.
- Git (`main`): **0 arquivos em stage**, nenhum commit/push/reset/clean; 117 entradas de status (20 modificadas, 97 não rastreadas).

## 6. Riscos residuais (aceitos, não eliminados)
| Risco | Detalhe (sem valores) |
| --- | --- |
| Senha compartilhada | `cardapio_dev_app`, `cardapio_test_app` e `cardapio_migrator` usam a **mesma** senha; o vazamento do runtime entrega a role dona dos objetos (DDL) |
| Senha fraca | 8 dígitos numéricos (6 no shadow do migrator) |
| Inconsistência | senha do migrator diferente entre URLs (db × shadow) |
| Cópias embutidas | 11 scripts soltos em `backend/` (não rastreados) com senhas vigentes ou antigas: `seed_raw.js`, `check_invites.js`, `check_orders.js`, `check_products.js`, `check_sessions.js` (fixtures); `seed_pg.js`, `db-dumper.js`, `db-check.js`, `check_db.js` (compartilhada); `seed_e2e.js`, `check_admin_app.js` (valores já não vigentes) |
| Superfície local | 71 refs `refs/cline/checkpoints/*` guardam versões desses scripts; a pasta do projeto e o `.git` sincronizam com o OneDrive |
| Git | nenhuma credencial real em arquivo rastreado nem no histórico de `main` |
Mitigações vigentes: HBA da 3D.3.22-B (loopback, roles por banco; fixtures com `CONNECTION LIMIT 2`), segredos fora do repo/OneDrive, `redactSecrets`. Recomendação não vinculante: **não incluir os 11 scripts** em nenhum checkpoint Git (lista explícita).

## 7. Próxima fase
**Autorizada apenas para análise** (preparação E2E somente leitura): `RELATORIO-ENTREGA-3D.3.23-PREP-E2E.md`.

**3D.3.22-C — CANCELADA POR DECISÃO DO USUÁRIO — CREDENCIAIS ATUAIS PRESERVADAS.**
