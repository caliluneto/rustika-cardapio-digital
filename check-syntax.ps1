$file = 'C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend\ops\homolog\recover-neon-c6-acl.ps1'
$errors = $null
$warnings = $null
[System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$errors, [ref]$warnings) | Out-Null
if ($errors.Count -eq 0) {
    Write-Host 'SYNTAX OK - No parsing errors' -ForegroundColor Green
} else {
    Write-Host 'SYNTAX ERRORS FOUND:' -ForegroundColor Red
    $errors | ForEach-Object { Write-Host $_ -ForegroundColor Red }
}