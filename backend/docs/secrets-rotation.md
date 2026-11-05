# Rotação das credenciais do PostgreSQL — procedimento (3D.3.21-B)

**Estado: preparado, NÃO executado.** Nenhuma senha, role ou ACL foi alterada. Os valores das senhas
nunca aparecem neste documento, nos relatórios nem em log.

## Incidente (sem divulgar valores)

Auditoria de 04/11/2026 (`npm run secrets:audit` + comparação por conteúdo com a pasta de segredos):

| Achado | Detalhe |
| --- | --- |
| Senha **compartilhada por três roles** | `cardapio_dev_app`, `cardapio_test_app` e `cardapio_migrator` usam a **mesma** senha (Dev e Test). Quem obtiver a do runtime obtém a da role dona dos objetos (DDL) |
| Senha **fraca** | 8 caracteres, somente dígitos (10⁸ possibilidades); a do shadow do migrator tem 6 dígitos |
| Inconsistência | `cardapio_migrator` tem uma senha na URL do shadow de Test diferente das demais; ao menos uma não autentica |
| `cardapio_test_fixtures` | senha forte (26 caracteres), mas **vigente e embutida** em arquivos |
| Onde as senhas **vigentes** estão embutidas | 5 scripts não rastreados em `backend/` com a senha de `cardapio_test_fixtures` (`seed_raw.js`, `check_invites.js`, `check_orders.js`, `check_products.js`, `check_sessions.js`) e 4 com a senha compartilhada de `cardapio_dev_app`/`cardapio_test_app`/`cardapio_migrator` (`seed_pg.js`, `db-dumper.js`, `db-check.js`, `check_db.js`). Outros 2 embutem valores que **já não** são os vigentes (`seed_e2e.js`, `check_admin_app.js`) |
| Git | **Nenhuma credencial real em arquivo rastreado nem no histórico de `main`** (os achados rastreados são valores fictícios: `fake`, `disabled`). Sem remoto: nada foi enviado |
| Cópias locais | 71 refs `refs/cline/checkpoints/*` no `.git` local guardam versões desses scripts (objetos de snapshot de arquivos não rastreados) |
| Nuvem | a pasta do projeto está no OneDrive: scripts e `.git` são sincronizados com a conta |
| Relatórios/docs | varredura por conteúdo (513 arquivos, repositório e backups): nenhuma senha vigente em relatório, documento ou dump; só nos 9 scripts acima |

**Roles a rotacionar (todas):** `cardapio_dev_app`, `cardapio_test_app`, `cardapio_migrator`,
`cardapio_test_fixtures`. Recomendação: **antes de qualquer nova execução real**. As senhas embutidas
de `cardapio_migrator` nos scripts não coincidem com a vigente, mas se algum dia foram válidas, trate-as
como comprometidas.

## Alvo da política

Uma senha **distinta por role**, ≥ 16 caracteres (recomendado 32, geradas por CSPRNG), não numérica; a
mesma role com a **mesma** senha em todas as URLs (db e shadow). `npm run secrets:audit` verifica isso e
sai com código 1 se algo falhar.

## Procedimento seguro (executar só com autorização)

Impacto: Dev e Test. Rotacionar `cardapio_migrator` afeta migrations/shadow de ambos; `cardapio_dev_app`
afeta o backend de Dev. Pare backend, frontend, `vitest` e qualquer E2E antes de começar.

1. **Preparação**
   - `npm run secrets:audit` e `npm run e2e:inspect` (somente leitura) e registre o estado.
   - Copie a pasta de segredos (`resolveSecretsDir()`, fora do repositório e do OneDrive) para um
     local também fora do OneDrive: é o seu ponto de retorno.
   - Feche sessões ociosas das roles (`pg_stat_activity`), sem `pg_terminate_backend`.
2. **Gerar a senha nova de uma role** (CSPRNG, sem imprimir; vai para a área de transferência):

   ```powershell
   $bytes = New-Object byte[] 48
   [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
   $pw = ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', '').Substring(0, 32)
   Set-Clipboard -Value $pw
   ```

   Só letras e dígitos: não exige codificação na URL.
3. **Trocar no PostgreSQL com `\password`** (o psql calcula o hash SCRAM no cliente; a senha em texto
   não vai ao servidor nem ao histórico). Conectado como a role administrativa local:

   ```powershell
   & 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -X -h 127.0.0.1 -U postgres -d postgres
   # no prompt do psql:
   #   \password cardapio_test_fixtures      (cole a senha duas vezes)
   ```

4. **Atualizar o arquivo de segredo correspondente** (editor, não por linha de comando) e limpar a
   área de transferência: `Set-Clipboard -Value $null`.
   Fixtures → `fixtures-test.env`; runtime → `app-test.env` / `app-dev.env`; migrator → `migrate-test.env`
   **e** `migrate-dev.env` (as URLs `DATABASE_URL` e `SHADOW_DATABASE_URL` com a mesma senha).
5. **Verificar a role** antes da próxima: `npm run secrets:audit` (política) e um acesso somente leitura
   (`npm run db:migrate:status:test` para o migrator; `npm run e2e:inspect`; subir o backend para as de
   runtime). Só então a próxima role.
6. **Repetir** para as quatro roles, uma por vez. Ao final, `npm run secrets:audit` sem `FAIL`.

### Retorno (rollback)

Se uma role deixar de autenticar: use o backup da pasta de segredos para ler o valor anterior (sem
exibi-lo) e repita o `\password` com ele; nunca crie uma senha provisória fraca.

## Depois da rotação: tratar as cópias embutidas (decisão do usuário)

As senhas embutidas ficam inválidas, mas as cópias continuam sendo ruído e risco de reaparecimento:

- **Scripts soltos** (`backend/check_*.js`, `db-check.js`, `db-dumper.js`, `seed_pg.js`, `seed_e2e.js`,
  `seed_raw.js`): classificação e destino na seção 4 do relatório da 3D.3.21-B. Mover para uma pasta de
  quarentena **fora do repositório e do OneDrive** em vez de apagar; só depois decidir a remoção.
- **Refs do Cline** (`refs/cline/checkpoints/*`, locais): contêm essas versões. Remoção, **somente com
  aprovação**, e depois da rotação:

  ```powershell
  git for-each-ref refs/cline --format='%(refname)' | ForEach-Object { git update-ref -d $_ }
  git reflog expire --expire=now --all
  git gc --prune=now
  ```

  É destrutivo para esses snapshots (não para `main`). Não executar sem autorização.
- **Lixeira do OneDrive:** esvaziar depois de mover os scripts, ou as cópias persistem na nuvem.
- **Nunca** reescrever o histórico de `main` por causa disto: não há credencial real nele.
- Antes do checkpoint Git, excluir esses arquivos da lista (o checkpoint usa lista explícita; o
  `.gitignore` não protege o que já está versionado, e aqui nada está).
