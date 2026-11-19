#requires -Version 5.1
# Prepares only migrate-homolog-replay.env. Run from an interactive Windows session.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$secretDir = Join-Path $env:APPDATA 'rustika-homolog-replay'
$secretFile = Join-Path $secretDir 'migrate-homolog-replay.env'
$createdDir = $false
$createdFile = $false
$plainUrl = $null
$secureUrl = $null
$rawPassword = $null
$plainPassword = $null
$encodedPassword = $null
$userInfo = $null
$contents = $null
$bytes = $null
$stream = $null
$stage = 'preflight'
$bstr = [IntPtr]::Zero
$systemSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User

function Assert-PrivateAcl($path, $isDirectory, $fileStream = $null) {
  $acl = if ($isDirectory) {
    [System.IO.Directory]::GetAccessControl($path)
  } else {
    $fileStream.GetAccessControl()
  }
  if (-not $acl.AreAccessRulesProtected -or
      $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $userSid.Value) {
    throw 'ACL ownership or inheritance check failed.'
  }
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 2) { throw 'ACL rule count check failed.' }
  foreach ($sid in @($userSid.Value, $systemSid.Value)) {
    $matching = @($rules | Where-Object { $_.IdentityReference.Value -eq $sid })
    if ($matching.Count -ne 1 -or
        $matching[0].AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
        ($matching[0].FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or
        $matching[0].IsInherited) {
      throw 'ACL identity or rights check failed.'
    }
  }
}

try {
  if ([string]::IsNullOrWhiteSpace($env:APPDATA)) { throw 'APPDATA is unavailable.' }
  if (Test-Path -LiteralPath $secretDir) { throw 'The dedicated secrets directory already exists.' }

  $parent = Split-Path -Parent $secretDir
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw 'APPDATA directory is unavailable.' }
  if ((Get-Item -LiteralPath $parent).PSDrive.Provider.Name -ne 'FileSystem' -or
      [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($parent)).DriveFormat -ne 'NTFS') {
    throw 'NTFS is required.'
  }
  $ancestor = $parent
  while ($ancestor) {
    if (((Get-Item -LiteralPath $ancestor -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'The secrets path must not contain a junction or symbolic link.'
    }
    $next = Split-Path -Parent $ancestor
    if (-not $next -or $next -eq $ancestor) { break }
    $ancestor = $next
  }
  $parentAcl = [System.IO.Directory]::GetAccessControl($parent)
  $trustedSids = @($userSid.Value, $systemSid.Value, 'S-1-5-32-544')
  foreach ($rule in $parentAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
        $trustedSids -notcontains $rule.IdentityReference.Value -and
        ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::Write) -ne 0) {
      throw 'APPDATA allows another identity to write directory entries.'
    }
  }

  $stage = 'directory ACL'
  New-Item -ItemType Directory -Path $secretDir -ErrorAction Stop | Out-Null
  $createdDir = $true
  $dirAcl = [System.IO.Directory]::GetAccessControl($secretDir)
  $dirAcl.SetOwner($userSid)
  $dirAcl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($dirAcl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))) {
    $dirAcl.RemoveAccessRuleSpecific($rule)
  }
  $inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  foreach ($sid in @($userSid, $systemSid)) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $dirAcl.AddAccessRule($rule)
  }
  [System.IO.Directory]::SetAccessControl($secretDir, $dirAcl)
  Assert-PrivateAcl $secretDir $true

  $stage = 'file ACL'
  $stream = [System.IO.File]::Open($secretFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  $createdFile = $true
  $stream.Dispose()
  $stream = $null
  $stage = 'read file ACL'
  $fileAcl = [System.IO.File]::GetAccessControl($secretFile)
  $fileAcl.SetOwner($userSid)
  $fileAcl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($fileAcl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))) {
    $fileAcl.RemoveAccessRuleSpecific($rule)
  }
  foreach ($sid in @($userSid, $systemSid)) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
    $fileAcl.AddAccessRule($rule)
  }
  $stage = 'apply file ACL'
  [System.IO.File]::SetAccessControl($secretFile, $fileAcl)
  $stage = 'verify file ACL'
  $stream = [System.IO.File]::Open($secretFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  Assert-PrivateAcl $secretFile $false $stream

  $stage = 'URL validation'
  $secureUrl = Read-Host 'Paste the replay DATABASE_URL (input hidden)' -AsSecureString
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
  $plainUrl = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  $bstr = [IntPtr]::Zero

  if ([string]::IsNullOrWhiteSpace($plainUrl)) {
    throw 'DATABASE_URL is empty.'
  }
  $plainUrl = $plainUrl.Trim().Trim('"').Trim("'")

  $uri = $null
  try {
    $uri = [System.Uri]::new($plainUrl)
  } catch {
    throw 'DATABASE_URL format is invalid.'
  }

  if ($uri.Scheme -ne 'postgresql' -and $uri.Scheme -ne 'postgres') {
    throw 'DATABASE_URL scheme must be postgresql:// or postgres://.'
  }

  $hostName = 'ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech'
  $actualHost = $uri.Host.ToLowerInvariant()
  if ($actualHost.Contains('-pooler')) {
    throw 'Connection pooler endpoint (-pooler) is not allowed; direct endpoint is required.'
  }
  if ($actualHost -ne $hostName) {
    throw ('Host does not match the approved Neon replay host: ' + $hostName)
  }

  if ($uri.Port -ne -1 -and $uri.Port -ne 5432) {
    throw 'Port must be 5432 or default (omitted).'
  }

  $actualDb = [System.Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/')).TrimEnd('/')
  if ($actualDb -ne 'cardapio_digital_test') {
    throw 'Database name must be cardapio_digital_test.'
  }

  $userInfo = $uri.UserInfo
  if ([string]::IsNullOrEmpty($userInfo) -or -not $userInfo.Contains(':')) {
    throw 'DATABASE_URL must contain user credentials (username:password).'
  }
  $colonIndex = $userInfo.IndexOf(':')
  $rawUser = $userInfo.Substring(0, $colonIndex)
  $rawPassword = $userInfo.Substring($colonIndex + 1)
  $actualUser = [System.Uri]::UnescapeDataString($rawUser)
  if ($actualUser -ne 'cardapio_migrator') {
    throw 'User must be cardapio_migrator.'
  }
  if ($rawPassword.Length -eq 0) {
    throw 'Password must not be empty.'
  }
  if ($rawPassword.Contains('"') -or $rawPassword.Contains("`r") -or $rawPassword.Contains("`n") -or $rawPassword -match '\s') {
    throw 'Password contains invalid characters or whitespace.'
  }
  $plainPassword = [System.Uri]::UnescapeDataString($rawPassword)
  if ([string]::IsNullOrEmpty($plainPassword)) {
    throw 'Password must not be empty.'
  }

  $allowedParams = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  @('sslmode', 'channel_binding', 'sslaccept', 'schema', 'connect_timeout', 'connection_limit', 'pool_timeout', 'sslcert') | ForEach-Object { [void]$allowedParams.Add($_) }
  $queryParams = @{}
  $queryString = $uri.Query.TrimStart('?')
  if (-not [string]::IsNullOrEmpty($queryString)) {
    foreach ($part in $queryString.Split('&')) {
      if ([string]::IsNullOrWhiteSpace($part)) { continue }
      $kv = $part.Split('=', 2)
      $key = [System.Uri]::UnescapeDataString($kv[0]).ToLowerInvariant()
      $val = if ($kv.Length -gt 1) { [System.Uri]::UnescapeDataString($kv[1]) } else { '' }
      if (-not $allowedParams.Contains($key)) {
        throw ('URL contains unapproved query parameter: ' + $key)
      }
      $queryParams[$key] = $val
    }
  }

  if (-not $queryParams.ContainsKey('sslmode')) {
    throw 'sslmode parameter is required in DATABASE_URL.'
  }
  $validSslModes = @('require', 'verify-ca', 'verify-full')
  if ($validSslModes -notcontains $queryParams['sslmode']) {
    throw 'sslmode must be require, verify-ca, or verify-full.'
  }
  if ($queryParams.ContainsKey('sslaccept') -and $queryParams['sslaccept'] -ne 'strict') {
    throw 'sslaccept must be strict when specified.'
  }
  if ($queryParams.ContainsKey('schema') -and $queryParams['schema'] -ne 'public') {
    throw 'schema must be public when specified.'
  }
  if ($queryParams.ContainsKey('channel_binding')) {
    $cb = $queryParams['channel_binding']
    if ($cb -ne 'require' -and $cb -ne 'prefer') {
      throw 'channel_binding must be require or prefer when specified.'
    }
  }
  foreach ($intKey in @('connect_timeout', 'connection_limit', 'pool_timeout')) {
    if ($queryParams.ContainsKey($intKey)) {
      $parsedInt = 0
      if (-not [int]::TryParse($queryParams[$intKey], [ref]$parsedInt) -or $parsedInt -le 0) {
        throw ($intKey + ' must be a positive integer.')
      }
    }
  }

  $stage = 'UTF-8 write and verification'
  $contents = @(
    'DATABASE_URL="' + $plainUrl + '"'
    'EXPECTED_DATABASE_HOST="' + $hostName + '"'
    'EXPECTED_CLUSTER_ID="81c4dfc1-1f0d-4e34-b31c-865e769f553e"'
    'EXPECTED_PROJECT_ID="aged-scene-47291697"'
  ) -join "`n"
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false, $true)
  $bytes = $utf8NoBom.GetBytes($contents + "`n")
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush($true)
  Assert-PrivateAcl $secretFile $false $stream
  $stream.Position = 0
  $checkBytes = New-Object byte[] $bytes.Length
  $readCount = $stream.Read($checkBytes, 0, $checkBytes.Length)
  if ($readCount -ne $bytes.Length) { throw 'Written content verification failed.' }
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    if ($bytes[$i] -ne $checkBytes[$i]) { throw 'Written content verification failed.' }
  }
  if ($bytes.Length -lt 3 -or ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)) {
    throw 'UTF-8 without BOM verification failed.'
  }
  $null = $utf8NoBom.GetString($bytes)
  $stream.Dispose()
  $stream = $null
  Write-Host 'Replay secrets prepared with verified NTFS ACL and UTF-8 without BOM.'
  Write-Host ('Set CARDAPIO_SECRETS_DIR to: ' + $secretDir)
} catch {
  $cleanupFailed = $false
  if ($stream) { $stream.Dispose(); $stream = $null }
  if ($createdFile) {
    try { [System.IO.File]::Delete($secretFile) } catch { $cleanupFailed = $true }
  }
  if ($createdDir) {
    try { [System.IO.Directory]::Delete($secretDir) } catch { $cleanupFailed = $true }
  }
  if ($cleanupFailed) {
    throw ('Preparation failed; inspect and remove the restricted directory manually: ' + $secretDir)
  }
  $reason = if ($_.Exception -and $_.Exception.Message) { ': ' + $_.Exception.Message } else { '' }
  throw ('Replay secrets preparation failed at ' + $stage + $reason + '; any created file and directory were removed.')
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
  if ($checkBytes) { [Array]::Clear($checkBytes, 0, $checkBytes.Length) }
  $plainUrl = $null
  $secureUrl = $null
  $rawPassword = $null
  $plainPassword = $null
  $encodedPassword = $null
  $userInfo = $null
  $contents = $null
  $bytes = $null
  $checkBytes = $null
}
