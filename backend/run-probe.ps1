try {
    $secPass = Read-Host -Prompt "Cole a NEON_PROBE_URL aqui (oculto)" -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPass)
    $env:NEON_PROBE_URL = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

    $env:NEON_PROBE_ALLOW_WRITE = "yes"
    $env:NEON_PROBE_ALLOW_GRANT = "yes"
    $env:NEON_PROBE_CONFIRM_ENDPOINT = "ep-sweet-king-bd7i7ypb"

    $logPath = "$PWD\probe-report.log"
    Clear-Content $logPath -ErrorAction SilentlyContinue

    Write-Host "Executando pré-voo (read)..."
    node scripts/neon-probe.mjs read | Out-File -FilePath $logPath -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Pré-voo falhou. Abortando escrita. Detalhes em $logPath" -ForegroundColor Red
        exit $LASTEXITCODE
    }

    Write-Host "Pré-voo concluído. Iniciando ensaio (write)..."
    node scripts/neon-probe.mjs write | Out-File -FilePath $logPath -Append -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Ensaio falhou. Detalhes no log." -ForegroundColor Red
    } else {
        Write-Host "Ensaio concluído com sucesso!" -ForegroundColor Green
    }
    Write-Host "Resultados salvos em: $logPath"
} finally {
    $env:NEON_PROBE_URL = $null
    $env:NEON_PROBE_ALLOW_WRITE = $null
    $env:NEON_PROBE_ALLOW_GRANT = $null
    $env:NEON_PROBE_CONFIRM_ENDPOINT = $null
}
