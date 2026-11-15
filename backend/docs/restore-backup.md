# Restauração isolada do backup do PostgreSQL Test

**Estado: plano preparado, nenhuma restauração executada, nenhum banco criado ou excluído.**

## Dumps disponíveis

A primeira versão do plano registrou o dump como ausente porque procurou o nome errado
(`cardapio_test_pre3d38_…`). Os dois arquivos existem, fora do OneDrive e do repositório:

| Uso | Arquivo em `%LOCALAPPDATA%\RustikaBackups\` | SHA-256 |
| --- | --- | --- |
| **Prova de restauração (usar este)** | `cardapio_digital_test_pre-migrations-3d311_20261104-102650Z_1a9636.dump` | `f2304f0ac150218ef6dc36a1cbdc517402180daa8ed73bd949c6d2f05306cadf` |
| Histórico | `cardapio_digital_test_pre3d38_20261104-012137.dump` | `1be946052157a2c54b7af979c9c174e0d41d70cfaab9abc9b5de90663f925265` |

Ambos: 20 928 bytes, `pg_dump` 18.6, `-Fc --create`, estado anterior às migrations pendentes
(7 tabelas, `_prisma_migrations` com 1 linha, demais tabelas vazias). Conteúdo SQL idêntico entre
eles. **Legíveis não significa restauráveis**: só a execução deste plano prova isso.

Conteúdo esperado após restaurar (para a verificação do passo 4): tabelas `_prisma_migrations`
(1 linha, `20261023000000_initial_schema`, checksum
`1a9cd08b9d49fa9f70eabcceaa4a696f5aee07555f6a88562ec789340f0d3983`), `admins`, `categories`,
`products`, `orders`, `order_items`, `order_status_history` (0 linhas cada) e a sequência
`orders_order_number_seq`; nenhuma tabela `comanda*`.

## Objetivo

Provar que um dump do Test pode ser restaurado em um banco **descartável e isolado**, sem
tocar em `cardapio_digital_dev`, `cardapio_digital_test` ou `cardapio_digital_shadow`.

## Regras de segurança

1. **Nome do destino obrigatório:** `cardapio_restore_check_<AAAAMMDD>_<HHMMSS>`.
   Recusar qualquer nome que não case com `^cardapio_restore_check_[0-9]{8}_[0-9]{6}$`.
2. **Nunca** usar `--create` no `pg_restore`. O dump foi feito com `--create`; usá-lo recriaria
   `cardapio_digital_test` e poderia substituir o banco real.
3. **Nunca** apontar `-d` para Dev, Test, Shadow, `postgres`, `template0`, `template1`, nem para
   os bancos existentes de outras finalidades: `plataforma_sites_ia`, `plataforma_sites_ia_test`
   (outro projeto), `cardapio_restore_precheck`, `rf004_lab_*`. O regex do item 1 já os exclui;
   o passo 1 também confere a lista real do cluster.
4. **Nunca** restaurar sobre banco existente. O `createdb` deve falhar se o destino já existir;
   não use `dropdb` preventivo.
5. **Isolar owner e ACLs:** usar `--no-owner --no-privileges`. O objetivo é validar schema e
   dados, não depender de roles do cluster nem aplicar ACLs do dump. A fidelidade de ACL é
   conferida separadamente por `docs/sql/verify-test-fixtures.sql` e pelas consultas oficiais de verificação.
6. **Transação única:** `--single-transaction --exit-on-error`; qualquer erro aborta e não deixa
   restauração parcial.
7. **Sem credenciais em argumentos, arquivos versionados ou logs.** Usar `pgpass` fora do
   OneDrive ou `PGPASSWORD` temporário; nunca colar senha no chat/relatório.
8. **Registrar stderr** em arquivo fora do repositório; não mascarar erro do `pg_restore`.
9. **Parada obrigatória:** hash divergente, destino existente, aviso de conexão em banco errado,
   erro do `pg_restore`, tabela inesperada, `_prisma_migrations` ausente ou contagem divergente.
10. **Limpeza somente após conferência**, com o nome do banco descartável validado novamente.

## Pré-condições

- Autorização escrita para criar e excluir **um** banco descartável e para ler o dump.
- Binários `psql`, `createdb`, `pg_restore` e `dropdb` 18.6 (mesma versão do dump), ou
  compatibilidade comprovada.
- Role administrativa local com `CREATEDB` (hoje `cardapio_migrator` tem `rolcreatedb = false`;
  usar a role administrativa autorizada, não elevar o migrator).
- Dump novo ou cópia localizada, com SHA-256 conferido e registrado.
- Espaço livre e janela sem outras operações no cluster.
- `pg_hba.conf` permitindo a conexão administrativa local; nenhuma alteração de `pg_hba` nesta
  entrega.

## Sequência preparada (não executar sem autorização)

### 0. Conferir o dump

```powershell
$dump = "$env:LOCALAPPDATA\RustikaBackups\cardapio_digital_test_pre-migrations-3d311_20261104-102650Z_1a9636.dump"
$expected = 'f2304f0ac150218ef6dc36a1cbdc517402180daa8ed73bd949c6d2f05306cadf'
if (-not (Test-Path -LiteralPath $dump)) { throw 'Dump ausente.' }
if ((Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash.ToLower() -ne $expected) { throw 'SHA-256 divergente: parar.' }
& 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe' --list $dump | Select-Object -First 12
```

### 1. Conferir que o destino não existe e que o nome é descartável

```powershell
$suite = Get-Date -Format 'yyyyMMdd_HHmmss'
$target = "cardapio_restore_check_$suite"
if ($target -notmatch '^cardapio_restore_check_[0-9]{8}_[0-9]{6}$') { throw 'Nome inválido.' }
if ($target -in @('cardapio_digital_dev','cardapio_digital_test','cardapio_digital_shadow','postgres','template0','template1')) { throw 'Destino proibido.' }
psql -X -h 127.0.0.1 -p 5432 -U <role_administrativa> -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$target'"
# Registro do cluster ANTES (para provar que nada além do destino mudou):
psql -X -h 127.0.0.1 -p 5432 -U <role_administrativa> -d postgres -Atc "SELECT datname FROM pg_database ORDER BY 1" | Set-Content "$env:TEMP\rustika_restore_${suite}_antes.txt"
```

O comando de existência deve retornar vazio. Se retornar `1`, escolher outro timestamp; **não**
apagar o banco existente.

### 2. Criar o banco descartável

```powershell
createdb -h 127.0.0.1 -p 5432 -U <role_administrativa> -T template0 -E UTF8 $target
```

Não usar `-O cardapio_migrator`: a restauração será `--no-owner`; o owner do destino é a role
administrativa. Isso isola o teste das roles do cluster.

Isolamento de conexões: todo banco novo concede `CONNECT`/`TEMP` a `PUBLIC`, ou seja, a
qualquer role do cluster (inclusive as da PLATAFORMA_SITES_IA). Fechar imediatamente, só no
banco descartável:

```powershell
psql -X -h 127.0.0.1 -p 5432 -U <role_administrativa> -d postgres -v ON_ERROR_STOP=1 `
  -c "REVOKE ALL ON DATABASE $target FROM PUBLIC"
```

### 3. Restaurar sem `--create`, sem owners e sem ACLs

```powershell
$log = "$env:TEMP\rustika_restore_$suite.log"
pg_restore -h 127.0.0.1 -p 5432 -U <role_administrativa> -d $target `
  --no-owner --no-privileges --single-transaction --exit-on-error `
  --verbose $dump 2>&1 | Tee-Object -FilePath $log
if ($LASTEXITCODE -ne 0) { throw "pg_restore falhou; ver $log" }
```

O dump contém a entrada `DATABASE` (feito com `--create`), mas **sem** a opção `--create` o
`pg_restore` não a emite: restaura só os objetos dentro do banco `-d`. (Não existe opção
`--no-create`; a proteção é simplesmente não passar `--create`.) Com `--no-privileges`, as
entradas `ACL`/`DEFAULT ACL` e os GRANTs de banco também ficam de fora. Qualquer erro no log é
condição de parada.

### 4. Validar schema, dados e migrations

Executar **somente** no banco descartável:

```powershell
psql -X -h 127.0.0.1 -p 5432 -U <role_administrativa> -d $target `
  -v ON_ERROR_STOP=1 -f docs/sql/verify-restore.sql
```

Conferir:

- `current_database()` é o destino descartável, nunca Dev/Test/Shadow;
- as 7 tabelas e a sequência existem (o dump é anterior às migrations 20261027/31/1102/1104);
- `_prisma_migrations` contém a linha `20261023000000_initial_schema` com o checksum esperado;
- contagens de `COPY`/linhas compatíveis com o dump (comparar com o `pg_restore --list`);
- nenhuma constraint ausente ou inválida;
- nenhuma role do dump foi criada (roles são do cluster, não do dump).

A restauração com `--no-privileges` **não prova** ACLs. A prova de ACL exige o banco migrado
real e as consultas de `docs/integration-db.md`; não confunda as duas coisas.

### 5. Limpeza segura

Somente depois de registrar o resultado e confirmar que o nome é o descartável:

```powershell
if ($target -notmatch '^cardapio_restore_check_[0-9]{8}_[0-9]{6}$') { throw 'Nome inválido.' }
dropdb -h 127.0.0.1 -p 5432 -U <role_administrativa> $target
psql -X -h 127.0.0.1 -p 5432 -U <role_administrativa> -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$target'"
```

O último comando deve retornar vazio. Se `dropdb` falhar por conexões abertas, **não** use
`pg_terminate_backend` sem autorização; encerre a sessão que estiver usando o banco.

Prova de preservação do cluster: a lista `SELECT datname FROM pg_database ORDER BY 1` depois da
limpeza deve ser igual ao arquivo `_antes.txt` do passo 1. O banco
`cardapio_restore_precheck` (de 26/10, dono `postgres`) é preexistente e **não** é alvo de limpeza.

## Recuperação de falhas

| Falha | Ação |
| --- | --- |
| Dump ausente ou hash divergente | Parar. Gerar/localizar novo dump; não restaurar. |
| Destino já existe | Escolher outro timestamp; nunca apagar o existente. |
| `createdb` falha por permissão | Usar a role administrativa autorizada; não elevar `cardapio_migrator`. |
| `pg_restore` falha | `--single-transaction` reverte; guardar o log; não repetir sobre o mesmo destino sem recriar. |
| Validação encontra tabela/contagem errada | Não promover o banco; investigar o dump; manter o destino para diagnóstico ou remover após registrar. |
| `dropdb` falha | Encerrar a sessão concorrente; não usar `--force` sem autorização. |

## O que este plano não faz

- Não executa `pg_restore`, `createdb` ou `dropdb`.
- Não cria role, não altera ACL e não aplica migration.
- Não declara o dump restaurável antes da execução completa dos passos 0 a 5.
- Não substitui a Operação B original; corrige o plano e o torna executável quando houver dump.

## RF006 — backup integral do Dev antes de `migrate deploy`

**Atualização em 14/11/2026:** a RF006 foi aplicada e validada no Dev. O backup real gerado antes da
migration é `cardapio_digital_dev_pre-rf006_20261114-021344Z.dump`, com 47.535 bytes, SHA-256
`12b97471552173e3bd6291585dd93d497393c700e63c2ef5222cb4ef75c8ee96` e TOC de 7.220 bytes, em
`%LOCALAPPDATA%\RustikaBackups`. Checksum e TOC foram verificados; a restauração integral ainda **não** foi
comprovada. As seções abaixo permanecem como procedimento e registro histórico do estado de 12/11/2026; o arquivo
de 0 byte citado não foi usado.

**Estado em 12/11/2026 (histórico): procedimento preparado; nenhum `pg_dump`, restore, migration ou SQL de
escrita foi executado por esta preparação.** O backup é uma condição de parada obrigatória para
uma futura execução autorizada da RF006. Ele deve preservar o banco inteiro, incluindo
`admins`, `categories`, `products`, `orders`, `order_items`, o histórico de status, comandas,
sequências, constraints e `_prisma_migrations`.

Na inspeção somente leitura desta preparação, o Dev continha 1 administrador, 168 produtos,
1 pedido e 1 item de pedido. Esses números são apenas evidência datada: o manifesto do backup
deve registrar novamente as contagens no momento da janela, sem substituir dados atuais por
esses valores.

**Estado real verificado em 12/11/2026 (superado em 14/11/2026):** identidade confirmada em
`cardapio_digital_dev` / `cardapio_migrator` / `127.0.0.1:5432` / PostgreSQL 18.6, sem SSL e sem
sinal de Neon/pooler; **4 das 7 migrations históricas aplicadas**. Faltam
`20261104000000_runtime_least_privilege`, `20261105000000_order_status_update_privilege` e
`20261106000000_product_availability_update_privilege`; a RF006 estava pendente. O wrapper
`migrate-dev` exige as sete antes do deploy, portanto a RF006 não podia ser aplicada no estado daquele dia.
Na FK `order_items.product_id -> products.id` há 1 item vinculado, 0 órfãos e
`ON DELETE RESTRICT` confirmado. O arquivo `backup_cardapio_digital_dev_pre_migration.backup`
encontrado na raiz tem **0 byte** e não é um backup válido; não use esse arquivo como ponto de
retorno.

### 0. Pré-requisito de baseline

Este procedimento pressupõe as sete migrations históricas aplicadas. No estado de 12/11/2026 (4/7), era
necessário primeiro aplicar as três pendentes com autorização e gerar um novo backup; sem isso o
passo 2 falha por desenho e o `migrate deploy` da RF006 permanecia bloqueado.

### Condições de parada

- origem diferente de `cardapio_digital_dev` / `cardapio_migrator` / `127.0.0.1:5432`;
- aplicação ainda escrevendo, sessão inesperada ou lock aguardando;
- histórico diferente das sete migrations anteriores, concluídas, não revertidas e com os
  checksums de `scripts/bootstrap/expectedMigrations.ts`;
- RF006 já aplicada, migration desconhecida ou checksum do disco divergente;
- `pg_dump` com código diferente de zero, dump vazio, SHA-256 ausente ou TOC sem qualquer uma
  das tabelas de dados obrigatórias;
- tentativa de usar `--create` ou de restaurar sobre Dev, Test ou Shadow.

### 1. Preparar destino e credencial fora do repositório

Usar um `PGPASSFILE` protegido fora do OneDrive. Não colocar senha em argumento, variável
persistente, log ou documentação.

```powershell
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmssZ')
$backupRoot = Join-Path $env:LOCALAPPDATA 'RustikaBackups'
$dump = Join-Path $backupRoot "cardapio_digital_dev_pre-rf006_$stamp.dump"
$hashFile = "$dump.sha256"
$tocFile = "$dump.toc.txt"
$manifestFile = "$dump.manifest.json"
$logFile = "$dump.pg_dump.log"
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'

if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) { throw 'Diretório de backup ausente.' }
if (-not $env:PGPASSFILE -or -not (Test-Path -LiteralPath $env:PGPASSFILE -PathType Leaf)) { throw 'PGPASSFILE protegido ausente.' }
if (Test-Path -LiteralPath $dump) { throw 'Destino do dump já existe; não sobrescrever.' }
```

### 2. Registrar identidade, histórico e contagens em modo somente leitura

Parar a aplicação antes da janela. As consultas abaixo não alteram o banco. O resultado deve
ser guardado fora do repositório e incorporado ao manifesto junto do hash do dump.

```powershell
$psql = Join-Path $pgBin 'psql.exe'
$identity = & $psql -X -w -h 127.0.0.1 -p 5432 -U cardapio_migrator -d cardapio_digital_dev `
  -v ON_ERROR_STOP=1 -At -F '|' -c "SELECT current_database(), current_user, session_user, host(inet_server_addr()), inet_server_port(), host(inet_client_addr());"
if ($LASTEXITCODE -ne 0 -or $identity -ne 'cardapio_digital_dev|cardapio_migrator|cardapio_migrator|127.0.0.1|5432|127.0.0.1') { throw 'Identidade PostgreSQL recusada.' }

$migrations = & $psql -X -w -h 127.0.0.1 -p 5432 -U cardapio_migrator -d cardapio_digital_dev `
  -v ON_ERROR_STOP=1 -At -F '|' -c "SELECT migration_name, checksum, finished_at IS NOT NULL, rolled_back_at IS NOT NULL FROM public._prisma_migrations ORDER BY started_at, migration_name;"
if ($LASTEXITCODE -ne 0 -or $migrations.Count -ne 7) { throw 'Histórico não contém exatamente as sete migrations anteriores.' }

$countsJson = & $psql -X -w -h 127.0.0.1 -p 5432 -U cardapio_migrator -d cardapio_digital_dev `
  -v ON_ERROR_STOP=1 -At -c "SELECT json_build_object('admins',(SELECT count(*) FROM public.admins),'categories',(SELECT count(*) FROM public.categories),'products',(SELECT count(*) FROM public.products),'orders',(SELECT count(*) FROM public.orders),'order_items',(SELECT count(*) FROM public.order_items),'order_status_history',(SELECT count(*) FROM public.order_status_history),'comandas',(SELECT count(*) FROM public.comandas));"
if ($LASTEXITCODE -ne 0 -or -not $countsJson) { throw 'Não foi possível registrar as contagens.' }

$activity = & $psql -X -w -h 127.0.0.1 -p 5432 -U cardapio_migrator -d cardapio_digital_dev `
  -v ON_ERROR_STOP=1 -At -c "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid(); SELECT count(*) FROM pg_locks WHERE NOT granted;"
if ($LASTEXITCODE -ne 0 -or ($activity | Where-Object { $_ -ne '0' })) { throw 'Sessão concorrente ou lock aguardando; parar.' }
```

Antes de continuar, comparar cada linha de `$migrations` com
`scripts/bootstrap/expectedMigrations.ts`; nome, ordem e SHA-256 precisam ser idênticos. O teste
`tests/scripts/migration-integrity.test.ts` valida os mesmos sete checksums no disco e fixa
separadamente o checksum da RF006 pendente.

### 3. Gerar o dump integral e verificá-lo sem restaurar

Não usar filtros `--table` ou `--data-only`: o objetivo é preservar schema e todos os dados.
`--serializable-deferrable` obtém um snapshot consistente e deve falhar, não ser removido, se a
janela não puder fornecer uma fotografia segura.

```powershell
$pgDump = Join-Path $pgBin 'pg_dump.exe'
$pgRestore = Join-Path $pgBin 'pg_restore.exe'
& $pgDump -w -h 127.0.0.1 -p 5432 -U cardapio_migrator -d cardapio_digital_dev `
  --format=custom --compress=9 --serializable-deferrable --lock-wait-timeout=10s `
  --verbose --file=$dump 2> $logFile
if ($LASTEXITCODE -ne 0) { throw "pg_dump falhou; consultar $logFile" }
if (-not (Test-Path -LiteralPath $dump -PathType Leaf) -or (Get-Item -LiteralPath $dump).Length -le 0) { throw 'Dump ausente ou vazio.' }

$hash = (Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($dump))" | Set-Content -LiteralPath $hashFile -Encoding ascii
$toc = & $pgRestore --list $dump
if ($LASTEXITCODE -ne 0 -or -not $toc) { throw 'pg_restore --list falhou.' }
$toc | Set-Content -LiteralPath $tocFile -Encoding utf8
foreach ($required in @('TABLE DATA public admins','TABLE DATA public products','TABLE DATA public orders','TABLE DATA public order_items','TABLE DATA public _prisma_migrations')) {
  if (-not ($toc | Select-String -SimpleMatch $required)) { throw "TOC não preserva $required" }
}

[ordered]@{
  source = 'cardapio_digital_dev@127.0.0.1:5432'
  role = 'cardapio_migrator'
  createdAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  dump = [IO.Path]::GetFileName($dump)
  sha256 = $hash
  migrations = @($migrations)
  counts = ($countsJson | ConvertFrom-Json)
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestFile -Encoding utf8
```

### 4. Prova de restauração antes da migration

Hash e TOC provam integridade de arquivo e presença lógica, mas não a restauração. Antes de
autorizar a RF006, restaurar esse dump em `cardapio_restore_check_<AAAAMMDD>_<HHMMSS>` seguindo
os passos 1 a 5 deste documento, sempre com `--no-owner --no-privileges`, sem `--create` e
nunca sobre Dev/Test/Shadow. No banco descartável:

- repetir as contagens do manifesto para `admins`, `products`, `orders`, `order_items` e tabelas
  relacionadas; todas devem ser idênticas;
- comparar as sete linhas completas de `_prisma_migrations` com o manifesto;
- executar `docs/sql/verify-restore.sql` e registrar o resultado;
- manter dump, `.sha256`, TOC, manifesto e logs juntos fora do repositório.

Sem essa restauração isolada bem-sucedida, o backup continua **não comprovado** e `migrate
deploy` permanece bloqueado.
