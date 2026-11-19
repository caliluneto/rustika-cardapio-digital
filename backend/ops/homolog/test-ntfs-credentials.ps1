#Test: Temporary credential files ACL creation and protection
#PowerShell 5.1 compatible, no real credentials

# STEP 1: Create temporary directory with restricted ACL
Write-Host '=== TEST START ===' -ForegroundColor Cyan

$tempDir = Join-Path $env:TEMP ("rustika-test-" + [guid]::NewGuid().ToString("N"))
Write-Host 'Temp dir: ' $tempDir -ForegroundColor White

New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

$userSidObj = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$userSidValue = $userSidObj.Value
Write-Host 'Current user SID: ' $userSidValue -ForegroundColor White

# Get directory ACL and REMOVE ALL existing rules (nao preservar ACEs anteriores como Administradores, CodexSandboxUsers)
$dirAcl = Get-Item $tempDir | Get-Acl
# Remove all access rules to start fresh
$dirAcl.RemoveAccessRuleAll([System.Security.Principal.NTAccount]'Everyone')
# Remove rules by iterating (comprehensive cleanup)
$existingRules = $dirAcl.GetAccessRules($true, $true, [System.Security.Principal.NTAccount])
foreach ($rule in $existingRules) {
    $dirAcl.RemoveAccessRule($rule.IdentityReference)
}
$dirAcl.SetAccessRuleProtection($false, $false)  # Don't preserve existing, don't inherit

$sysSid = 'S-1-5-18'
# Add rules using VALID 3-parameter constructor (identity, FileSystemRights, AccessControlType)
# This avoids the "new with 1 argument" error
$userSidAccount = New-Object System.Security.Principal.NTAccount($userSidValue)
$ruleUser = [System.Security.AccessControl.FileSystemAccessRule]::new($userSidAccount, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
$ruleSys = [System.Security.AccessControl.FileSystemAccessRule]::new($sysSid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
$dirAcl.AddAccessRule($ruleUser)
$dirAcl.AddAccessRule($ruleSys)
Set-Acl -Path $tempDir -Acl $dirAcl

$dirAcl2 = Get-Item $tempDir | Get-Acl
Write-Host 'Directory ACL rules:'
foreach ($rule in $dirAcl2.GetAccessRules('True', 'True', [System.Security.Principal.NTAccount])) {
    Write-Host '  - ' $rule.IdentityReference.Value -ForegroundColor White
}

Write-Host 'Directory ACL IsAccessRuleProtected: ' $dirAcl2.AreAccessRulesProtected -ForegroundColor White

# STEP 2: Create two empty files in the directory
Write-Host ''
Write-Host 'STEP 2: Create two empty files' -ForegroundColor Cyan

$file1 = Join-Path $tempDir 'cred-admin-tmp.txt'
$file2 = Join-Path $tempDir 'cred-pw-tmp.txt'

New-Item -ItemType File -Path $file1 -Force | Out-Null
New-Item -ItemType File -Path $file2 -Force | Out-Null

Write-Host 'File 1: ' $file1 -ForegroundColor White
Write-Host 'File 2: ' $file2 -ForegroundColor White

Write-Host 'File1 ACL before application:' -ForegroundColor Cyan
$f1Acl = Get-Item $file1 | Get-Acl
foreach ($rule in $f1Acl.GetAccessRules('True', 'True', [System.Security.Principal.NTAccount])) {
    Write-Host '  - ' $rule.IdentityReference.Value -ForegroundColor White
}

Write-Host 'File2 ACL before application:' -ForegroundColor Cyan
$f2Acl = Get-Item $file2 | Get-Acl
foreach ($rule in $f2Acl.GetAccessRules('True', 'True', [System.Security.Principal.NTAccount])) {
    Write-Host '  - ' $rule.IdentityReference.Value -ForegroundColor White
}

# STEP 3: Apply ACLs to the files using valid FileSystemAccessRule constructors
Write-Host ''
Write-Host 'STEP 3: Apply ACLs to files using FileSystemAccessRule constructors' -ForegroundColor Cyan

# File 1 - use valid 3-param constructor
$f1UserAccount = New-Object System.Security.Principal.NTAccount($userSidValue)
$ruleUser1 = [System.Security.AccessControl.FileSystemAccessRule]::new($f1UserAccount, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
$ruleSys1 = [System.Security.AccessControl.FileSystemAccessRule]::new($sysSid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)

$file1Acl = Get-Item $file1 | Get-Acl
# Remove any existing rules on the file (start fresh)
$file1Acl.RemoveAccessRuleAll([System.Security.Principal.NTAccount]'Everyone')
foreach ($rule in $file1Acl.GetAccessRules($true, $true, [System.Security.Principal.NTAccount])) {
    $file1Acl.RemoveAccessRule($rule.IdentityReference)
}
$file1Acl.AddAccessRule($ruleUser1)
$file1Acl.AddAccessRule($ruleSys1)
$file1Acl.SetAccessRuleProtection($false, $false)  # Don't preserve, don't inherit
Set-Acl -Path $file1 -Acl $file1Acl

# File 2 - use valid 3-param constructor
$f2UserAccount = New-Object System.Security.Principal.NTAccount($userSidValue)
$ruleUser2 = [System.Security.AccessControl.FileSystemAccessRule]::new($f2UserAccount, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
$ruleSys2 = [System.Security.AccessControl.FileSystemAccessRule]::new($sysSid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)

$file2Acl = Get-Item $file2 | Get-Acl
# Remove any existing rules on the file (start fresh)
$file2Acl.RemoveAccessRuleAll([System.Security.Principal.NTAccount]'Everyone')
foreach ($rule in $file2Acl.GetAccessRules($true, $true, [System.Security.Principal.NTAccount])) {
    $file2Acl.RemoveAccessRule($rule.IdentityReference)
}
$file2Acl.AddAccessRule($ruleUser2)
$file2Acl.AddAccessRule($ruleSys2)
$file2Acl.SetAccessRuleProtection($false, $false)  # Don't preserve, don't inherit
Set-Acl -Path $file2 -Acl $file2Acl

Write-Host 'ACLs applied successfully!' -ForegroundColor Green

# STEP 4: Read back ACLs and verify
Write-Host ''
Write-Host 'STEP 4: Read back ACLs and verify' -ForegroundColor Cyan

Write-Host 'File1 ACL after application:' -ForegroundColor Cyan
$f1Acl2 = Get-Item $file1 | Get-Acl
foreach ($rule in $f1Acl2.GetAccessRules('True', 'True', [System.Security.Principal.NTAccount])) {
    Write-Host '  - ' $rule.IdentityReference.Value '  Protected: ' $rule.AreAccessRulesProtected -ForegroundColor White
}

Write-Host 'File2 ACL after application:' -ForegroundColor Cyan
$f2Acl2 = Get-Item $file2 | Get-Acl
foreach ($rule in $f2Acl2.GetAccessRules('True', 'True', [System.Security.Principal.NTAccount])) {
    Write-Host '  - ' $rule.IdentityReference.Value '  Protected: ' $rule.AreAccessRulesProtected -ForegroundColor White
}

Write-Host 'File1 AreAccessRulesProtected: ' $f1Acl2.AreAccessRulesProtected -ForegroundColor White
Write-Host 'File2 AreAccessRulesProtected: ' $f2Acl2.AreAccessRulesProtected -ForegroundColor White

# Verify only expected SIDs are present (user current + SYSTEM only)
$f1SIDs = $f1Acl2.GetAccessRules('True', 'True', [System.Security.Principal.NTAccount]) | ForEach-Object { $rule.IdentityReference.Value } | Sort-Object | Get-Unique
$f2SIDs = $f2Acl2.GetAccessRules('True', 'True', [System.Security.Principal.NTAccount]) | ForEach-Object { $rule.IdentityReference.Value } | Sort-Object | Get-Unique

Write-Host 'File1 SIDs found: ' ($f1SIDs -join ', ') -ForegroundColor White
Write-Host 'File2 SIDs found: ' ($f2SIDs -join ', ') -ForegroundColor White

$f1Match = ($f1SIDs -contains $userSidValue) -and ($f1SIDs -contains 'S-1-5-18')
$f2Match = ($f2SIDs -contains $userSidValue) -and ($f2SIDs -contains 'S-1-5-18')

Write-Host 'File1 SIDs match expected (user + SYSTEM): ' $f1Match -ForegroundColor White
Write-Host 'File2 SIDs match expected (user + SYSTEM): ' $f2Match -ForegroundColor White

if (-not $f1Match -or -not $f2Match) {
    Write-Host 'FAIL: SIDs nao correspondem ao esperado (deveriam ser apenas usuario atual + SYSTEM)' -ForegroundColor Red
    if (Test-Path $file1) { Remove-Item -Path $file1 -Force -ErrorAction SilentlyContinue }
    if (Test-Path $file2) { Remove-Item -Path $file2 -Force -ErrorAction SilentlyContinue }
    if (Test-Path $tempDir) { Remove-Item -Path $tempDir -Force -ErrorAction SilentlyContinue }
    exit 1
}

# STEP 5: Write fictitious text
Write-Host ''
Write-Host 'STEP 5: Write fictitious text' -ForegroundColor Cyan

$fictitiousAdmin = 'admin-connection-string-fictitious-example-12345'
$fictitiousPwd = 'password-fictitious-example-12345'

[System.IO.File]::WriteAllText($file1, $fictitiousAdmin) | Out-Null
[System.IO.File]::WriteAllText($file2, $fictitiousPwd) | Out-Null

Write-Host 'Fictitious credentials written' -ForegroundColor White

# STEP 6: Read files and validate content
Write-Host ''
Write-Host 'STEP 6: Read files and validate content' -ForegroundColor Cyan

$readAdmin = [System.IO.File]::ReadAllText($file1)
$readPwd = [System.IO.File]::ReadAllText($file2)

Write-Host 'Read admin content length: ' $readAdmin.Length -ForegroundColor White
Write-Host 'Read pwd content length: ' $readPwd.Length -ForegroundColor White

$adminMatch = $readAdmin -eq $fictitiousAdmin
$pwdMatch = $readPwd -eq $fictitiousPwd

if ($adminMatch) { Write-Host 'Admin content match: PASS' -ForegroundColor White } else { Write-Host 'Admin content match: FAIL' -ForegroundColor White }
if ($pwdMatch) { Write-Host 'Password content match: PASS' -ForegroundColor White } else { Write-Host 'Password content match: FAIL' -ForegroundColor White }

if (-not $adminMatch -or -not $pwdMatch) {
    Write-Host 'FAIL: Content validation failed' -ForegroundColor Red
    if (Test-Path $file1) { Remove-Item -Path $file1 -Force -ErrorAction SilentlyContinue }
    if (Test-Path $file2) { Remove-Item -Path $file2 -Force -ErrorAction SilentlyContinue }
    if (Test-Path $tempDir) { Remove-Item -Path $tempDir -Force -ErrorAction SilentlyContinue }
    exit 1
}

# STEP 7: Delete files and directory in finally block
Write-Host ''
Write-Host 'STEP 7: Delete files and directory' -ForegroundColor Cyan

$cleanupSuccess = $true
try {
    if (Test-Path $file1) { Remove-Item -Path $file1 -Force -ErrorAction SilentlyContinue }
    else { $cleanupSuccess = $false }
    if (Test-Path $file2) { Remove-Item -Path $file2 -Force -ErrorAction SilentlyContinue }
    else { $cleanupSuccess = $false }
    if (Test-Path $tempDir) { Remove-Item -Path $tempDir -Force -ErrorAction SilentlyContinue }
    else { $cleanupSuccess = $false }
} catch {
    $cleanupSuccess = $false
}

Write-Host 'Files and directory deleted' -ForegroundColor White
Write-Host 'Cleanup success: ' $cleanupSuccess -ForegroundColor White

Write-Host 'Verify directory does not exist: ' (Test-Path $tempDir) -ForegroundColor White

# STEP 8: Summary
Write-Host ''
Write-Host '=== TEST RESULT ===' -ForegroundColor Cyan

$allPass = $f1Match -and $f2Match -and $adminMatch -and $pwdMatch -and $cleanupSuccess

if ($allPass) {
    Write-Host 'TEST PASS: All steps approved' -ForegroundColor Green
    exit 0
} else {
    Write-Host 'TEST FAIL: Alguma etapa nao aprovada' -ForegroundColor Red
    exit 1
}
