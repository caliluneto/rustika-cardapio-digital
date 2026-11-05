# Restauração isolada do backup do PostgreSQL Test — 3D.3.10

**Estado: plano preparado, nenhuma restauração executada, nenhum banco criado ou excluído.**

## Dumps disponíveis (corrigido na 3D.3.11/3D.3.12)

A 3D.3.10 registrou o dump como ausente porque procurou o nome errado
(`cardapio_test_pre3d38_…`). Os dois arquivos existem, fora do OneDrive e do repositório:

| Uso | Arquivo em `C:\Users\<USUARIO>\AppData\Local\RustikaBackups\` | SHA-256 |
| --- | --- | --- |
| **Prova de restauração (usar este)** | `cardapio_digital_test_pre-migrations-3d311_20261104-102650Z_1a9636.dump` | `f2304f0ac150218ef6dc36a1cbdc517402180daa8ed73bd949c6d2f05306cadf` |
| Histórico (3D.3.8) | `cardapio_digital_test_pre3d38_20261104-012137.dump` | `1be946052157a2c54b7af979c9c174e0d41d70cfaab9abc9b5de90663f925265` |

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
   conferida separadamente por `docs/sql/verify-test-fixtures.sql` e pelas consultas da 3D.3.9.
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

Isolamento de conexões (3D.3.12): todo banco novo concede `CONNECT`/`TEMP` a `PUBLIC`, ou seja, a
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
- Não substitui a Operação B da 3D.3.9; ele a corrige e a torna executável quando houver dump.
