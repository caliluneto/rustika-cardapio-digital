#requires -Version 5.1
<#
  RUSTIKA - C.6-FIX01 - RECUPERACAO DA ACL DO BANCO DE REPLAY (NEON)

  ESCOPO: SOMENTE a ACL do banco cardapio_digital_test. NAO cria role, NAO cria banco,
  NAO renomeia, NAO executa migrations, NAO faz DROP/CASCADE/FORCE/RESET, NAO altera senhas.

  Uso padrao (SOMENTE LEITURA):
    powershell -ExecutionPolicy Bypass -File .\ops\homolog\recover-neon-c6-acl.ps1

  Aplicacao (exige tambem digitar C.6-RECOVER-ACL no prompt oculto):
    powershell -ExecutionPolicy Bypass -File .\ops\homolog\recover-neon-c6-acl.ps1 -Apply

  Entradas (leitura segura via Read-Host -AsSecureString; nada por argumento/ambiente/arquivo permanente):
    1. Connection String do neondb_owner (banco neondb, endpoint direto).
    2. Senha atual de cardapio_migrator (conexao de OWNER que aplica/verifica a ACL).

  Relatorios sanitizados (sem credenciais):
    backend\RELATORIO-RECUPERACAO-C.6-ACL.md
    backend\RELATORIO-RECUPERACAO-C.6-ACL-FALHA.md (em caso de falha)
#>
[CmdletBinding()]
param(
  [switch]$Apply,
  [string]$BackendPath
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($BackendPath)) {
  $BackendPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
} else {
  $BackendPath = (Resolve-Path -LiteralPath $BackendPath).Path
}

$scriptPath = Join-Path $BackendPath 'ops\homolog\recover-neon-c6-acl.ts'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
  throw "Script nao encontrado: $scriptPath"
}
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw 'npx nao encontrado no PATH. Instale Node.js >= 20.19 e as dependencias do backend.'
}
$tsxPackage = Join-Path $BackendPath 'node_modules\tsx\package.json'
if (-not (Test-Path -LiteralPath $tsxPackage -PathType Leaf)) {
  throw 'tsx nao encontrado em node_modules. Instale as dependencias do backend com autorizacao antes de executar.'
}

$mode = if ($Apply) { '--apply' } else { '--check' }

Write-Host '============================================================'
Write-Host ' RUSTIKA - C.6-FIX01 - RECUPERACAO DA ACL DO REPLAY (NEON)'
Write-Host '============================================================'
Write-Host "Backend: $BackendPath"
Write-Host "Modo: $mode"
Write-Host 'Sem CREATE ROLE/DATABASE, sem migrations e sem DROP/CASCADE/FORCE/RESET.'
Write-Host 'A senha sera lida seguramente via Read-Host -AsSecureString.'
Write-Host 'Nada sera gravado em .env ou logs permanentes.'
Write-Host ''

if ([string]::IsNullOrWhiteSpace($BackendPath)) {
  $BackendPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
} else {
  $BackendPath = (Resolve-Path -LiteralPath $BackendPath).Path
}

$scriptPath = Join-Path $BackendPath 'ops\homolog\recover-neon-c6-acl.ts'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
  throw "Script nao encontrado: $scriptPath"
}
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw 'npx nao encontrado no PATH. Instale Node.js >= 20.19 e as dependencias do backend.'
}
$tsxPackage = Join-Path $BackendPath 'node_modules\tsx\package.json'
if (-not (Test-Path -LiteralPath $tsxPackage -PathType Leaf)) {
  throw 'tsx nao encontrado em node_modules. Instale as dependencias do backend com autorizacao antes de executar.'
}

$mode = if ($Apply) { '--apply' } else { '--check' }

# Diretorio temporario para credenciais - criado exclusivamento por execucao com GUID
# Nome imprevisivel; se o caminho ja existir (extremamente improbavel), gera outro GUID
$rustikaTempDir = Join-Path $env:TEMP ("rustika-creds-" + [guid]::NewGuid().ToString("N"))

# Nao execute Remove-Item sobre diretorio preexistente para resolver colisao.
# Se por alguma razao o diretorio ja existir (improvel), interrompa seguramente.
if (Test-Path $rustikaTempDir) {
  Write-Error "Impossivel criar diretorio temporario: $rustikaTempDir ja existe. Gere outro nome manualmente e reinicie."
  throw "Bloqueio: diretorio temporario ja existe. Interrompendo para evitar conflitos."
}

# Criar novo diretorio temporario (unico por execucao)
New-Item -ItemType Directory -Path $rustikaTempDir | Out-Null

# Obter SIDs usando APIs .NET compativeis com PowerShell 5.1
$currentUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')

try {
  $dirAcl = New-Object System.Security.AccessControl.DirectorySecurity
  
  # Desabilitar heranca (true para proteger, false para remover as herdadas)
  $dirAcl.SetAccessRuleProtection($true, $false)
  
  $inheritanceFlags = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  $propagationFlags = [System.Security.AccessControl.PropagationFlags]::None
  
  $dirRuleUser = New-Object System.Security.AccessControl.FileSystemAccessRule($currentUserSid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritanceFlags, $propagationFlags, [System.Security.AccessControl.AccessControlType]::Allow)
  $dirRuleSystem = New-Object System.Security.AccessControl.FileSystemAccessRule($systemSid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritanceFlags, $propagationFlags, [System.Security.AccessControl.AccessControlType]::Allow)
  
  $dirAcl.AddAccessRule($dirRuleUser)
  $dirAcl.AddAccessRule($dirRuleSystem)
  
  [System.IO.Directory]::SetAccessControl($rustikaTempDir, $dirAcl)
  
  # Validar as ACLs do diretorio
  $checkDirAcl = [System.IO.Directory]::GetAccessControl($rustikaTempDir)
  
  if (-not $checkDirAcl.AreAccessRulesProtected) {
    throw "Falha validacao ACL: as regras de acesso do diretorio nao estao protegidas (heranca continua ativa)."
  }
  
  $rules = $checkDirAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
  $allIdentities = @($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object | Get-Unique)
  
  if ($allIdentities.Count -ne 2 -or $allIdentities -notcontains $currentUserSid.Value -or $allIdentities -notcontains $systemSid.Value) {
    throw "Falha validacao ACL: SIDs esperados nao encontrados ou SIDs inesperados presentes. ACEs ativas: $($allIdentities -join ', ')"
  }
  
  Write-Host 'ACLs NTFS validadas no diretorio temporario: usuario atual + SYSTEM com controle restrito' -ForegroundColor Green
} catch {
  $origException = $_.Exception
  $exceptionType = $origException.GetType().FullName
  $exceptionMessage = $origException.Message
  $errorStep = 'aplicar ACL NTFS no diretorio'
  
  $dirSids = 'nao disponivel'
  $inheritanceState = 'nao disponivel'
  $grantedRights = 'nao disponivel'
  $unexpectedRules = 'nao disponivel'
  
  if ($rustikaTempDir -and (Test-Path $rustikaTempDir)) {
    try {
      $checkDirAcl = [System.IO.Directory]::GetAccessControl($rustikaTempDir)
      $rules = $checkDirAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
      if ($rules) {
        $allIdentities = @($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object | Get-Unique)
        $dirSids = $allIdentities -join ', '
      }
    } catch {}
  }

  # Determinar a etapa provavel da falha baseado na mensagem
  if ($exceptionType -ne 'NTFS_SDDL_ERROR') {
    switch -regex ($exceptionMessage) {
      'Nao foi possivel obter acesso' { $errorStep = 'obter acesso ao diretorio temporario' }
      'Nao foi possivel obter controle de acesso' { $errorStep = 'obter ACL do diretorio temporario' }
      'Nao foi possivel adicionar regra de acesso' { $errorStep = 'adicionar regra de acesso (usuario/SYSTEM)' }
      'Nao foi possivel definir controle de acesso' { $errorStep = 'definir (set) ACL no diretorio' }
      'SIDs esperados nao encontrados' { $errorStep = 'validar SIDs esperados' }
      'identidades inesperadas' { $errorStep = 'verificar identidades inesperadas' }
      'regras de heranca' { $errorStep = 'verificar heranca de ACL' }
      'FullControl para identidade nao esperada' { $errorStep = 'verificar permissoes FullControl inesperadas' }
      default { $errorStep = 'operacao de ACL NTFS' }
    }
  }

  # Escrever diagnostico sanitizado (sem credenciais)
  Write-Host '--- Diagnostico de exceo NTFS ---' -ForegroundColor Cyan
  Write-Host "Tipo da exceo original: $exceptionType" -ForegroundColor White
  Write-Host "Mensagem da exceo original: $exceptionMessage" -ForegroundColor White
  Write-Host "Etapa exata da falha: $errorStep" -ForegroundColor White
  Write-Host "SID do usuario atual: $($currentUserSid.Value)" -ForegroundColor White
  Write-Host "SID do SYSTEM: $($systemSid.Value)" -ForegroundColor White
  if ($dirSids -and $dirSids -ne 'nao disponivel (erro na aplicacao SDDL)') {
    Write-Host "SIDs presentes nas ACLs do diretorio: $dirSids" -ForegroundColor White
  }
  Write-Host "Estado de heranca: $inheritanceState" -ForegroundColor White
  Write-Host "Direitos concedidos: $grantedRights" -ForegroundColor White
  if ($unexpectedRules -and $unexpectedRules -ne 'desconhecido') {
    Write-Host "Regras de acesso inesperadas: $unexpectedRules" -ForegroundColor White
  }
  Write-Host '---------------------------------------' -ForegroundColor Cyan

  # Remover diretorio temporario apenas se ainda existir e nao causou o erro critico
  if ($rustikaTempDir -and (Test-Path $rustikaTempDir)) {
    try { Remove-Item -Path $rustikaTempDir -Recurse -Force -ErrorAction SilentlyContinue } catch { }
  }

  # Lancar erro bloqueando nova tentativa sem revelar segredos
  throw "Bloqueio de seguranca: falha ao aplicar/validar ACLs NTFS na etapa '$errorStep'. Tipo: $exceptionType. Operacao cancelada."
}

# --- Fluxo de controle principal ---

# Verificar se ocorreu erro critico antes da validacao NTFS
if ($PSScriptLastError -ne $null) {
  exit 1
}

# Modo CHECK: solicitar credenciais e executar verificacao Node
if ($mode -eq '--check') {
  Write-Host '' -ForegroundColor Cyan
  Write-Host '=== Modo CHECK: verificacao somente leitura ===' -ForegroundColor Cyan
  Write-Host '' -ForegroundColor Cyan

  # Solicitar credenciais seguramente (Read-Host -AsSecureString)
  Write-Host '1. Connection String do neondb_owner (entrada oculta):' -ForegroundColor White
  $adminConnSecStr = Read-Host -AsSecureString 'Digite a string de conexao (ou arraste um arquivo .env valido):'
  $adminConnInSec = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminConnSecStr))

  Write-Host '2. Senha atual de cardapio_migrator (entrada oculta):' -ForegroundColor White
  $migratorPwdSecStr = Read-Host -AsSecureString 'Digite a senha da migradora:'
  $migratorPwdInSec = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($migratorPwdSecStr))

  # Validacao de senha vazia
  if ([string]::IsNullOrWhiteSpace($migratorPwdInSec) -or $migratorPwdInSec.Length -eq 0) {
    throw "Senha da migradora invalida: a senha nao pode ser vazia."
  }

  # Limpar variaveis de seguranca
  $adminConnSecStr = $null
  $migratorPwdSecStr = $null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()

  # Arquivos de credenciais dentro do diretorio temporario
  $adminCredsPath = Join-Path $rustikaTempDir "admin-creds.txt"
  $migratorPwdPath = Join-Path $rustikaTempDir "migrator-pw.txt"

  # Montar argumentos para o processo Node com as flags
  $nodeArgs = @(
    '--mode', $mode,
    '--admin-creds', $adminCredsPath,
    '--migrator-pw', $migratorPwdPath
  )

  # Primeiro cria arquivos vazios para proteger antes de gravar dados sensiveis
  try {
    New-Item -ItemType File -Path $adminCredsPath -Force | Out-Null
    New-Item -ItemType File -Path $migratorPwdPath -Force | Out-Null

    # Re-aplicar ACL rigorosa e bloquear heranca nos proprios arquivos para dupla seguranca
    $acl1 = [System.IO.File]::GetAccessControl($adminCredsPath)
    $acl2 = [System.IO.File]::GetAccessControl($migratorPwdPath)

    # Construir novas ACLs protegidas com heranca desativada
    $acl1.SetAccessRuleProtection($true, $false)
    $acl2.SetAccessRuleProtection($true, $false)

    # Adicionar regras para SYSTEM e usuario corrente usando SIDs reais
    $fileRuleUser = New-Object System.Security.AccessControl.FileSystemAccessRule($currentUserSid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
    $fileRuleSystem = New-Object System.Security.AccessControl.FileSystemAccessRule($systemSid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)

    $acl1.AddAccessRule($fileRuleUser)
    $acl1.AddAccessRule($fileRuleSystem)
    $acl2.AddAccessRule($fileRuleUser)
    $acl2.AddAccessRule($fileRuleSystem)

    # Remover explicitamente ACEs existentes (herdados ou inseridos por padrao) usando as regras atuais
    $rules1 = $acl1.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    foreach ($rule in $rules1) {
      if ($rule.IdentityReference.Value -ne $currentUserSid.Value -and $rule.IdentityReference.Value -ne $systemSid.Value) {
        $acl1.RemoveAccessRule($rule) | Out-Null
      }
    }
    
    $rules2 = $acl2.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    foreach ($rule in $rules2) {
      if ($rule.IdentityReference.Value -ne $currentUserSid.Value -and $rule.IdentityReference.Value -ne $systemSid.Value) {
        $acl2.RemoveAccessRule($rule) | Out-Null
      }
    }

    # Confirmar que as ACLs foram aplicadas
    [System.IO.File]::SetAccessControl($adminCredsPath, $acl1)
    [System.IO.File]::SetAccessControl($migratorPwdPath, $acl2)
    
    # Validar que a protecao e as regras estao exatamente como esperado
    $checkAcl1 = [System.IO.File]::GetAccessControl($adminCredsPath)
    $checkAcl2 = [System.IO.File]::GetAccessControl($migratorPwdPath)
    
    if (-not $checkAcl1.AreAccessRulesProtected -or -not $checkAcl2.AreAccessRulesProtected) {
      throw "Regras de acesso dos arquivos nao estao protegidas."
    }
    
    $fileSids1 = @($checkAcl1.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value } | Sort-Object | Get-Unique)
    $fileSids2 = @($checkAcl2.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value } | Sort-Object | Get-Unique)
    
    if ($fileSids1.Count -ne 2 -or $fileSids1 -notcontains $currentUserSid.Value -or $fileSids1 -notcontains $systemSid.Value) {
      throw "Arquivo 1 contem ACEs invalidas: $($fileSids1 -join ', ')"
    }
    if ($fileSids2.Count -ne 2 -or $fileSids2 -notcontains $currentUserSid.Value -or $fileSids2 -notcontains $systemSid.Value) {
      throw "Arquivo 2 contem ACEs invalidas: $($fileSids2 -join ', ')"
    }

    # Agora gravar as credenciais com seguranca ja estabelecida e validada
    [System.IO.File]::WriteAllText($adminCredsPath, $adminConnInSec) | Out-Null
    [System.IO.File]::WriteAllText($migratorPwdPath, $migratorPwdInSec) | Out-Null
  } catch {
    # Remover arquivos se a aplicacao de ACL falhou apos a gravacao
    if (Test-Path $adminCredsPath) { Remove-Item -Path $adminCredsPath -Force -ErrorAction SilentlyContinue }
    if (Test-Path $migratorPwdPath) { Remove-Item -Path $migratorPwdPath -Force -ErrorAction SilentlyContinue }
    throw "Falha de seguranca: nao foi possivel aplicar ACLs restritas aos arquivos temporarios. Operacao cancelada."
  }

  Write-Host "Modo: $mode" -ForegroundColor Cyan
  Write-Host "Executando processo Node: npx tsx ops/homolog/recover-neon-c6-acl.ts [args omitidos]" -ForegroundColor White

  # Executar processo Node
  $exitCode = 1
  Push-Location -LiteralPath $BackendPath
  try {
    & npx --no-install tsx ops/homolog/recover-neon-c6-acl.ts $nodeArgs
    if ($null -ne $LASTEXITCODE) {
      $exitCode = $LASTEXITCODE
    }
  } finally {
    Pop-Location
    # Remover arquivos temporarios de credenciais e pasta
    if (Test-Path $rustikaTempDir) {
      Remove-Item -Path $rustikaTempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  # Verificar resultado baseado no codigo de saida
  if ($exitCode -eq 0) {
    Write-Host '' -ForegroundColor Cyan
    Write-Host 'Check concluido com sucesso.' -ForegroundColor Green
    Write-Host 'Nenhum DROP/CASCADE/FORCE/RESET foi executado.' -ForegroundColor Yellow
    exit 0
  } else {
    Write-Host '' -ForegroundColor Cyan
    Write-Host 'Check falhou. Verifique o relatorio gerado.' -ForegroundColor Red
    # Gerar relatorio de falha
    $reportPath = Join-Path $BackendPath 'RELATORIO-RECUPERACAO-C.6-ACL-FALHA.md'
    if (-not (Test-Path $reportPath)) {
      Write-Error "Nao foi possivel encontrar relatorio de falha: $reportPath"
    }
    exit $exitCode
  }
}

# Modo APLICACAO: solicitar credenciais, aplicar ACL NTFS e executar Node com --apply
if ($mode -eq '--apply') {
  Write-Host '' -ForegroundColor Cyan
  Write-Host '=== Modo APPLY: aplicacao controlada da ACL ===' -ForegroundColor Yellow
  Write-Host 'Uma confirmacao digitada sera exigida pelo processo Node.' -ForegroundColor White
  Write-Host '' -ForegroundColor Cyan

  # Solicitar credenciais seguramente (Read-Host -AsSecureString)
  Write-Host '1. Connection String do neondb_owner (entrada oculta):' -ForegroundColor White
  $adminConnSecStr = Read-Host -AsSecureString 'Digite a string de conexao (ou arraste um arquivo .env valido):'
  $adminConnInSec = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminConnSecStr))

  Write-Host '2. Senha atual de cardapio_migrator (entrada oculta):' -ForegroundColor White
  $migratorPwdSecStr = Read-Host -AsSecureString 'Digite a senha da migradora:'
  $migratorPwdInSec = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($migratorPwdSecStr))

  # Validacao de senha vazia
  if ([string]::IsNullOrWhiteSpace($migratorPwdInSec) -or $migratorPwdInSec.Length -eq 0) {
    throw "Senha da migradora invalida: a senha nao pode ser vazia."
  }

  # Limpar variaveis de seguranca
  $adminConnSecStr = $null
  $migratorPwdSecStr = $null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()

  # Arquivos de credenciais dentro do diretorio temporario
  $adminCredsPath = Join-Path $rustikaTempDir "admin-creds.txt"
  $migratorPwdPath = Join-Path $rustikaTempDir "migrator-pw.txt"

  # Montar argumentos para o processo Node com as flags (--apply ativa o modo de escrita no TS)
  $nodeArgs = @(
    '--admin-creds', $adminCredsPath,
    '--migrator-pw', $migratorPwdPath,
    '--apply'
  )

  # Primeiro cria arquivos vazios para proteger antes de gravar dados sensiveis
  try {
    New-Item -ItemType File -Path $adminCredsPath -Force | Out-Null
    New-Item -ItemType File -Path $migratorPwdPath -Force | Out-Null

    $acl1 = [System.IO.File]::GetAccessControl($adminCredsPath)
    $acl2 = [System.IO.File]::GetAccessControl($migratorPwdPath)
    $acl1.SetAccessRuleProtection($true, $false)
    $acl2.SetAccessRuleProtection($true, $false)

    $fileRuleUser = New-Object System.Security.AccessControl.FileSystemAccessRule($currentUserSid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
    $fileRuleSystem = New-Object System.Security.AccessControl.FileSystemAccessRule($systemSid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
    $acl1.AddAccessRule($fileRuleUser); $acl1.AddAccessRule($fileRuleSystem)
    $acl2.AddAccessRule($fileRuleUser); $acl2.AddAccessRule($fileRuleSystem)

    $rules1 = $acl1.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    foreach ($rule in $rules1) {
      if ($rule.IdentityReference.Value -ne $currentUserSid.Value -and $rule.IdentityReference.Value -ne $systemSid.Value) {
        $acl1.RemoveAccessRule($rule) | Out-Null
      }
    }
    $rules2 = $acl2.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    foreach ($rule in $rules2) {
      if ($rule.IdentityReference.Value -ne $currentUserSid.Value -and $rule.IdentityReference.Value -ne $systemSid.Value) {
        $acl2.RemoveAccessRule($rule) | Out-Null
      }
    }

    [System.IO.File]::SetAccessControl($adminCredsPath, $acl1)
    [System.IO.File]::SetAccessControl($migratorPwdPath, $acl2)

    $checkAcl1 = [System.IO.File]::GetAccessControl($adminCredsPath)
    $checkAcl2 = [System.IO.File]::GetAccessControl($migratorPwdPath)
    if (-not $checkAcl1.AreAccessRulesProtected -or -not $checkAcl2.AreAccessRulesProtected) {
      throw "Regras de acesso dos arquivos nao estao protegidas."
    }
    $fileSids1 = @($checkAcl1.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value } | Sort-Object | Get-Unique)
    $fileSids2 = @($checkAcl2.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value } | Sort-Object | Get-Unique)
    if ($fileSids1.Count -ne 2 -or $fileSids1 -notcontains $currentUserSid.Value -or $fileSids1 -notcontains $systemSid.Value) {
      throw "Arquivo 1 contem ACEs invalidas: $($fileSids1 -join ', ')"
    }
    if ($fileSids2.Count -ne 2 -or $fileSids2 -notcontains $currentUserSid.Value -or $fileSids2 -notcontains $systemSid.Value) {
      throw "Arquivo 2 contem ACEs invalidas: $($fileSids2 -join ', ')"
    }

    [System.IO.File]::WriteAllText($adminCredsPath, $adminConnInSec) | Out-Null
    [System.IO.File]::WriteAllText($migratorPwdPath, $migratorPwdInSec) | Out-Null
  } catch {
    if (Test-Path $adminCredsPath) { Remove-Item -Path $adminCredsPath -Force -ErrorAction SilentlyContinue }
    if (Test-Path $migratorPwdPath) { Remove-Item -Path $migratorPwdPath -Force -ErrorAction SilentlyContinue }
    throw "Falha de seguranca: nao foi possivel aplicar ACLs restritas aos arquivos temporarios. Operacao cancelada."
  }

  Write-Host "Modo: $mode" -ForegroundColor Cyan
  Write-Host "Executando processo Node: npx tsx ops/homolog/recover-neon-c6-acl.ts [args omitidos]" -ForegroundColor White

  $exitCode = 1
  Push-Location -LiteralPath $BackendPath
  try {
    & npx --no-install tsx ops/homolog/recover-neon-c6-acl.ts $nodeArgs
    if ($null -ne $LASTEXITCODE) { $exitCode = $LASTEXITCODE }
  } finally {
    Pop-Location
    if (Test-Path $rustikaTempDir) {
      Remove-Item -Path $rustikaTempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  if ($exitCode -eq 0) {
    Write-Host '' -ForegroundColor Cyan
    Write-Host 'APPLY concluido com sucesso.' -ForegroundColor Green
    Write-Host 'Nenhum DROP/CASCADE/FORCE/RESET foi executado.' -ForegroundColor Yellow
    exit 0
  } else {
    Write-Host '' -ForegroundColor Cyan
    Write-Host 'APPLY falhou. Verifique o relatorio gerado.' -ForegroundColor Red
    $reportPath = Join-Path $BackendPath 'RELATORIO-RECUPERACAO-C.6-ACL-FALHA.md'
    if (-not (Test-Path $reportPath)) {
      Write-Error "Nao foi possivel encontrar relatorio de falha: $reportPath"
    }
    exit $exitCode
  }
}

# Se nenhum modo valido for detectado
Write-Host '' -ForegroundColor Cyan
Write-Host 'Pre-voo somente leitura concluido. Nada foi alterado.' -ForegroundColor Yellow
Write-Host 'Para aplicar (somente com autorizacao explicita): use -Apply.'
exit 0
