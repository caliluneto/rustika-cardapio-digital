#requires -Version 5.1
<#
  RUSTIKA - C.6 - PROVISIONAMENTO SUPERVISIONADO DO NEON
  ESCOPO: SOMENTE banco de replay + roles. SEM prisma migrate deploy,
  SEM rename, SEM bootstrap, SEM DROP e SEM arquivos .env.

  A Connection String e as senhas sao lidas pelo script TypeScript
  diretamente do TTY, com eco oculto. Este wrapper nao recebe, nao
  grava e nao repassa credenciais por argumento ou variavel de ambiente.

  Uso:
    powershell -ExecutionPolicy Bypass -File .\ops\homolog\provision-neon-c6.ps1

  Ou, a partir de qualquer diretorio:
    powershell -ExecutionPolicy Bypass -File <caminho>\backend\ops\homolog\provision-neon-c6.ps1

  O relatorio sanitizado e gravado em:
    backend\RELATORIO-PROVISIONAMENTO-C.6.md
  Em caso de falha parcial, tambem e gravado:
    backend\RELATORIO-PROVISIONAMENTO-C.6-FALHA.md
#>
[CmdletBinding()]
param(
  [string]$BackendPath
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($BackendPath)) {
  $BackendPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
} else {
  $BackendPath = (Resolve-Path -LiteralPath $BackendPath).Path
}

$scriptPath = Join-Path $BackendPath 'ops\homolog\provision-neon-c6.ts'
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

Write-Host '============================================================'
Write-Host ' RUSTIKA - C.6 - PROVISIONAMENTO NEON (SOMENTE BANCO/ROLES)'
Write-Host '============================================================'
Write-Host "Backend: $BackendPath"
Write-Host 'A Connection String e as tres senhas serao solicitadas pelo'
Write-Host 'script com eco oculto. Nada sera gravado em .env.'
Write-Host 'Nao havera prisma migrate deploy, rename, bootstrap ou DROP.'
Write-Host ''

if ([Console]::IsInputRedirected) {
  Write-Warning 'stdin parece redirecionado. O script exige TTY e abortara sem escrever.'
}

Push-Location -LiteralPath $BackendPath
$exitCode = 1
try {
  & npx --no-install tsx ops/homolog/provision-neon-c6.ts
  if ($null -ne $LASTEXITCODE) {
    $exitCode = $LASTEXITCODE
  }
} finally {
  Pop-Location
}

if ($exitCode -ne 0) {
  Write-Host ''
  Write-Host "Provisionamento interrompido (exit $exitCode)." -ForegroundColor Red
  Write-Host 'Nenhum DROP automatico foi executado. Verifique o relatorio de falha, se gerado.'
  exit $exitCode
}

Write-Host ''
Write-Host 'Provisionamento concluido sem migrations.' -ForegroundColor Green
Write-Host "Relatorio sanitizado: $(Join-Path $BackendPath 'RELATORIO-PROVISIONAMENTO-C.6.md')"
exit 0
