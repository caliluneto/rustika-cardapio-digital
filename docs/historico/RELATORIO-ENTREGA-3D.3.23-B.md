# RÚSTIKA — Etapa 3D.3.23-B
## Preparação final para a limpeza restrita do E2E
Data: 05/11/2026 · **Esta entrega NÃO executa a limpeza.** Escritas no PostgreSQL: nenhuma · Playwright: não iniciado · Arquivos movidos/apagados: nenhum · Senhas/roles/`pg_hba.conf`: intocados · commit/push: nenhum

Escopo (reconfirmado): banco `cardapio_digital_test`; remover **comanda 999999** (`cc000000-0000-4000-8000-000000000999`), **convite** `3d3a7928-328c-47ae-ad47-b8780411bc33` e **sessão** `45866608-27e6-4747-b5a0-8da0bad75d25`; preservar admin, categoria e produto legados, todo o resto, as 5 migrations, Dev, Shadow e a PLATAFORMA_SITES_IA.

## 1. Resultado da inspeção do `cleanup-legacy` (leitura do código real)
A revisão encontrou **uma fragilidade no escopo `blocker` da 3D.3.23-A**: ele apagava sessões "da comanda" e convites "da comanda emitidos pelo admin legado", sem fixar os ids. Se existissem outra sessão ou outro convite, seriam removidos desde que as contagens coincidissem. **Corrigido** nesta entrega (código + testes, sem tocar o banco):

| Verificação pedida | Implementação real | Veredicto |
| --- | --- | --- |
| `--scope blocker` seleciona exatamente os 3 registros | agora **exige** `--expect-invitation <uuid>` e `--expect-session <uuid>` (UUID válido, senão `E2eAbort`); `assertBlockerIds` aborta se a comanda tiver qualquer convite/sessão com id diferente; os `deleteMany` levam `id` exato (+ `invitationId`/`issuedByAdminId`/`comandaId`) e a comanda `id`+`number='999999'` | **confirmado após a correção** |
| `--execute` é necessário para excluir | `cleanLegacy` retorna antes da transação quando `execute=false`; o CLI usa `assertLegacyCleanupGate` (exige `RUSTIKA_E2E_LEGACY_CLEANUP=ERASE_LEGACY_E2E_FIXTURES`) só com `--execute`; sem a flag, apenas `assertE2eGate` | confirmado |
| Banco alvo é obrigatoriamente Test | `assertE2eGate` (`NODE_ENV=test`, `DB_PROFILE=app-test`, sem `DATABASE_URL`/`SHADOW_DATABASE_URL`) + `openIntegrationDatabases`: perfis `app-test`, `fixtures-test`, `migrate-test` da pasta de segredos; o preflight compara `current_database()` das 3 conexões com `cardapio_digital_test`, valida 5 migrations+checksums, ACL efetiva, `pg_hba` (a role de fixtures não alcança outros bancos) e o advisory lock | confirmado |
| Transacional | `db.$transaction(...)` único para todas as exclusões | confirmado |
| Ordem das dependências | histórico → itens → pedidos → **sessões → convites → comanda** (filho antes de pai; FKs `RESTRICT`) | confirmado |
| Verificação de contagem e ids | contagens esperadas vindas da inspeção, comparadas após cada exclusão; ids reconferidos **dentro** da transação (`assertBlockerIds(tx, …)`) | confirmado (reforçado) |
| Qualquer divergência dá ROLLBACK | `throw E2eAbort` dentro do callback do `$transaction` reverte tudo | confirmado |
| Nenhum registro adicional | escopo `blocker` não tem código de exclusão para admin, categoria, produto; nenhuma exclusão sem `id`; teste prova `count ≤ 1` por exclusão e nenhuma das tabelas admin/categoria/produto | confirmado |
| Não afeta Dev/Shadow/outros projetos | só abre `app-test`, `fixtures-test`, `migrate-test` (todos Test); `FORBIDDEN_DATABASE`/`assertTestDatabaseName` rejeitam qualquer outro nome | confirmado |

Testes com banco falso: `tests/e2e-fixtures.test.ts` **83/83** (8 novos para o escopo mínimo: ids exigidos/malformados, id divergente, segunda sessão, dry-run sem escrita, exclusões só por id exato, preservação de tudo fora do escopo). `tsc`: sem erros próprios; só o arquivo da seção 8 falha. Limitação honesta: a corrida entre inspeção e transação é coberta pelas exclusões por id exato e pela reconferência dentro da transação, mas não foi simulada no banco falso.

## 2. Backup novo (`pg_dump`) — comando exato
Autenticação **interativa** (o `-W` força o prompt; a senha não passa por variável, argumento nem log). Role sugerida: `cardapio_migrator` (dona dos objetos, lê tudo; evita usar superusuário). Sem `--create`, para que o dump jamais recrie `cardapio_digital_test` ao ser restaurado. Pasta fora do OneDrive e do repositório; o dump contém hashes de senha/token: trate como confidencial.

```powershell
$ErrorActionPreference = 'Stop'
$pgBin  = 'C:\Program Files\PostgreSQL\18\bin'
$stamp  = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss') + 'Z'
$dump   = "C:\RustikaBackups\cardapio_digital_test_pre-cleanup-3d323_$stamp.dump"
if (Test-Path -LiteralPath $dump) { throw 'Dump já existe: não sobrescrever.' }
& "$pgBin\pg_dump.exe" -h 127.0.0.1 -p 5432 -U cardapio_migrator -W -d cardapio_digital_test -Fc -f $dump
if ($LASTEXITCODE -ne 0) { throw "pg_dump falhou ($LASTEXITCODE)" }
(Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash.ToLower() | Set-Content -Encoding ascii "$dump.sha256"
Get-Item $dump | Select-Object Name, Length
```

## 3. Validação prevista do backup (sem restaurar sobre banco algum)
```powershell
# 1) tamanho > 0 e hash gravado
if ((Get-Item $dump).Length -le 0) { throw 'dump vazio' }
$sha = (Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash.ToLower()
if ($sha -ne (Get-Content "$dump.sha256").Trim()) { throw 'SHA-256 divergente' }
# 2) índice do arquivo: esperado TABLE DATA de 10 tabelas (9 do app + _prisma_migrations)
$toc = & "$pgBin\pg_restore.exe" --list $dump
($toc | Select-String 'TABLE DATA public').Count            # esperado: 10
$toc | Select-String 'TABLE DATA public (_prisma_migrations|comandas|comanda_invitations|comanda_sessions|admins|categories|products)'
# 3) leitura integral do arquivo (decodifica todos os blocos) para stdout; NADA é restaurado
$sql = & "$pgBin\pg_restore.exe" -f - $dump
if ($LASTEXITCODE -ne 0) { throw 'pg_restore (leitura) falhou' }
# 4) o dump contém as 3 linhas a limpar (prova de que o estado pré-limpeza está salvo); só contagens, nada é exibido
foreach ($id in 'cc000000-0000-4000-8000-000000000999','3d3a7928-328c-47ae-ad47-b8780411bc33','45866608-27e6-4747-b5a0-8da0bad75d25') {
  "{0}: {1} ocorrência(s)" -f $id.Substring(0,8), @($sql | Select-String -SimpleMatch $id).Count      # esperado: >= 1 cada
}
Remove-Variable sql
```
Critérios: hash confere, `TABLE DATA` = 10, leitura integral com código 0, os 3 ids presentes. Prova de **restaurabilidade completa** (restaurar num banco descartável novo, `cardapio_restore_check_AAAAMMDD_HHMMSS`, conforme `backend/docs/restore-backup.md`, sem `--create`) exige criar e depois excluir um banco: é **opcional e depende de autorização separada**. Não usar `cardapio_restore_3d316`, que já existe. Backups antigos (`…pre-migrations-3d311…`, `…pre3d38…`) **não** servem: antecedem o resíduo.

## 4. Inspeção antes da limpeza (somente leitura)
Gates: `NODE_ENV=test`, `DB_PROFILE=app-test`, `RUSTIKA_DB_INTEGRATION=1`, `RUSTIKA_DB_INTEGRATION_CONFIRM=WRITE_CARDAPIO_DIGITAL_TEST`, `RUSTIKA_E2E_CONFIRM=RUN_E2E_ON_CARDAPIO_DIGITAL_TEST` (nenhum deles escreve nesta fase).
```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
$env:NODE_ENV='test'; $env:DB_PROFILE='app-test'; $env:RUSTIKA_DB_INTEGRATION='1'
$env:RUSTIKA_DB_INTEGRATION_CONFIRM='WRITE_CARDAPIO_DIGITAL_TEST'; $env:RUSTIKA_E2E_CONFIRM='RUN_E2E_ON_CARDAPIO_DIGITAL_TEST'
npm run e2e:inspect
npm run e2e:cleanup-legacy -- --scope blocker --expect-invitation 3d3a7928-328c-47ae-ad47-b8780411bc33 --expect-session 45866608-27e6-4747-b5a0-8da0bad75d25
```
(Se o `npm` acusar "Could not determine Node.js install directory", use `node node_modules\tsx\dist\cli.mjs scripts\inspect-e2e-state.ts` e `… tests\integration-db\e2e\cleanup-legacy.ts <mesmos argumentos>`.)
**Esperado:** `e2e:inspect`: 5 migrations concluídas; `admins/categories/products/comandas/comanda_invitations/comanda_sessions` = 1 cada; `orders/order_items/order_status_history` = 0; `legacy_e2e_residue` = `{1,1,1,1}`; sem sessões de `test_app`/`test_fixtures`; 0 locks. **Dry-run:** `executed:false`, `present` `{admin:true, category:true, product:true, comanda:true}`, `counts` `{invitations:1, sessions:1, orders:0, orderItems:0, history:0}`, `problems` vazio e nenhuma linha apagada.

## 5. Comando exato de limpeza (NÃO executar sem autorização)
```powershell
$env:RUSTIKA_E2E_LEGACY_CLEANUP='ERASE_LEGACY_E2E_FIXTURES'
npm run e2e:cleanup-legacy -- --scope blocker --execute --expect-invitation 3d3a7928-328c-47ae-ad47-b8780411bc33 --expect-session 45866608-27e6-4747-b5a0-8da0bad75d25
Remove-Item Env:RUSTIKA_E2E_LEGACY_CLEANUP
```
**Esperado:** `executed:true`, `deleted` `{order_status_history:0, order_items:0, orders:0, comanda_sessions:1, comanda_invitations:1, comandas:1}`; nenhuma chave de admin/categoria/produto. Qualquer divergência: erro `E2eAbort`, código de saída 2, nada alterado.

## 6. Verificações pós-limpeza
```powershell
npm run e2e:inspect
Remove-Item Env:NODE_ENV, Env:DB_PROFILE, Env:RUSTIKA_DB_INTEGRATION, Env:RUSTIKA_DB_INTEGRATION_CONFIRM, Env:RUSTIKA_E2E_CONFIRM
```
**Esperado:** `comandas`=0, `comanda_invitations`=0, `comanda_sessions`=0; `admins`=1, `categories`=1, `products`=1; `orders*`=0; `legacy_e2e_residue` `{admin:1, categoria:1, produto:1, comanda_999999:0}`; `fixture_residue.comandas_faixa_9`=0 (colisão eliminada); 5 migrations; sem sessões de roles; 0 locks. Hashes SHA-256 das 5 `migration.sql` inalterados.

## 7. Procedimento de recuperação
- **Falha antes do commit:** reversão automática da transação; confira com `e2e:inspect` (deve repetir o estado da seção 4).
- **Após o commit:** as 3 linhas são sintéticas e recriáveis pelo setup do E2E. Se for preciso o estado exato, extrair do dump novo apenas essas 3 tabelas para um arquivo SQL, **sem aplicar**: `pg_restore --data-only -t comandas -t comanda_invitations -t comanda_sessions -f <arquivo fora do repo> $dump`; reinserir só as 3 linhas, na ordem comanda → convite → sessão, exige autorização à parte.
- **Estado inesperado fora do escopo** (qualquer outra tabela mudou): parar; comparar `e2e:inspect` antes/depois; restaurar o dump apenas num banco de apoio, nunca sobre o Test sem autorização.

## 8. Parecer sobre `backend/tests/scripts/verify-fixtures-rotation.ts`
- Não rastreado; criado em 04/11 às 23:50 no preparo da rotação cancelada.
- **Não é usado:** nenhuma referência em `package.json`, scripts, configs ou testes (a busca só o encontra no relatório 3D.3.23-A). O Vitest só executa `*.test.ts`, que ele não é.
- **Quebra o `tsc --noEmit`** porque `tests/` está no `include` do `tsconfig.json`: importa `pg` (sem tipos) e um caminho inexistente (`./src/config/secrets`). Nunca funcionou como está.
- **Não instalar `@types/pg`** nem corrigir o import: o arquivo é desnecessário.
- **Proposta (não executada):** quarentena fora do repositório e do OneDrive, preservando o conteúdo e conferindo o hash antes de remover o original.
```powershell
$src = 'C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend\tests\scripts\verify-fixtures-rotation.ts'
$dstDir = 'C:\RustikaQuarantine\3d323'; New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
Copy-Item -LiteralPath $src -Destination $dstDir
if ((Get-FileHash $src).Hash -ne (Get-FileHash (Join-Path $dstDir 'verify-fixtures-rotation.ts')).Hash) { throw 'cópia divergente' }
Remove-Item -LiteralPath $src      # só após a cópia conferida e a sua autorização
```
Depois: `tsc --noEmit` deve voltar a 0 erros.

## 9. Memória e Playwright
- O Playwright **só roda depois** da limpeza e com autorização própria. Segurança adicional já existente: com a comanda 999999 presente, o preflight do `globalSetup` aborta por colisão antes de escrever.
- Configuração real (`frontend/playwright.config.ts`): `workers: 1`, `fullyParallel: false`, `retries: 0`, projeto único `chromium` (headless por padrão), um backend (`4100`) e um Vite (`5174`) com `reuseExistingServer:false`; a Vite Dev da 5173 não é usada. Sem Vitest simultâneo.
- Memória livre medida agora: **~975 MB** (total 8 GB) — **insuficiente**. Guarda proposta, a rodar imediatamente antes do Playwright:
```powershell
$free = [int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
if ($free -lt 1800) { throw "Memória livre $free MB < 1800 MB: não iniciar o navegador." }
$busy = Get-NetTCPConnection -State Listen -LocalPort 4100,5174 -ErrorAction SilentlyContinue
if ($busy) { throw 'Porta 4100/5174 ocupada.' }
cd ..\frontend; npx playwright test --workers=1 --project=chromium
```
Fechar aplicações para chegar a ≥ 1,8 GB livres é decisão sua; **nenhuma aplicação de outros projetos será encerrada por mim**.

## 10. Critérios de autorização para executar a limpeza
1. Dump novo gerado e validado (seção 3) por você, com SHA-256 registrado.
2. `e2e:inspect` e o dry-run (seção 4) com exatamente o resultado esperado.
3. Você confirma por escrito os três ids e o banco `cardapio_digital_test`, por exemplo: *"Autorizo o `cleanup-legacy --scope blocker --execute` com os ids informados, no `cardapio_digital_test`."*
4. Autorizações separadas e posteriores: quarentena do arquivo TypeScript, restauração de teste em banco descartável (opcional) e a execução do Playwright.

## 11. Estado do Git
Branch `main`; **0 arquivos em stage**; 119 entradas de status; nenhum commit/push/reset/clean. Alterados nesta etapa: `backend/tests/integration-db/e2e/legacy.ts`, `…/cleanup-legacy.ts`, `backend/tests/e2e-fixtures.test.ts` e este relatório.

**Encerrada. Aguardando autorização expressa; nenhuma etapa seguinte foi iniciada.**
