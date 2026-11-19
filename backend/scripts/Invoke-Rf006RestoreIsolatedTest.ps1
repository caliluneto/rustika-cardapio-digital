# Invoke-Rf006RestoreIsolatedTest.ps1
#
# Restauracao isolada do backup pre-RF006, para provar restaurabilidade antes de
# autorizar a migration 20261110000000_rf006_product_crud_privilege.
#
# NAO contem credenciais. A senha administrativa (role com CREATEDB, ex.: postgres)
# e pedida de forma interativa (Read-Host -AsSecureString) e nunca gravada em disco,
# log ou saida. A credencial de cardapio_migrator e lida do arquivo ja existente
# %LOCALAPPDATA%\CardapioDigital\secrets\migrate-dev.env (fora do repositorio/OneDrive).
#
# Rode isto manualmente, numa janela PowerShell interativa sua. Este arquivo nao se
# autoexecuta e nao e chamado por nenhum outro script do projeto.
#
# Compatibilidade: Windows PowerShell 5.1 (sem operador ternario, sem null-coalescing,
# sem splat de nomes com caracteres especiais).

$ErrorActionPreference = 'Stop'

$expectedHost = '127.0.0.1'
$expectedPort = 5432
$pgBin     = 'C:\Program Files\PostgreSQL\18\bin'
$psql      = Join-Path $pgBin 'psql.exe'
$pgRestore = Join-Path $pgBin 'pg_restore.exe'
$createdb  = Join-Path $pgBin 'createdb.exe'
$dropdb    = Join-Path $pgBin 'dropdb.exe'

# Caminhos absolutos derivados da localizacao deste script (backend/scripts/),
# nunca da pasta atual de trabalho.
$scriptDir   = $PSScriptRoot
$backendRoot = Split-Path -Parent $scriptDir
$verifySql   = Join-Path $backendRoot 'docs\sql\verify-restore.sql'
if (-not (Test-Path -LiteralPath $verifySql -PathType Leaf)) {
  throw "FALHA: verify-restore.sql ausente em $verifySql"
}

$secretsDir    = Join-Path $env:LOCALAPPDATA 'CardapioDigital\secrets'
$migrateDevEnv = Join-Path $secretsDir 'migrate-dev.env'
if (-not (Test-Path -LiteralPath $migrateDevEnv -PathType Leaf)) {
  throw "FALHA: credencial migrate-dev ausente em $migrateDevEnv"
}

$backupRoot   = Join-Path $env:LOCALAPPDATA 'RustikaBackups'
$dump         = Join-Path $backupRoot 'cardapio_digital_dev_pre-rf006_20261114-021344Z.dump'
$expectedHash = '12b97471552173e3bd6291585dd93d497393c700e63c2ef5222cb4ef75c8ee96'

# Nome do banco descartavel: gerado internamente pelo script, nunca por parametro
# externo. Este script deliberadamente nao declara param() para escolha de alvo.
$protegidos = @('cardapio_digital_dev', 'cardapio_digital_test', 'cardapio_digital_shadow')
$stamp      = (Get-Date).ToString('yyyyMMdd_HHmmss')
$restoreDb  = "cardapio_restore_check_$stamp"
$evidence   = Join-Path $backupRoot ($restoreDb + '.restore-evidence.log')

function Write-Evidence {
  param([string]$Linha)
  $Linha | Tee-Object -FilePath $evidence -Append
}

function Assert-DestinoSeguro {
  param([string]$Nome)
  if ($Nome -ne $restoreDb) { throw "FALHA: divergencia de alvo ($Nome != $restoreDb)." }
  if ($Nome -notmatch '^cardapio_restore_check_\d{8}_\d{6}$') { throw "FALHA: nome fora do padrao: $Nome" }
  if ($protegidos -contains $Nome) { throw "FALHA: alvo proibido: $Nome" }
}

function Assert-PropriedadeDb {
  param([string]$Nome, [string]$HostName, [int]$Port, [string]$UserName, [string]$EsperadoOwner)
  $row = & $psql -h $HostName -p $Port -U $UserName -d postgres -t -A -c `
    "select datname||'|'||pg_get_userbyid(datdba) from pg_database where datname = '$Nome';"
  if ($LASTEXITCODE -ne 0) { throw 'FALHA: consulta de propriedade do banco.' }
  if (-not $row) { throw "FALHA: banco nao encontrado para verificar propriedade: $Nome" }
  $parts = $row -split '\|', 2
  if ($parts[0] -ne $Nome) { throw "FALHA: nome retornado diverge: $($parts[0])" }
  if ($parts[1] -ne $EsperadoOwner) {
    throw "FALHA: owner inesperado de $Nome : $($parts[1]) (esperado $EsperadoOwner)"
  }
}

$criado   = $false
$sucesso  = $false

try {
  # Verificar SHA-256 do backup antes de qualquer operacao.
  if (-not (Test-Path -LiteralPath $dump -PathType Leaf)) { throw 'FALHA: dump ausente.' }
  $actualHash = (Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) {
    throw 'FALHA: SHA-256 divergente do esperado. Abortando sem tocar em nenhum banco.'
  }
  Write-Evidence 'OK: backup integro (SHA-256 confere).'

  Assert-DestinoSeguro $restoreDb
  Write-Evidence "OK: alvo descartavel definido: $restoreDb"

  # ===== Fase administrativa (postgres), exclusivamente para o createdb =====
  $adminUser  = Read-Host -Prompt 'Role com CREATEDB (ex.: postgres)'
  $securePass = Read-Host -Prompt "Senha de $adminUser (nao sera exibida nem salva)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePass)
  $adminPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

  $env:PGPASSWORD = $adminPass
  try {
    $identity = & $psql -h $expectedHost -p $expectedPort -U $adminUser -d postgres -t -A -c `
      "select current_setting('server_version_num')||'|'||inet_server_addr()::text||'|'||inet_server_port()::text;"
    if ($LASTEXITCODE -ne 0) { throw 'FALHA: autenticacao ou conexao administrativa.' }
    if ($identity -notmatch '\|127\.0\.0\.1\|5432$') { throw "FALHA: identidade de servidor inesperada: $identity" }
    Write-Evidence "OK: identidade do servidor confirmada: $identity"

    $exists = & $psql -h $expectedHost -p $expectedPort -U $adminUser -d postgres -t -A -c `
      "select 1 from pg_database where datname = '$restoreDb';"
    if ($LASTEXITCODE -ne 0) { throw 'FALHA: consulta a pg_database.' }
    if ($exists) { throw "FALHA: destino ja existe: $restoreDb." }
    Write-Evidence 'OK: destino nao existia antes desta execucao.'

    Assert-DestinoSeguro $restoreDb
    & $createdb -h $expectedHost -p $expectedPort -U $adminUser -O cardapio_migrator -T template0 $restoreDb
    if ($LASTEXITCODE -ne 0) { throw 'FALHA: createdb.' }
    $criado = $true

    Assert-DestinoSeguro $restoreDb
    Assert-PropriedadeDb -Nome $restoreDb -HostName $expectedHost -Port $expectedPort -UserName $adminUser -EsperadoOwner 'cardapio_migrator'
    Write-Evidence "OK: banco descartavel criado e confirmado, owner=cardapio_migrator: $restoreDb"
  }
  finally {
    # Limpeza do segredo administrativo. Nota: strings .NET sao imutaveis e o GC do
    # PowerShell nao garante zerar a memoria anterior do heap managed; isto reduz a
    # janela de exposicao, mas nao e uma garantia criptografica de apagamento seguro.
    $adminPass  = $null
    $securePass = $null
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }

  # ===== Fase cardapio_migrator (credencial ja provisionada, sem novo prompt) =====
  $raw = Get-Content -LiteralPath $migrateDevEnv -Raw
  $m = [regex]::Match($raw, 'DATABASE_URL\s*=\s*(.+)')
  if (-not $m.Success) { throw 'FALHA: DATABASE_URL de migrate-dev.env ausente.' }
  $uri = [Uri]($m.Groups[1].Value.Trim().Trim('"').Trim("'"))
  $userInfo = $uri.UserInfo -split ':', 2
  $migUser = [Uri]::UnescapeDataString($userInfo[0])
  $migPass = [Uri]::UnescapeDataString($userInfo[1])
  if ($uri.Host -ne $expectedHost -or $uri.Port -ne $expectedPort -or $migUser -ne 'cardapio_migrator') {
    throw "FALHA: perfil migrate-dev inesperado: $migUser@$($uri.Host):$($uri.Port)"
  }

  $env:PGPASSWORD = $migPass
  try {
    Assert-DestinoSeguro $restoreDb
    Assert-PropriedadeDb -Nome $restoreDb -HostName $expectedHost -Port $expectedPort -UserName $migUser -EsperadoOwner 'cardapio_migrator'

    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $pgRestore -h $expectedHost -p $expectedPort -U $migUser -d $restoreDb `
      --no-owner --no-privileges --single-transaction --exit-on-error --verbose `
      $dump 2> "$dump.restore-test.log"
    $restoreExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    if ($restoreExit -ne 0) {
      Write-Evidence "FALHA no pg_restore (exit $restoreExit). Log: $dump.restore-test.log"
      Write-Evidence "Banco '$restoreDb' PRESERVADO para inspecao. Nao sera removido."
      throw 'Abortando sem limpeza automatica.'
    }
    Write-Evidence 'OK: pg_restore concluido em transacao unica, com --exit-on-error, so no banco descartavel.'

    $prevEap2 = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $psql -h $expectedHost -p $expectedPort -U $migUser -d $restoreDb -f $verifySql 2> "$dump.verify-restore.log" |
      Tee-Object -FilePath $evidence -Append
    $verifyExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap2
    if ($verifyExit -ne 0) {
      Write-Evidence "FALHA na verificacao (exit $verifyExit). Log: $dump.verify-restore.log"
      Write-Evidence "Banco '$restoreDb' PRESERVADO para inspecao."
      throw 'verify-restore.sql falhou ou o guard interno rejeitou o banco.'
    }
    Write-Evidence 'OK: verify-restore.sql concluido.'
    Write-Evidence 'IMPORTANTE: revisar manualmente nesta evidencia se "checksum_inicial_esperado" = t e se as sete migrations historicas aparecem concluidas. Essas contagens sao evidencia do que o BACKUP continha; nao presumir que a origem atual (cardapio_digital_dev) permanece igual - ela pode ter mudado desde a criacao do dump.'

    Assert-DestinoSeguro $restoreDb
    Assert-PropriedadeDb -Nome $restoreDb -HostName $expectedHost -Port $expectedPort -UserName $migUser -EsperadoOwner 'cardapio_migrator'
    & $dropdb -h $expectedHost -p $expectedPort -U $migUser $restoreDb
    if ($LASTEXITCODE -ne 0) {
      Write-Evidence "AVISO: dropdb falhou; remover '$restoreDb' manualmente depois de confirmar."
    } else {
      Write-Evidence "OK: limpeza concluida, $restoreDb removido."
    }

    $sucesso = $true
  }
  finally {
    $migPass = $null
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}
catch {
  Write-Evidence "FALHA: $($_.Exception.Message)"
  if ($criado) {
    Write-Evidence "Verificar manualmente se '$restoreDb' precisa ser removido apos inspecao em $evidence."
  }
  throw
}
finally {
  [GC]::Collect()
}

if ($sucesso) {
  Write-Evidence "SUCESSO: restauracao isolada validada de ponta a ponta. Evidencia completa em $evidence"
} else {
  Write-Evidence 'RESULTADO: NAO declarado como sucesso (alguma verificacao falhou ou nao foi alcancada).'
}
