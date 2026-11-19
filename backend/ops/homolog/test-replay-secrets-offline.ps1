#requires -Version 5.1
$ErrorActionPreference = 'Stop'

function Validate-ReplayUrl([string]$plainUrl) {
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
  return 'VALID'
}

$script:passCount = 0
$script:failCount = 0

function Assert-Result([string]$name, [string]$url, [bool]$shouldPass, [string]$expectedPattern = '') {
  try {
    $res = Validate-ReplayUrl $url
    if ($shouldPass) {
      Write-Output "  PASS: $name"
      $script:passCount++
    } else {
      Write-Output "  FAIL: $name (expected rejection but passed)"
      $script:failCount++
    }
  } catch {
    if (-not $shouldPass) {
      $errMsg = $_.Exception.Message
      if ($expectedPattern -and $errMsg -notmatch $expectedPattern) {
        Write-Output "  FAIL: $name (msg '$errMsg' did not match '$expectedPattern')"
        $script:failCount++
      } else {
        Write-Output "  PASS: $name (rejected: $errMsg)"
        $script:passCount++
      }
    } else {
      Write-Output "  FAIL: $name (unexpected rejection: $($_.Exception.Message))"
      $script:failCount++
    }
  }
}

Write-Output "Running offline Replay URL validation tests..."

# Official Neon formats
Assert-Result "Neon official standard" `
  "postgresql://cardapio_migrator:FakeNeonPasswordOf32AlphanumChars12@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech/cardapio_digital_test?sslmode=require&channel_binding=require" $true

Assert-Result "Neon official with port 5432" `
  "postgresql://cardapio_migrator:FakeNeonPasswordOf32AlphanumChars12@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech:5432/cardapio_digital_test?sslmode=require&channel_binding=require" $true

Assert-Result "Neon official with postgres:// scheme" `
  "postgres://cardapio_migrator:FakeNeonPasswordOf32AlphanumChars12@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech/cardapio_digital_test?sslmode=require&channel_binding=require" $true

Assert-Result "Previous strict format" `
  "postgresql://cardapio_migrator:FakeNeonPasswordOf32AlphanumChars12@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech:5432/cardapio_digital_test?schema=public&sslmode=require&sslaccept=strict" $true

Assert-Result "Neon with percent-encoded password" `
  "postgresql://cardapio_migrator:Fake%40Pass%23Word%24Of32Chars12345678@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech/cardapio_digital_test?sslmode=require&channel_binding=require" $true

Assert-Result "Neon with sslmode=verify-full" `
  "postgresql://cardapio_migrator:FakeNeonPasswordOf32AlphanumChars12@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech/cardapio_digital_test?sslmode=verify-full&channel_binding=require" $true

Assert-Result "URL wrapped in quotes and spaces" `
  '  "postgresql://cardapio_migrator:FakeNeonPasswordOf32AlphanumChars12@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech/cardapio_digital_test?sslmode=require&channel_binding=require"  ' $true

# Rejections
Assert-Result "Reject pooler host" `
  "postgresql://cardapio_migrator:FakeNeonPasswordOf32AlphanumChars12@ep-sweet-king-bd7i7ypb-pooler.c-8.us-east-2.aws.neon.tech/cardapio_digital_test?sslmode=require" `
  $false "pooler"

Assert-Result "Reject wrong host" `
  "postgresql://cardapio_migrator:FakeNeonPasswordOf32AlphanumChars12@ep-other-host.c-8.us-east-2.aws.neon.tech/cardapio_digital_test?sslmode=require" `
  $false "Host does not match"

Assert-Result "Reject wrong port" `
  "postgresql://cardapio_migrator:FakeNeonPasswordOf32AlphanumChars12@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech:5433/cardapio_digital_test?sslmode=require" `
  $false "Port must be 5432"

Assert-Result "Reject wrong database (neondb)" `
  "postgresql://cardapio_migrator:FakeNeonPasswordOf32AlphanumChars12@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require" `
  $false "Database name must be cardapio_digital_test"

Assert-Result "Reject wrong role (neondb_owner)" `
  "postgresql://neondb_owner:FakeNeonPasswordOf32AlphanumChars12@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech/cardapio_digital_test?sslmode=require" `
  $false "User must be cardapio_migrator"

Assert-Result "Accept existing 16-character password" `
  "postgresql://cardapio_migrator:NeonPass12345678@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech/cardapio_digital_test?sslmode=require&channel_binding=require" $true

Assert-Result "Reject empty password" `
  "postgresql://cardapio_migrator:@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech/cardapio_digital_test?sslmode=require&channel_binding=require" `
  $false "Password must not be empty"

Assert-Result "Reject missing sslmode" `
  "postgresql://cardapio_migrator:FakeNeonPasswordOf32AlphanumChars12@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech/cardapio_digital_test?channel_binding=require" `
  $false "sslmode parameter is required"

Assert-Result "Reject sslmode=disable" `
  "postgresql://cardapio_migrator:FakeNeonPasswordOf32AlphanumChars12@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech/cardapio_digital_test?sslmode=disable" `
  $false "sslmode must be require, verify-ca, or verify-full"

Assert-Result "Reject channel_binding=disable" `
  "postgresql://cardapio_migrator:FakeNeonPasswordOf32AlphanumChars12@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech/cardapio_digital_test?sslmode=require&channel_binding=disable" `
  $false "channel_binding must be require or prefer"

Assert-Result "Reject unknown query parameter" `
  "postgresql://cardapio_migrator:FakeNeonPasswordOf32AlphanumChars12@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech/cardapio_digital_test?sslmode=require&evil=1" `
  $false "unapproved query parameter: evil"

Assert-Result "Reject invalid scheme (http)" `
  "http://cardapio_migrator:FakeNeonPasswordOf32AlphanumChars12@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech/cardapio_digital_test?sslmode=require" `
  $false "scheme must be postgresql:// or postgres://"

Write-Output "`nTest summary: $script:passCount passed, $script:failCount failed."
if ($script:failCount -gt 0) { exit 1 }
