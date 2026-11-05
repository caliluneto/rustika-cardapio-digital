#requires -Version 5.1
# Testes exclusivamente offline: compila binários fictícios em diretório temporário.
param([string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$executor = Join-Path $PSScriptRoot 'Invoke-Rf004InitialLab.ps1'
$backend = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
. $executor -Lab rf004_lab_pos_20261027_01 -DryRun | Out-Null
Initialize-ProcessGuard
$root = Join-Path 'C:\Users\u1n3c\AppData\Local\Temp\opencode' ("rf004_mock_{0}" -f [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
$source = @'
using System;
using System.IO;
using System.Threading;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
// Apenas um desafio de autenticação fictício. Nunca aceita SQL nem encaminha conexões.
public sealed class Rf004FakeAuth : IDisposable {
  readonly TcpListener listener;
  readonly Task<bool> worker;
  public int Port { get; private set; }
  public volatile string Stage = "listening";
  static byte[] Read(NetworkStream s, int count) {
    if (count < 0 || count > 8192) throw new InvalidOperationException("Probe length");
    var bytes = new byte[count];
    for (int offset = 0; offset < count;) {
      int got = s.Read(bytes, offset, count - offset);
      if (got == 0) throw new IOException("Probe EOF");
      offset += got;
    }
    return bytes;
  }
  static int Length(NetworkStream s) { return IPAddress.NetworkToHostOrder(BitConverter.ToInt32(Read(s, 4), 0)); }
  public Rf004FakeAuth(string password) {
    listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    Port = ((IPEndPoint)listener.LocalEndpoint).Port;
    worker = Task.Factory.StartNew(() => {
      using (var peer = listener.AcceptTcpClient()) using (var s = peer.GetStream()) {
        Stage = "connected";
        s.ReadTimeout = 5000; s.WriteTimeout = 5000;
        byte[] startup = Read(s, Length(s) - 4);
        // libpq 18 pode iniciar protocolo 3.2, além de 3.0; ambos usam este desafio.
        if (startup.Length < 4 || (IPAddress.NetworkToHostOrder(BitConverter.ToInt32(startup, 0)) >> 16) != 3)
          return false;
        string parameters = Encoding.UTF8.GetString(startup, 4, startup.Length - 4);
        Stage = "startup";
        if (!parameters.Contains("user\0rf004_fake\0") || !parameters.Contains("database\0rf004_fake\0")) return false;
        // AuthenticationCleartextPassword: somente senha fictícia, em socket local próprio.
        byte[] challenge = { (byte)'R', 0,0,0,8, 0,0,0,3 };
        s.Write(challenge, 0, challenge.Length);
        Stage = "challenge";
        if (s.ReadByte() != (byte)'p') return false;
        byte[] response = Read(s, Length(s) - 4);
        bool match = Encoding.UTF8.GetString(response) == password + "\0";
        Stage = match ? "matched" : "mismatch";
        Array.Clear(response, 0, response.Length);
        // Fechar sem AuthenticationOk impede envio/execução de SQL.
        return match;
      }
    }, TaskCreationOptions.LongRunning);
  }
  public bool Finish() { return worker.Wait(6000) && worker.GetAwaiter().GetResult(); }
  public void Dispose() { listener.Stop(); try { worker.Wait(6000); } catch (AggregateException) {} }
}
public class Mock {
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
  public static int Main(string[] args) {
    var dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    var mode = Path.GetFileName(dir);
    var name = Path.GetFileName(Environment.GetCommandLineArgs()[0]);
    if (name.Equals("psql.exe", StringComparison.OrdinalIgnoreCase)) {
      if (args.Length == 1 && args[0] == "--version") { Console.WriteLine("psql (PostgreSQL) 18.6"); return 0; }
      if (GetConsoleWindow() != IntPtr.Zero) return 16;
      var password = Environment.GetEnvironmentVariable("PGPASSWORD");
      if (password != "offline_fake_password") return 10;
      if (!string.Join(" ", args).Contains("-X -w -q -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U cardapio_migrator -d rf004_lab_pos_20261027_01 -c")) return 15;
      var sql = args[args.Length - 1];
      bool post = sql.Contains("finished_at IS NOT NULL");
      if (post && !sql.Contains("[[:space:]()\"]")) return 11;
      if (mode == "pre_fail" && !post || mode == "post_fail" && post) Console.WriteLine("f");
      else Console.WriteLine("t");
      Console.Error.WriteLine("offline_fake_password SECRET_URL");
      File.AppendAllText(Path.Combine(dir, "calls.log"), post ? "post\n" : "pre\n");
      if (mode == "psql_exit") return 17;
      return 0;
    }
    if (!name.Equals("node.exe", StringComparison.OrdinalIgnoreCase)) return 12;
    if (mode == "spawn" || mode == "supervisor_death") {
      if (args.Length > 0 && args[0] == "--child") { Thread.Sleep(30000); return 0; }
      var nestedInfo = new ProcessStartInfo(Path.Combine(dir, "node.exe"), "--child");
      nestedInfo.UseShellExecute = false; nestedInfo.CreateNoWindow = true;
      var nested = Process.Start(nestedInfo);
      File.WriteAllText(Path.Combine(dir, "parent.pid"), Process.GetCurrentProcess().Id.ToString());
      File.WriteAllText(Path.Combine(dir, "spawn.pid"), nested.Id.ToString());
      Thread.Sleep(30000);
      return 0;
    }
    if (mode == "timeout") { Thread.Sleep(10000); return 0; }
    if (mode == "flood") { Console.Write(new string('x', 8192)); return 0; }
    var url = Environment.GetEnvironmentVariable("DATABASE_URL") ?? "";
    if (url != "postgresql://cardapio_migrator:offline_fake_password@127.0.0.1:5432/rf004_lab_pos_20261027_01?schema=public" ||
        Environment.GetEnvironmentVariable("SHADOW_DATABASE_URL") != "postgresql://disabled:disabled@127.0.0.1:1/no_shadow" ||
        Environment.GetEnvironmentVariable("NODE_OPTIONS") != null ||
        Environment.GetEnvironmentVariable("PGPASSWORD") != null ||
        !string.Join(" ", args).Contains("migrate deploy --schema") ||
        !string.Join(" ", args).Contains("--config")) return 13;
    File.AppendAllText(Path.Combine(dir, "calls.log"), "deploy\n");
    Console.WriteLine("offline_fake_password SECRET_URL");
    Console.Error.WriteLine("offline_fake_password SECRET_URL");
    if (mode == "deploy_fail") return 14;
    return 0;
  }
}
'@
$binary = Join-Path $root 'mock.exe'
Add-Type -TypeDefinition $source -OutputAssembly $binary -OutputType ConsoleApplication
$null = [Reflection.Assembly]::LoadFrom($binary)
$hash = (Get-FileHash -LiteralPath (Join-Path $backend 'prisma\migrations\20261023000000_initial_schema\migration.sql') -Algorithm SHA256).Hash
$originalPath = $env:PATH
$realNode = (Get-Command node.exe).Source
$successStaging = $null
try {
    foreach ($mode in @('success', 'pre_fail', 'deploy_fail', 'post_fail', 'psql_exit')) {
        $folder = Join-Path $root $mode
        $null = New-Item -ItemType Directory -Path $folder
        Copy-Item -LiteralPath $binary -Destination (Join-Path $folder 'psql.exe')
        Copy-Item -LiteralPath $binary -Destination (Join-Path $folder 'node.exe')
        $env:PATH = "$folder;$originalPath"
        $wrapper = "`$env:NODE_OPTIONS = '--require=external-untrusted'; " +
            "`$env:PGPASSWORD = 'external-untrusted'; " +
            "`$env:DATABASE_URL = 'postgresql://fake:fake@127.0.0.1/protected'; " +
            "function global:Read-Host { param(`$Prompt, [switch]`$AsSecureString) " +
            "if (`$AsSecureString) { ConvertTo-SecureString 'offline_fake_password' -AsPlainText -Force } " +
            "else { 'rf004_lab_pos_20261027_01' } }; " +
            "& '$($executor.Replace("'", "''"))' -Lab rf004_lab_pos_20261027_01 " +
            "-Execute -ApprovedInitialSha256 $hash"
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = (Get-Command powershell.exe).Source
        $psi.Arguments = '-NoProfile -EncodedCommand ' + [Convert]::ToBase64String(
            [Text.Encoding]::Unicode.GetBytes($wrapper))
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $child = [Diagnostics.Process]::Start($psi)
        $outTask = $child.StandardOutput.ReadToEndAsync()
        $errTask = $child.StandardError.ReadToEndAsync()
        if (-not $child.WaitForExit(20000)) {
            $child.Kill()
            $child.WaitForExit()
            throw "Teste $mode excedeu tempo: $($outTask.Result + $errTask.Result -replace 'offline_fake_password|SECRET_URL|external-untrusted', '[redacted]')"
        }
        $stdout = $outTask.GetAwaiter().GetResult()
        $stderr = $errTask.GetAwaiter().GetResult()
        $calls = @(Get-Content -LiteralPath (Join-Path $folder 'calls.log'))
        $expected = switch ($mode) {
            success { @('pre', 'deploy', 'post') }
            pre_fail { @('pre') }
            deploy_fail { @('pre', 'deploy') }
            post_fail { @('pre', 'deploy', 'post') }
            psql_exit { @('pre') }
        }
        if ($mode -ne 'success') {
            $expectedCode = switch ($mode) {
                pre_fail { 'RF004_CATALOG_REJECTED' }
                post_fail { 'RF004_CATALOG_REJECTED' }
                deploy_fail { 'RF004_PRISMA_EXIT' }
                psql_exit { 'RF004_PSQL_EXIT' }
            }
            if ($stderr -notmatch $expectedCode) { throw "Diagnóstico seguro ausente: $mode" }
        }
        if (($calls -join ',') -cne ($expected -join ',') -or
            ($child.ExitCode -eq 0) -ne ($mode -eq 'success') -or
            ($stdout -match 'OK:') -ne ($mode -eq 'success') -or
            ($stdout + $stderr) -match 'offline_fake_password|SECRET_URL|external-untrusted') {
            throw "Falha no teste $mode`: exit=$($child.ExitCode); chamadas=$($calls -join ','); stdout=$stdout; stderr=$stderr"
        }
        "MOCK $mode`: OK (exit=$($child.ExitCode); $($calls -join ','))"
        if ($mode -eq 'success') {
            if ($stdout -notmatch 'Staging preservado em (.+)') { throw 'Staging de sucesso não identificado.' }
            $successStaging = $Matches[1].Trim()
        }
    }
    # A API real instalada resolve configuração/package.json sem conexão de banco.
    $env:RF004_CONFIG_ROOT = $successStaging
    $env:RF004_CONFIG_MODULE = Join-Path $backend 'node_modules\@prisma\config\dist\index.js'
    $verify = @'
const path = require('path');
const fs = require('fs');
const {createRequire} = require('module');
const root = process.env.RF004_CONFIG_ROOT;
const api = require(process.env.RF004_CONFIG_MODULE);
(async () => {
  const pkg = await api.loadConfigFromPackageJson(root);
  const found = createRequire(process.env.RF004_CONFIG_MODULE)('empathic/package').up({cwd:root});
  const result = await api.loadConfigFromFile({configRoot:root, configFile:path.join(root,'prisma.config.js')});
  if (result.error || pkg !== null || found !== path.join(root,'package.json') ||
      result.resolvedPath !== path.join(root,'prisma.config.js') ||
      result.config.schema !== path.join(root,'prisma','schema.prisma') ||
      result.config.migrations.path !== path.join(root,'prisma','migrations') ||
      result.config.datasource || fs.existsSync(path.join(root,'.env')) ||
      fs.existsSync(path.join(root,'prisma','.env')) ||
      fs.existsSync(path.join(root,'prisma.config.ts'))) throw new Error('Config resolution mismatch');
  console.log('PRISMA CONFIG: explicit js + local package marker + staging-only paths; no env files');
})().catch(() => { console.error('Config resolution failed'); process.exitCode = 1; });
'@
    $info = New-IsolatedProcess -Executable $realNode -WorkingDirectory $successStaging -Arguments (
        '-e "' + $verify.Replace('"', '\"') + '"')
    $info.EnvironmentVariables['RF004_CONFIG_ROOT'] = $successStaging
    $info.EnvironmentVariables['RF004_CONFIG_MODULE'] = Join-Path $backend 'node_modules\@prisma\config\dist\index.js'
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $verification = $null
    try { $rc = [Rf004ProcessGuardB4]::Run($info, $null, 15000, 8192, $true, [ref]$verification) }
    finally { $info.EnvironmentVariables.Clear() }
    if ($rc -ne 0) { throw "Teste da configuração Prisma falhou (sem conexão)." }
    $verification
    foreach ($mode in @('timeout', 'flood', 'spawn')) {
        $folder = Join-Path $root $mode
        $null = New-Item -ItemType Directory -Path $folder
        Copy-Item -LiteralPath $binary -Destination (Join-Path $folder 'node.exe')
        $info = New-IsolatedProcess -Executable (Join-Path $folder 'node.exe') -WorkingDirectory $folder -Arguments ''
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $output = $null
        $failed = $false
        $limitMs = if ($mode -eq 'spawn') { 2000 } else { 250 }
        try { $null = [Rf004ProcessGuardB4]::Run($info, $null, $limitMs, 4096, $false, [ref]$output) }
        catch {
            $failed = $true
            $expectedCode = if ($mode -eq 'flood') { 'RF004_PROCESS_OUTPUT_LIMIT' } else { 'RF004_PROCESS_TIMEOUT' }
            if ((Get-SafeFailureCode -Exception $_.Exception) -cne $expectedCode) { throw "Diagnóstico de limite incorreto: $mode" }
        }
        if (-not $failed -or $output) { throw "Limite $mode não interrompeu filho com saída oculta." }
        if ($mode -eq 'spawn') {
            $nestedPid = [int][IO.File]::ReadAllText((Join-Path $folder 'spawn.pid'))
            try {
                $nested = [Diagnostics.Process]::GetProcessById($nestedPid)
                if (-not $nested.HasExited) { throw 'Job Object não encerrou descendente do mock.' }
            }
            catch [ArgumentException] { # Processo já saiu: resultado esperado.
            }
        }
        "MOCK $mode`: OK (filho isolado interrompido)"
    }

    # Morte do supervisor: somente executáveis fictícios, com handles mantidos para evitar PID reutilizado.
    $folder = Join-Path $root 'supervisor_death'
    $null = New-Item -ItemType Directory -Path $folder
    Copy-Item -LiteralPath $binary -Destination (Join-Path $folder 'node.exe')
    $wrapper = ". '$($executor.Replace("'", "''"))' -Lab rf004_lab_pos_20261027_01 -DryRun | Out-Null; " +
        "Initialize-ProcessGuard; " +
        "`$i = New-IsolatedProcess -Executable '$($folder.Replace("'", "''"))\node.exe' -WorkingDirectory '$($folder.Replace("'", "''"))' -Arguments ''; " +
        "`$i.RedirectStandardOutput = `$true; `$i.RedirectStandardError = `$true; `$o = `$null; " +
        "[Rf004ProcessGuardB4]::Run(`$i, `$null, 60000, 4096, `$false, [ref]`$o) | Out-Null"
    $psi = New-IsolatedProcess -Executable (Get-Command powershell.exe).Source -WorkingDirectory $folder -Arguments (
        '-NoProfile -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($wrapper)))
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $supervisor = [Diagnostics.Process]::Start($psi)
    $outTask = $supervisor.StandardOutput.ReadToEndAsync()
    $errTask = $supervisor.StandardError.ReadToEndAsync()
    $owned = @()
    try {
        $watch = [Diagnostics.Stopwatch]::StartNew()
        while (-not (Test-Path -LiteralPath (Join-Path $folder 'spawn.pid'))) {
            if ($supervisor.HasExited -or $watch.ElapsedMilliseconds -gt 12000) { throw 'Supervisor fictício não iniciou descendentes.' }
            Start-Sleep -Milliseconds 50
        }
        foreach ($name in @('parent.pid', 'spawn.pid')) {
            $proc = [Diagnostics.Process]::GetProcessById([int][IO.File]::ReadAllText((Join-Path $folder $name)))
            $null = $proc.Handle
            $owned += $proc
        }
        $supervisor.Kill()
        if (-not $supervisor.WaitForExit(5000)) { throw 'Supervisor fictício não terminou.' }
        foreach ($proc in $owned) {
            if (-not $proc.WaitForExit(5000)) { throw 'KILL_ON_JOB_CLOSE não encerrou processo fictício.' }
        }
        'MOCK supervisor_death: OK (filho e neto encerrados após Kill do supervisor)'
    }
    finally {
        if (-not $supervisor.HasExited) { $supervisor.Kill(); $null = $supervisor.WaitForExit(5000) }
        foreach ($proc in $owned) {
            if (-not $proc.HasExited) { $proc.Kill(); $null = $proc.WaitForExit(5000) }
            $proc.Dispose()
        }
        $supervisor.Dispose()
    }

    # Teste de ancestral real via junction, inteiramente dentro da raiz temporária desta suíte.
    $target = Join-Path $root 'junction_target'
    $link = Join-Path $root 'junction_link'
    $null = New-Item -ItemType Directory -Path (Join-Path $target 'nested')
    $null = New-Item -ItemType Junction -Path $link -Target $target
    Assert-NoReparseAncestors -Path (Join-Path $target 'nested')
    $rejected = $false
    try { Assert-NoReparseAncestors -Path (Join-Path $link 'nested') }
    catch { $rejected = (Get-SafeFailureCode -Exception $_.Exception) -ceq 'RF004_STAGING_REPARSE' }
    if (-not $rejected) { throw 'Ancestral junction não foi recusado.' }
    'REPARSE: OK (ancestral junction recusado; diretório normal aceito)'

    # Inspeção estática: não equivale a executar estas consultas no PostgreSQL.
    $pre = Get-PreflightSql
    $post = Get-PostflightSql
    foreach ($sql in @($pre, $post)) {
        foreach ($required in @('SET LOCAL search_path = pg_catalog, public;',
                'SET LOCAL quote_all_identifiers = off;', 'pg_auth_members',
                "pg_has_role(app.oid, owner_role.oid, 'SET')", "pg_has_role(app.oid, owner_role.oid, 'USAGE')",
                'r.rolsuper OR r.rolcreaterole')) {
            if (-not $sql.Contains($required)) { throw 'Controle SQL estático ausente.' }
        }
        if ($sql -match '__ROLE_ISOLATION__|__COLUMN_SIGNATURE__') { throw 'SQL contém marcador não resolvido.' }
        if ($sql.Length -gt 30000) { throw 'SQL excede margem segura para argv no Windows.' }
    }
    foreach ($required in @('aclexplode(col.attacl)', 'has_any_column_privilege(app.oid',
            'acl.grantee <> t.relowner', "('_prisma_migrations')) AS expected(table_name)",
            'a.atttypid IS DISTINCT FROM', 'a.atttypmod IS DISTINCT FROM',
            'a.attnotnull IS DISTINCT FROM', 'a.default_expr IS DISTINCT FROM', 'FULL JOIN actual')) {
        if (-not $post.Contains($required)) { throw 'Assinatura/ACL SQL estática incompleta.' }
    }
    $signature = Get-ColumnSignaturePredicate
    $manifest = [regex]::Matches($signature, "(?m)^\s*\('([^']+)',(\d+),'([^']+)',")
    if ($manifest.Count -ne 60) { throw 'Quantidade de colunas do baseline incorreta.' }
    # Fonte SQL independente do schema posterior: todas as 52 colunas da inicial devem estar no manifesto.
    $initialSql = [IO.File]::ReadAllText($sourceSql)
    foreach ($table in [regex]::Matches($initialSql, '(?s)CREATE TABLE "([^"]+)" \((.*?)\r?\n\);')) {
        $position = 0
        foreach ($col in [regex]::Matches($table.Groups[2].Value, '(?m)^\s*"([^"]+)"\s+')) {
            $position++
            $prefix = "('$($table.Groups[1].Value)',$position,'$($col.Groups[1].Value)',"
            if (-not $signature.Contains($prefix)) { throw 'Manifesto diverge das colunas da migration inicial.' }
        }
    }
    'STATIC SQL: OK (ACL por coluna, memberships/SET ROLE, sessão normalizada, 60 colunas; sem execução SQL)'

    foreach ($file in @($executor, $PSCommandPath)) {
        $tokens = $null; $errors = $null
        $null = [Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$errors)
        if ($errors.Count) { throw 'Parser PowerShell recusou arquivo.' }
    }
    foreach ($labName in @('rf004_lab_pos_20261027_01', 'rf004_lab_neg_20261027_01')) {
        $dry = & $executor -Lab $labName
        if (($dry -join ' ') -notmatch 'DRY RUN:') { throw 'DryRun padrão falhou.' }
    }
    'PARSER/DRYRUN: OK (PowerShell 5.1; ambos os laboratórios, sem Execute)'

    $allowlistRejected = $false
    try { & $executor -Lab 'cardapio_digital_test' -DryRun | Out-Null }
    catch [Management.Automation.ParameterBindingException] { $allowlistRejected = $true }
    if (-not $allowlistRejected) { throw 'Allowlist aceitou banco protegido.' }
    $ApprovedInitialSha256 = ('0' * 64)
    $hashRejected = $false
    try { Assert-ApprovedHash }
    catch { $hashRejected = (Get-SafeFailureCode -Exception $_.Exception) -ceq 'RF004_SOURCE_HASH' }
    finally { $ApprovedInitialSha256 = $null }
    if (-not $hashRejected) { throw 'Hash divergente não foi recusado.' }
    foreach ($invalidPassword in @('', "fake`npassword", ('x' * 257))) {
        $formatRejected = $false
        try { Assert-PasswordFormat -Value $invalidPassword }
        catch { $formatRejected = (Get-SafeFailureCode -Exception $_.Exception) -ceq 'RF004_PASSWORD_FORMAT' }
        if (-not $formatRejected) { throw 'Formato de senha inválido aceito.' }
    }
    'LOCAL GUARDS: OK (banco protegido, hash divergente e formatos de senha recusados)'

    # Cliente PostgreSQL real, mas sem servidor PostgreSQL: somente listener fictício próprio.
    if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) { throw 'Cliente psql 18.6 ausente; prova de autenticação pendente.' }
    $info = New-IsolatedProcess -Executable $PsqlPath -WorkingDirectory $root -Arguments '--version'
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $version = $null
    $rc = [Rf004ProcessGuardB4]::Run($info, $null, 5000, 4096, $true, [ref]$version)
    if ($rc -ne 0 -or $version -notmatch '^psql \(PostgreSQL\) 18\.6(?:\s.*)?$') { throw 'Cliente exige versão 18.6 para esta prova.' }
    $unicodeRejected = $false
    try { Assert-PasswordFormat -Value 'offline_á漢' }
    catch { $unicodeRejected = (Get-SafeFailureCode -Exception $_.Exception) -ceq 'RF004_PASSWORD_FORMAT' }
    if (-not $unicodeRejected) { throw 'Senha Unicode deve ser recusada antes de conectar.' }
    foreach ($fakePassword in @('offline_fake_password', 'offline space:@/%?\"')) {
        Assert-PasswordFormat -Value $fakePassword
        $probe = New-Object Rf004FakeAuth($fakePassword)
        try {
            $info = New-IsolatedProcess -Executable $PsqlPath -WorkingDirectory $root -Arguments (
                '-X -w -q -A -t -h 127.0.0.1 -p ' + $probe.Port + ' -U rf004_fake -d rf004_fake -c "SELECT 1"')
            # Desabilita fontes externas de autenticação; nenhuma credencial real é consultada.
            $info.EnvironmentVariables['PGSSLMODE'] = 'disable'
            $info.EnvironmentVariables['PGGSSENCMODE'] = 'disable'
            $info.EnvironmentVariables['PGPASSFILE'] = Join-Path $root 'nonexistent.pgpass'
            $info.EnvironmentVariables['APPDATA'] = $root
            $info.EnvironmentVariables['USERPROFILE'] = $root
            $info.EnvironmentVariables['PGPASSWORD'] = $fakePassword
            $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
            $result = $null
            $rc = [Rf004ProcessGuardB4]::Run($info, $null, 10000, 4096, $true, [ref]$result)
            if ($rc -eq 0 -or $result -or -not $probe.Finish()) { throw 'Prova de autenticação do psql falhou.' }
        }
        catch { throw ('Prova psql: stage=' + $probe.Stage + '; code=' + (Get-SafeFailureCode -Exception $_.Exception)) }
        finally { $probe.Dispose(); $info.EnvironmentVariables.Clear() }
    }
    'PSQL 18.6 AUTH: OK (cliente real -w, ASCII com espaços/símbolos; Unicode recusado localmente; listener fictício; nenhum SQL aceito)'
}
finally {
    $env:PATH = $originalPath
    $env:RF004_CONFIG_ROOT = $null
    $env:RF004_CONFIG_MODULE = $null
}
"Artefatos de teste preservados em $root"
