$ErrorActionPreference = 'Stop'
$testDir = Join-Path $env:TEMP ("rustika-acl-test-" + [guid]::NewGuid().ToString("N"))
$file1 = Join-Path $testDir "admin_creds.txt"
$file2 = Join-Path $testDir "migrator_pw.txt"
$nodeScript = Join-Path $testDir "reader.js"

try {
    Write-Host "1. Criando diretorio..."
    New-Item -ItemType Directory -Path $testDir | Out-Null

    $currentUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')

    Write-Host "2. Protegendo diretorio..."
    $dirAcl = New-Object System.Security.AccessControl.DirectorySecurity
    $dirAcl.SetAccessRuleProtection($true, $false)
    $inheritanceFlags = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $propagationFlags = [System.Security.AccessControl.PropagationFlags]::None
    $dirRuleUser = New-Object System.Security.AccessControl.FileSystemAccessRule($currentUserSid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritanceFlags, $propagationFlags, [System.Security.AccessControl.AccessControlType]::Allow)
    $dirRuleSystem = New-Object System.Security.AccessControl.FileSystemAccessRule($systemSid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritanceFlags, $propagationFlags, [System.Security.AccessControl.AccessControlType]::Allow)
    $dirAcl.AddAccessRule($dirRuleUser)
    $dirAcl.AddAccessRule($dirRuleSystem)
    [System.IO.Directory]::SetAccessControl($testDir, $dirAcl)
    
    $checkDir = [System.IO.Directory]::GetAccessControl($testDir)
    if (-not $checkDir.AreAccessRulesProtected) { throw "Diretorio sem protecao (heranca ativa)." }
    $dirSids = @($checkDir.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value } | Sort-Object | Get-Unique)
    if ($dirSids.Count -ne 2 -or $dirSids -notcontains $currentUserSid.Value -or $dirSids -notcontains $systemSid.Value) {
        throw "Diretorio contem ACEs invalidas: $($dirSids -join ', ')"
    }
    Write-Host " -> Diretorio OK."

    Write-Host "3. Gravando arquivos..."
    [System.IO.File]::WriteAllText($file1, "fake_admin_conn")
    [System.IO.File]::WriteAllText($file2, "fake_migrator_pw")

    Write-Host "4. Protegendo arquivos..."
    $acl1 = [System.IO.File]::GetAccessControl($file1)
    $acl2 = [System.IO.File]::GetAccessControl($file2)

    $acl1.SetAccessRuleProtection($true, $false)
    $acl2.SetAccessRuleProtection($true, $false)

    $fileRuleUser = New-Object System.Security.AccessControl.FileSystemAccessRule($currentUserSid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
    $fileRuleSystem = New-Object System.Security.AccessControl.FileSystemAccessRule($systemSid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)

    $acl1.AddAccessRule($fileRuleUser)
    $acl1.AddAccessRule($fileRuleSystem)
    $acl2.AddAccessRule($fileRuleUser)
    $acl2.AddAccessRule($fileRuleSystem)

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

    [System.IO.File]::SetAccessControl($file1, $acl1)
    [System.IO.File]::SetAccessControl($file2, $acl2)

    $checkAcl1 = [System.IO.File]::GetAccessControl($file1)
    $checkAcl2 = [System.IO.File]::GetAccessControl($file2)

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
    Write-Host " -> Arquivos OK."

    Write-Host "5. Lendo com Node.js..."
    [System.IO.File]::WriteAllText($nodeScript, "const fs = require('fs'); const a = fs.readFileSync(process.argv[2], 'utf8'); const b = fs.readFileSync(process.argv[3], 'utf8'); if(a !== 'fake_admin_conn' || b !== 'fake_migrator_pw') { process.exit(1); } console.log(' -> Leitura Node.js OK.');")
    
    $nodeCmd = "node `"$nodeScript`" `"$file1`" `"$file2`""
    cmd /c $nodeCmd
    if ($LASTEXITCODE -ne 0) { throw "Falha na leitura pelo Node.js" }

    Write-Host "Todos os testes passaram com sucesso." -ForegroundColor Green
    exit 0
} catch {
    Write-Host "ERRO: $_" -ForegroundColor Red
    exit 1
} finally {
    Write-Host "6. Limpeza..."
    if (Test-Path $testDir) {
        Remove-Item -Path $testDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host " -> Limpo."
    }
}
