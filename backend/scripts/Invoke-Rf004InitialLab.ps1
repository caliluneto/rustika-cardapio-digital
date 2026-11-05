#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('rf004_lab_pos_20261027_01', 'rf004_lab_neg_20261027_01')]
    [string]$Lab,
    [switch]$DryRun,
    [switch]$Execute,
    [string]$ApprovedInitialSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$initialName = '20261023000000_initial_schema'
$backend = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sourceSql = Join-Path $backend "prisma\migrations\$initialName\migration.sql"
$sourceSchema = Join-Path $backend 'prisma\schema.prisma'
$sourceLock = Join-Path $backend 'prisma\migrations\migration_lock.toml'
$prismaCli = Join-Path $backend 'node_modules\prisma\build\index.js'
$prismaPackage = Join-Path $backend 'node_modules\prisma\package.json'
$stagingBase = 'C:\Users\u1n3c\AppData\Local\Temp\opencode'
$staging = $null
$stagingConfig = @'
module.exports = {
  schema: './prisma/schema.prisma',
  migrations: { path: './prisma/migrations' }
};
'@
$stagingPackage = '{"name":"rf004-initial-lab-staging","private":true}'

# Somente códigos fechados são publicados; nunca usar mensagens externas como diagnóstico.
function Get-SafeFailureCode {
    param([Exception]$Exception)
    while ($Exception) {
        if ($Exception.Message -cmatch '^RF004_[A-Z_]+$') { return $Exception.Message }
        $Exception = $Exception.InnerException
    }
    return 'RF004_UNEXPECTED'
}

function Assert-NoReparseAncestors {
    param([string]$Path)
    $full = [IO.Path]::GetFullPath($Path)
    $anchor = [IO.Path]::GetPathRoot($full)
    if ($anchor -notmatch '^[A-Za-z]:\\$') { throw 'RF004_STAGING_PATH' }
    $current = $anchor
    $parts = @('') + @($full.Substring($anchor.Length).Split('\', [StringSplitOptions]::RemoveEmptyEntries))
    foreach ($part in $parts) {
        if ($part) { $current = Join-Path $current $part }
        # Examina de cima para baixo, antes de atravessar qualquer ancestral.
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'RF004_STAGING_REPARSE'
        }
    }
}

function Assert-Source {
    foreach ($file in @($sourceSql, $sourceSchema, $sourceLock, $prismaCli, $prismaPackage)) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw 'RF004_SOURCE_MISSING'
        }
    }
    if (-not (Test-Path -LiteralPath $stagingBase -PathType Container)) {
        throw 'RF004_STAGING_BASE'
    }
    Assert-NoReparseAncestors -Path $stagingBase
    if ((Get-Content -LiteralPath $prismaPackage -Raw | ConvertFrom-Json).version -ne '6.19.3') {
        throw 'RF004_PRISMA_VERSION'
    }
}

function Assert-ApprovedHash {
    if ($ApprovedInitialSha256 -notmatch '^[0-9a-fA-F]{64}$') {
        throw 'RF004_HASH_REQUIRED'
    }
    $actual = (Get-FileHash -LiteralPath $sourceSql -Algorithm SHA256).Hash
    if ($actual -ne $ApprovedInitialSha256) {
        throw 'RF004_SOURCE_HASH'
    }
}

function Assert-Staging {
    param([string]$Root)
    $expectedParent = [IO.Path]::GetFullPath($stagingBase).TrimEnd('\')
    if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Root)) -ine $expectedParent -or
        [IO.Path]::GetFileName($Root) -cnotmatch ('^rf004_initial_' + [regex]::Escape($Lab) + '_[0-9a-f]{32}$')) {
        throw 'RF004_STAGING_PATH'
    }
    Assert-NoReparseAncestors -Path $Root
    $migrationRoot = Join-Path $Root 'prisma\migrations'
    $only = @(Get-ChildItem -LiteralPath $migrationRoot -Directory)
    if ($only.Count -ne 1 -or $only[0].Name -ne $initialName) {
        throw 'RF004_STAGING_CONTENT'
    }
    if (@(Get-ChildItem -LiteralPath $Root -Force).Count -ne 3 -or
        @(Get-ChildItem -LiteralPath (Join-Path $Root 'prisma') -Force).Count -ne 2 -or
        @(Get-ChildItem -LiteralPath $migrationRoot -Force).Count -ne 2 -or
        @(Get-ChildItem -LiteralPath (Join-Path $migrationRoot $initialName) -Force).Count -ne 1) {
        throw 'RF004_STAGING_CONTENT'
    }
    $allowed = @('prisma', 'prisma.config.js', 'package.json')
    foreach ($item in @(Get-ChildItem -LiteralPath $Root -Force)) {
        if ($item.Name -cnotin $allowed) { throw 'RF004_STAGING_CONTENT' }
    }
    foreach ($directory in @($Root, (Join-Path $Root 'prisma'), $migrationRoot,
            (Join-Path $migrationRoot $initialName))) {
        if ((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'RF004_STAGING_REPARSE'
        }
    }
    foreach ($file in @('prisma.config.js', 'package.json', 'prisma\schema.prisma',
            'prisma\migrations\migration_lock.toml', "prisma\migrations\$initialName\migration.sql")) {
        if ((Get-Item -LiteralPath (Join-Path $Root $file) -Force).Attributes -band
            [IO.FileAttributes]::ReparsePoint) {
            throw 'RF004_STAGING_REPARSE'
        }
    }
    if ([IO.File]::ReadAllText((Join-Path $Root 'prisma.config.js')) -cne $stagingConfig) {
        throw 'RF004_STAGING_CONFIG'
    }
    if ([IO.File]::ReadAllText((Join-Path $Root 'package.json')) -cne $stagingPackage) {
        throw 'RF004_STAGING_CONFIG'
    }
    $sqlCopy = Join-Path $migrationRoot "$initialName\migration.sql"
    if ((Get-FileHash -LiteralPath $sqlCopy -Algorithm SHA256).Hash -ne $ApprovedInitialSha256) {
        throw 'RF004_STAGING_HASH'
    }
    foreach ($name in @('prisma\.env', '.env', 'prisma.config.ts', 'prisma\prisma.config.ts')) {
        if (Test-Path -LiteralPath (Join-Path $Root $name)) {
            throw 'RF004_STAGING_CONTENT'
        }
    }
    if ((Get-FileHash -LiteralPath (Join-Path $Root 'prisma\schema.prisma') -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $sourceSchema -Algorithm SHA256).Hash) {
        throw 'RF004_STAGING_SCHEMA'
    }
    if ((Get-FileHash -LiteralPath (Join-Path $migrationRoot 'migration_lock.toml') -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $sourceLock -Algorithm SHA256).Hash) {
        throw 'RF004_STAGING_LOCK'
    }
}

# Compilado em memória: descarta o stderr, limita bytes e drena os dois pipes em paralelo.
# Somente o stdout curto do psql é mantido para comparar o resultado booleano.
function Initialize-ProcessGuard {
    if ('Rf004ProcessGuardB4' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
public static class Rf004ProcessGuardB4 {
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, uint size);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
    static string Drain(Stream stream, bool capture, ref long bytes, int limit) {
        byte[] chunk = new byte[4096];
        using (var saved = new MemoryStream()) {
            int count;
            while ((count = stream.Read(chunk, 0, chunk.Length)) > 0) {
                if (Interlocked.Add(ref bytes, count) > limit) throw new InvalidOperationException("RF004_PROCESS_OUTPUT_LIMIT");
                if (capture) saved.Write(chunk, 0, count);
            }
            return capture ? Encoding.UTF8.GetString(saved.ToArray()).Trim() : "";
        }
    }
    public static int Run(ProcessStartInfo info, string input, int timeoutMs, int maxBytes, bool capture, out string output) {
        output = null;
        long bytes = 0;
        using (var child = new Process()) {
            child.StartInfo = info;
            Task<string> stdout = null, stderr = null;
            Task writer = null;
            bool started = false;
            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new InvalidOperationException("RF004_JOB_CREATE");
            try {
                 var limits = new ExtendedLimits();
                 limits.Basic.Flags = 0x00002000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                 if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))))
                     throw new InvalidOperationException("RF004_JOB_LIMITS");
                 if (!child.Start()) throw new InvalidOperationException("RF004_PROCESS_START");
                 started = true;
                 if (!AssignProcessToJobObject(job, child.Handle))
                     throw new InvalidOperationException("RF004_JOB_ASSIGN");
                 var clock = Stopwatch.StartNew();
                 stdout = Task.Factory.StartNew(() => Drain(child.StandardOutput.BaseStream, capture, ref bytes, maxBytes), TaskCreationOptions.LongRunning);
                 stderr = Task.Factory.StartNew(() => Drain(child.StandardError.BaseStream, false, ref bytes, maxBytes), TaskCreationOptions.LongRunning);
                 if (info.RedirectStandardInput) {
                     writer = Task.Factory.StartNew(() => {
                         // UTF-8 sem BOM, independente da code page do console/.NET Framework.
                         byte[] data = new UTF8Encoding(false, true).GetBytes(input + "\n");
                         try {
                             child.StandardInput.BaseStream.Write(data, 0, data.Length);
                             child.StandardInput.BaseStream.Flush();
                         } finally {
                             Array.Clear(data, 0, data.Length);
                             child.StandardInput.Close();
                         }
                     }, TaskCreationOptions.LongRunning);
                 }
                 while (true) {
                     if (Interlocked.Read(ref bytes) > maxBytes)
                         throw new InvalidOperationException("RF004_PROCESS_OUTPUT_LIMIT");
                     if (stdout.IsFaulted || stderr.IsFaulted || (writer != null && writer.IsFaulted))
                         throw new InvalidOperationException("RF004_PROCESS_PIPE");
                     if (child.WaitForExit(25) && stdout.IsCompleted && stderr.IsCompleted &&
                         (writer == null || writer.IsCompleted)) break;
                     if (clock.ElapsedMilliseconds >= timeoutMs) throw new TimeoutException("RF004_PROCESS_TIMEOUT");
                 }
                 output = stdout.GetAwaiter().GetResult();
                 stderr.GetAwaiter().GetResult();
                 if (writer != null) writer.GetAwaiter().GetResult();
                 return child.ExitCode;
            } finally {
                 // O job contém apenas este filho e descendentes; não matar por nome ou PID reutilizado.
                 try {
                     if (started) {
                         if (!TerminateJobObject(job, 1))
                             throw new InvalidOperationException("RF004_JOB_TERMINATE");
                         if (!child.HasExited) child.WaitForExit(5000);
                     }
                 } finally {
                     CloseHandle(job);
                     if (started && !child.HasExited) {
                         try { child.Kill(); child.WaitForExit(5000); }
                         catch (InvalidOperationException) { /* Filho saiu entre as chamadas. */ }
                     }
                 }
            }
        }
    }
}
'@
}

function New-IsolatedProcess {
    param([string]$Executable, [string]$Arguments, [string]$WorkingDirectory)
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = $Arguments
    $info.WorkingDirectory = $WorkingDirectory
    $info.UseShellExecute = $false
    # Não abrir janelas; autenticação psql não depende de console/stdin (usa -w).
    $info.CreateNoWindow = $true
    $info.EnvironmentVariables.Clear()
    foreach ($key in @('SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA')) {
        $value = [Environment]::GetEnvironmentVariable($key)
        if ($value) { $info.EnvironmentVariables[$key] = $value }
    }
    return $info
}

function Assert-PasswordFormat {
    param([string]$Value)
    # libpq nativo no Windows pode converter ambiente Unicode pela code page ANSI.
    # Recusar antes de conectar é preferível a transmitir uma senha diferente.
    if ([string]::IsNullOrEmpty($Value) -or $Value.Length -gt 256 -or $Value -match '[^\x20-\x7e]') {
        throw 'RF004_PASSWORD_FORMAT'
    }
}

function Assert-PsqlClient {
    param([string]$Psql, [string]$Root)
    $info = New-IsolatedProcess -Executable $Psql -WorkingDirectory $Root -Arguments '--version'
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $version = $null
    try {
        $rc = [Rf004ProcessGuardB4]::Run($info, $null, 5000, 4096, $true, [ref]$version)
        if ($rc -ne 0 -or $version -cnotmatch '^psql \(PostgreSQL\) 18\.6(?:\s.*)?$') {
            throw 'RF004_PSQL_VERSION'
        }
    }
    finally { $info.EnvironmentVariables.Clear() }
}

function Invoke-CatalogCheck {
    param([string]$Psql, [string]$Sql, [string]$Root, [string]$Password)
    $info = New-IsolatedProcess -Executable $Psql -WorkingDirectory $Root -Arguments (
        '-X -w -q -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 ' +
        '-U cardapio_migrator -d ' + $Lab + ' -c "' + $Sql.Replace('"', '\"') + '"'
    )
    $noPassfile = Join-Path $Root 'pgpass-inexistente'
    if (Test-Path -LiteralPath $noPassfile) { throw 'RF004_STAGING_PASSFILE' }
    $info.EnvironmentVariables['PGPASSFILE'] = $noPassfile
    # -w impede simple_prompt/CONIN$. Segredo somente no ambiente deste filho,
    # nunca no ambiente do PowerShell, argv, staging ou processo Prisma.
    $info.EnvironmentVariables['PGPASSWORD'] = $Password
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $result = $null
    try {
        $code = [Rf004ProcessGuardB4]::Run($info, $null, 30000, 4096, $true, [ref]$result)
    }
    catch { throw (Get-SafeFailureCode -Exception $_.Exception) }
    finally { $info.EnvironmentVariables.Clear() }
    if ($code -ne 0) { throw 'RF004_PSQL_EXIT' }
    if ($result -ceq 'f') { throw 'RF004_CATALOG_REJECTED' }
    if ($result -cne 't') { throw 'RF004_CATALOG_OUTPUT' }
}

function Get-RoleIsolationPredicate {
    # Conservador: qualquer caminho de membership ao owner/role administrativa é recusado,
    # inclusive arestas com INHERIT/SET desativados ou ADMIN OPTION. Nenhum GRANT é feito.
    return @'
((SELECT count(*) FROM pg_roles WHERE rolname IN ('cardapio_dev_app','cardapio_test_app')) = 2
 AND NOT EXISTS (
    WITH RECURSIVE reachable(oid) AS (
        SELECT oid FROM pg_roles WHERE rolname IN ('cardapio_dev_app','cardapio_test_app')
        UNION
        SELECT m.roleid FROM pg_auth_members m JOIN reachable r ON m.member = r.oid
    )
    SELECT 1 FROM reachable x JOIN pg_roles r ON r.oid = x.oid
    WHERE r.rolname = 'cardapio_migrator' OR r.rolsuper OR r.rolcreaterole
       OR r.rolreplication OR r.rolbypassrls
       OR r.rolname IN ('pg_read_all_data','pg_write_all_data','pg_maintain',
                       'pg_read_server_files','pg_write_server_files','pg_execute_server_program')
 )
 AND NOT EXISTS (
    SELECT 1 FROM pg_roles app CROSS JOIN pg_roles owner_role
    WHERE app.rolname IN ('cardapio_dev_app','cardapio_test_app')
      AND owner_role.rolname = 'cardapio_migrator'
      AND (pg_has_role(app.oid, owner_role.oid, 'USAGE')
        OR pg_has_role(app.oid, owner_role.oid, 'SET')
        OR pg_has_role(app.oid, owner_role.oid, 'MEMBER'))
 ))
'@
}

function Get-PreflightSql {
    $sql = @'
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog, public;
SET LOCAL quote_all_identifiers = off;
SELECT (current_database() = '__LAB__'
    AND current_user = 'cardapio_migrator'
    AND inet_server_addr() = '127.0.0.1'::inet
    AND inet_server_port() = 5432
    AND current_setting('server_version_num') = '180006'
    AND __ROLE_ISOLATION__
    AND (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) = 'cardapio_migrator'
    AND has_database_privilege(current_user, current_database(), 'CONNECT')
    AND has_schema_privilege(current_user, 'public', 'USAGE')
    AND has_schema_privilege(current_user, 'public', 'CREATE')
    AND (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'public') = 'pg_database_owner'
    AND to_regclass('public._prisma_migrations') IS NULL
    AND NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
    )
    AND NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
    )
    AND NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
    )
    AND NOT EXISTS (
        SELECT 1 FROM pg_namespace WHERE nspname NOT IN
            ('public', 'pg_catalog', 'information_schema', 'pg_toast')
          AND nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%'
    )
    AND NOT EXISTS (SELECT 1 FROM pg_event_trigger)
    AND NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql')
    AND NOT EXISTS (
        SELECT 1 FROM pg_default_acl d
        CROSS JOIN LATERAL aclexplode(d.defaclacl) a
        WHERE d.defaclrole = 'cardapio_migrator'::regrole AND d.defaclobjtype = 'r'
          AND (d.defaclnamespace = 0 OR d.defaclnamespace = 'public'::regnamespace)
          AND a.grantee <> 'cardapio_migrator'::regrole
    )) AS ok;
ROLLBACK;
'@
    return $sql.Replace('__ROLE_ISOLATION__', (Get-RoleIsolationPredicate))
}

function Get-ColumnSignaturePredicate {
    # Baseline estático: ordem, tipos/typmod, NOT NULL e defaults das sete tabelas.
    # FULL JOIN recusa colunas extras, ausentes e vestígios de colunas removidas.
    return @'
NOT EXISTS (
    WITH expected(table_name, position, column_name, type_name, typmod, not_null, default_expr) AS (VALUES
        ('admins',1,'id','uuid',-1,true,NULL),
        ('admins',2,'name','text',-1,true,NULL),
        ('admins',3,'email','text',-1,true,NULL),
        ('admins',4,'password_hash','text',-1,true,NULL),
        ('admins',5,'is_active','boolean',-1,true,'true'),
        ('admins',6,'created_at','timestamp with time zone',6,true,'CURRENT_TIMESTAMP'),
        ('admins',7,'updated_at','timestamp with time zone',6,true,NULL),
        ('categories',1,'id','uuid',-1,true,NULL),
        ('categories',2,'name','text',-1,true,NULL),
        ('categories',3,'description','text',-1,false,NULL),
        ('categories',4,'display_order','integer',-1,true,'0'),
        ('categories',5,'is_active','boolean',-1,true,'true'),
        ('categories',6,'created_at','timestamp with time zone',6,true,'CURRENT_TIMESTAMP'),
        ('categories',7,'updated_at','timestamp with time zone',6,true,NULL),
        ('products',1,'id','uuid',-1,true,NULL),
        ('products',2,'category_id','uuid',-1,true,NULL),
        ('products',3,'name','text',-1,true,NULL),
        ('products',4,'description','text',-1,false,NULL),
        ('products',5,'ingredients','text',-1,false,NULL),
        ('products',6,'price','numeric',655366,true,NULL),
        ('products',7,'image_url','text',-1,false,NULL),
        ('products',8,'is_available','boolean',-1,true,'true'),
        ('products',9,'is_active','boolean',-1,true,'true'),
        ('products',10,'created_at','timestamp with time zone',6,true,'CURRENT_TIMESTAMP'),
        ('products',11,'updated_at','timestamp with time zone',6,true,NULL),
        ('orders',1,'id','uuid',-1,true,NULL),
        ('orders',2,'order_number','integer',-1,true,'nextval(''orders_order_number_seq''::regclass)'),
        ('orders',3,'tracking_token_hash','character',68,true,NULL),
        ('orders',4,'idempotency_key','text',-1,true,NULL),
        ('orders',5,'customer_name','text',-1,true,NULL),
        ('orders',6,'customer_phone','text',-1,false,NULL),
        ('orders',7,'table_or_reference','text',-1,true,NULL),
        ('orders',8,'notes','text',-1,false,NULL),
        ('orders',9,'status','public.order_status',-1,true,'''RECEIVED''::order_status'),
        ('orders',10,'total_amount','numeric',655366,true,NULL),
        ('orders',11,'created_at','timestamp with time zone',6,true,'CURRENT_TIMESTAMP'),
        ('orders',12,'updated_at','timestamp with time zone',6,true,NULL),
        ('order_items',1,'id','uuid',-1,true,NULL),
        ('order_items',2,'order_id','uuid',-1,true,NULL),
        ('order_items',3,'product_id','uuid',-1,true,NULL),
        ('order_items',4,'product_name_snapshot','text',-1,true,NULL),
        ('order_items',5,'unit_price_snapshot','numeric',655366,true,NULL),
        ('order_items',6,'quantity','integer',-1,true,NULL),
        ('order_items',7,'subtotal','numeric',655366,true,NULL),
        ('order_items',8,'notes','text',-1,false,NULL),
        ('order_status_history',1,'id','uuid',-1,true,NULL),
        ('order_status_history',2,'order_id','uuid',-1,true,NULL),
        ('order_status_history',3,'from_status','public.order_status',-1,false,NULL),
        ('order_status_history',4,'to_status','public.order_status',-1,true,NULL),
        ('order_status_history',5,'changed_by_admin_id','uuid',-1,false,NULL),
        ('order_status_history',6,'notes','text',-1,false,NULL),
        ('order_status_history',7,'created_at','timestamp with time zone',6,true,'CURRENT_TIMESTAMP'),
        ('_prisma_migrations',1,'id','character varying',40,true,NULL),
        ('_prisma_migrations',2,'checksum','character varying',68,true,NULL),
        ('_prisma_migrations',3,'finished_at','timestamp with time zone',-1,false,NULL),
        ('_prisma_migrations',4,'migration_name','character varying',259,true,NULL),
        ('_prisma_migrations',5,'logs','text',-1,false,NULL),
        ('_prisma_migrations',6,'rolled_back_at','timestamp with time zone',-1,false,NULL),
        ('_prisma_migrations',7,'started_at','timestamp with time zone',-1,true,'now()'),
        ('_prisma_migrations',8,'applied_steps_count','integer',-1,true,'0')
    ), actual AS (
        SELECT t.relname::text AS table_name, a.attnum AS position, a.attname::text AS column_name,
               a.atttypid, a.atttypmod, a.attnotnull, a.attisdropped, a.attidentity, a.attgenerated,
               pg_get_expr(d.adbin, d.adrelid) AS default_expr
        FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0
        LEFT JOIN pg_attrdef d ON d.adrelid = t.oid AND d.adnum = a.attnum
        WHERE n.nspname = 'public' AND t.relkind = 'r'
    )
    SELECT 1 FROM expected e FULL JOIN actual a
      ON a.table_name = e.table_name AND a.position = e.position
    WHERE e.table_name IS NULL OR a.table_name IS NULL OR a.attisdropped
       OR a.column_name IS DISTINCT FROM e.column_name
       OR a.atttypid IS DISTINCT FROM to_regtype(e.type_name)::oid
       OR a.atttypmod IS DISTINCT FROM e.typmod
       OR a.attnotnull IS DISTINCT FROM e.not_null
       OR a.default_expr IS DISTINCT FROM e.default_expr
       OR a.attidentity <> '' OR a.attgenerated <> ''
)
'@
}

function Get-PostflightSql {
    $sql = @'
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog, public;
SET LOCAL quote_all_identifiers = off;
SELECT (current_database() = '__LAB__'
    AND current_user = 'cardapio_migrator'
    AND inet_server_addr() = '127.0.0.1'::inet
    AND inet_server_port() = 5432
    AND current_setting('server_version_num') = '180006'
    AND __ROLE_ISOLATION__
    AND __COLUMN_SIGNATURE__
    AND NOT EXISTS (
        SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND c.contype = 'n' AND (NOT c.convalidated OR NOT c.conenforced)
    )
    AND (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) = 'cardapio_migrator'
    AND has_schema_privilege(current_user, 'public', 'CREATE')
    AND has_schema_privilege(current_user, 'public', 'USAGE')
    AND (SELECT count(*) FROM public._prisma_migrations) = 1
    AND EXISTS (SELECT 1 FROM public._prisma_migrations
                WHERE migration_name = '20261023000000_initial_schema'
                  AND lower(checksum) = '__HASH__'
                  AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
    AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r') = 7
    AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND c.relname IN ('admins','categories','products','orders',
                              'order_items','order_status_history')) = 6
    AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'S') = 1
    AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relkind IN ('r','S','i')
                      AND pg_get_userbyid(c.relowner) <> 'cardapio_migrator')
    AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relkind NOT IN ('r','S','i'))
    AND (SELECT count(*) FROM pg_constraint
         WHERE conrelid IN ('public.admins'::regclass, 'public.categories'::regclass,
               'public.products'::regclass, 'public.orders'::regclass,
               'public.order_items'::regclass, 'public.order_status_history'::regclass)
            AND contype = 'p' AND convalidated AND conkey = ARRAY[
                (SELECT attnum FROM pg_attribute WHERE attrelid = conrelid AND attname = 'id')
            ]::smallint[]) = 6
    AND NOT EXISTS (
        SELECT 1 FROM (VALUES ('admins'),('categories'),('products'),('orders'),
                              ('order_items'),('order_status_history'),('_prisma_migrations')) AS expected(table_name)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_index i ON i.indexrelid = c.conindid
            WHERE n.nspname = 'public' AND t.relname = expected.table_name
              AND c.conname = expected.table_name || '_pkey' AND c.contype = 'p'
              AND c.convalidated AND c.conenforced AND NOT c.condeferrable AND NOT c.condeferred
              AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (id)'
              AND i.indisprimary AND i.indisunique AND i.indisvalid AND i.indisready
        )
    )
    AND (SELECT count(*) FROM pg_constraint
         WHERE conrelid IN ('public.admins'::regclass, 'public.categories'::regclass,
              'public.products'::regclass, 'public.orders'::regclass,
              'public.order_items'::regclass, 'public.order_status_history'::regclass)
           AND contype = 'f') = 5
    AND NOT EXISTS (
        SELECT 1 FROM (VALUES
            ('products_category_id_fkey','products','category_id','categories','id'),
            ('order_items_order_id_fkey','order_items','order_id','orders','id'),
            ('order_items_product_id_fkey','order_items','product_id','products','id'),
            ('order_status_history_order_id_fkey','order_status_history','order_id','orders','id'),
            ('order_status_history_changed_by_admin_id_fkey','order_status_history',
                'changed_by_admin_id','admins','id')
        ) AS expected(name, source_table, source_column, target_table, target_column)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class src ON src.oid = c.conrelid
            JOIN pg_namespace ns ON ns.oid = src.relnamespace
            JOIN pg_class dst ON dst.oid = c.confrelid
            JOIN pg_namespace nd ON nd.oid = dst.relnamespace
            JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = c.conkey[1]
            JOIN pg_attribute b ON b.attrelid = dst.oid AND b.attnum = c.confkey[1]
            WHERE c.conname = expected.name AND c.contype = 'f' AND c.convalidated AND c.conenforced
              AND c.confdeltype = 'r' AND c.confupdtype = 'c' AND c.confmatchtype = 's'
              AND NOT c.condeferrable AND NOT c.condeferred
              AND array_length(c.conkey,1) = 1 AND array_length(c.confkey,1) = 1
              AND ns.nspname = 'public' AND nd.nspname = 'public'
              AND src.relname = expected.source_table AND a.attname = expected.source_column
              AND dst.relname = expected.target_table AND b.attname = expected.target_column
        )
    )
    AND (SELECT count(*) FROM pg_constraint
         WHERE conrelid IN ('public.products'::regclass, 'public.orders'::regclass,
                             'public.order_items'::regclass)
           AND contype = 'c') = 5
    AND NOT EXISTS (
        SELECT 1 FROM (VALUES
            ('products','products_price_non_negative','price>=0'),
            ('orders','orders_total_amount_non_negative','total_amount>=0'),
            ('order_items','order_items_unit_price_snapshot_non_negative','unit_price_snapshot>=0'),
            ('order_items','order_items_subtotal_non_negative','subtotal>=0'),
            ('order_items','order_items_quantity_positive','quantity>0')
        ) AS expected(table_name, constraint_name, expression)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = expected.table_name
              AND c.conname = expected.constraint_name AND c.contype = 'c' AND c.convalidated AND c.conenforced
              AND regexp_replace(replace(pg_get_expr(c.conbin,c.conrelid), '::numeric', ''),
                    '[[:space:]()"]', '', 'g') = expected.expression
        )
    )
    AND (SELECT count(*) FROM pg_indexes
         WHERE schemaname = 'public' AND tablename IN ('admins','categories','products',
                 'orders','order_items','order_status_history')) = 19
    AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'i') = 20
    AND EXISTS (SELECT 1 FROM pg_constraint c
                WHERE c.conrelid = 'public._prisma_migrations'::regclass
                  AND c.conname = '_prisma_migrations_pkey' AND c.contype = 'p'
                  AND c.convalidated)
    AND NOT EXISTS (
        SELECT 1 FROM (VALUES
            ('admins_email_key','admins','email',true),
            ('categories_name_key','categories','name',true),
            ('categories_is_active_display_order_idx','categories','is_active, display_order',false),
            ('products_category_id_idx','products','category_id',false),
            ('products_is_active_is_available_idx','products','is_active, is_available',false),
            ('orders_order_number_key','orders','order_number',true),
            ('orders_tracking_token_hash_key','orders','tracking_token_hash',true),
            ('orders_idempotency_key_key','orders','idempotency_key',true),
            ('orders_status_created_at_idx','orders','status, created_at',false),
            ('order_items_order_id_idx','order_items','order_id',false),
            ('order_items_product_id_idx','order_items','product_id',false),
            ('order_status_history_order_id_created_at_idx','order_status_history','order_id, created_at',false),
            ('order_status_history_changed_by_admin_id_idx','order_status_history',
                'changed_by_admin_id',false)
        ) AS expected(name, table_name, columns, unique_index)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_indexes ix JOIN pg_class i ON i.relname = ix.indexname
            JOIN pg_namespace ni ON ni.oid = i.relnamespace AND ni.nspname = 'public'
            JOIN pg_index meta ON meta.indexrelid = i.oid
            WHERE ix.schemaname = 'public' AND ix.tablename = expected.table_name
              AND ix.indexname = expected.name AND meta.indisvalid AND meta.indisready
              AND meta.indisunique = expected.unique_index
              AND ix.indexdef = format('CREATE %sINDEX %I ON public.%I USING btree (%s)',
                   CASE WHEN expected.unique_index THEN 'UNIQUE ' ELSE '' END,
                   expected.name, expected.table_name, expected.columns)
        )
    )
    AND (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
          FROM pg_enum e WHERE e.enumtypid = 'public.order_status'::regtype) =
         ARRAY['RECEIVED','IN_PREPARATION','READY','DELIVERED']::text[]
    AND (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'public' AND t.typtype = 'e') = 1
    AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_sequence s ON s.seqrelid = c.oid
                WHERE n.nspname = 'public' AND c.relname = 'orders_order_number_seq'
                  AND c.relkind = 'S' AND pg_get_userbyid(c.relowner) = 'cardapio_migrator'
                  AND s.seqtypid = 'integer'::regtype AND s.seqstart = 1
                  AND s.seqincrement = 1 AND s.seqmin = 1 AND s.seqmax = 2147483647
                  AND s.seqcache = 1 AND NOT s.seqcycle)
    AND pg_get_serial_sequence('public.orders','order_number') = 'public.orders_order_number_seq'
    AND has_sequence_privilege(current_user, 'public.orders_order_number_seq', 'USAGE')
    AND (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
         JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
         WHERE d.adrelid = 'public.orders'::regclass AND a.attname = 'order_number') =
         'nextval(''orders_order_number_seq''::regclass)'
    AND (SELECT pg_get_userbyid(relowner) FROM pg_class
         WHERE oid = 'public._prisma_migrations'::regclass) = 'cardapio_migrator'
    AND NOT EXISTS (
        SELECT 1 FROM (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) AS required(privilege)
        WHERE NOT has_table_privilege(current_user, 'public._prisma_migrations', required.privilege)
    )
    AND NOT EXISTS (
        SELECT 1 FROM pg_class t
        CROSS JOIN LATERAL aclexplode(COALESCE(t.relacl, acldefault('r', t.relowner))) a
        WHERE t.oid = 'public._prisma_migrations'::regclass AND a.grantee <> t.relowner
    )
    AND NOT EXISTS (
        SELECT 1 FROM pg_attribute col JOIN pg_class t ON t.oid = col.attrelid
        CROSS JOIN LATERAL aclexplode(col.attacl) acl
        WHERE t.oid = 'public._prisma_migrations'::regclass
          AND col.attnum > 0 AND NOT col.attisdropped AND acl.grantee <> t.relowner
    )
    AND NOT EXISTS (
        SELECT 1 FROM pg_roles app
        CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) AS permissions(privilege)
        WHERE app.rolname IN ('cardapio_dev_app','cardapio_test_app')
          AND has_any_column_privilege(app.oid, 'public._prisma_migrations', permissions.privilege)
    )
    AND NOT EXISTS (
        SELECT 1 FROM (VALUES ('cardapio_dev_app'),('cardapio_test_app')) AS roles(name)
        CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),
                           ('REFERENCES'),('TRIGGER'),('MAINTAIN')) AS permissions(privilege)
        WHERE has_table_privilege(roles.name, 'public._prisma_migrations', permissions.privilege)
    )
    AND (SELECT count(*) FROM pg_roles
         WHERE rolname IN ('cardapio_dev_app','cardapio_test_app')) = 2
    AND to_regclass('public.comandas') IS NULL
    AND to_regtype('public.product_availability') IS NULL) AS ok;
ROLLBACK;
'@
    return $sql.Replace('__ROLE_ISOLATION__', (Get-RoleIsolationPredicate)).Replace(
        '__COLUMN_SIGNATURE__', (Get-ColumnSignaturePredicate))
}

try {
    $phase = 'validação local'
    if ($Execute -and $DryRun) { throw 'RF004_MODE' }
    Assert-Source
    if (-not $Execute) {
        if ($ApprovedInitialSha256) { Assert-ApprovedHash }
        Write-Output "DRY RUN: $Lab; sem conexão, staging ou migration."
        Write-Output 'Execução futura exige -Execute, SHA-256 aprovado e confirmação digitada.'
        return
    }

    Assert-ApprovedHash
    $confirmation = Read-Host "Digite o nome completo $Lab para autorizar a migration inicial"
    if ($confirmation -cne $Lab) { throw 'RF004_CONFIRMATION' }

    $staging = Join-Path $stagingBase ("rf004_initial_{0}_{1}" -f $Lab, [guid]::NewGuid().ToString('N'))
    Assert-NoReparseAncestors -Path $stagingBase
    if (Test-Path -LiteralPath $staging) { throw 'RF004_STAGING_EXISTS' }
    $copyDirectory = Join-Path $staging "prisma\migrations\$initialName"
    $null = New-Item -ItemType Directory -Path $staging
    $null = New-Item -ItemType Directory -Path (Join-Path $staging 'prisma')
    $null = New-Item -ItemType Directory -Path (Join-Path $staging 'prisma\migrations')
    $null = New-Item -ItemType Directory -Path $copyDirectory
    Copy-Item -LiteralPath $sourceSql -Destination (Join-Path $copyDirectory 'migration.sql')
    Copy-Item -LiteralPath $sourceSchema -Destination (Join-Path $staging 'prisma\schema.prisma')
    Copy-Item -LiteralPath $sourceLock -Destination (Join-Path $staging 'prisma\migrations\migration_lock.toml')
    [IO.File]::WriteAllText((Join-Path $staging 'prisma.config.js'), $stagingConfig,
        (New-Object System.Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path $staging 'package.json'), $stagingPackage,
        (New-Object System.Text.UTF8Encoding($false)))
    Assert-Staging -Root $staging

    $psql = (Get-Command psql.exe -ErrorAction Stop).Source
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    Initialize-ProcessGuard
    Assert-PsqlClient -Psql $psql -Root $staging
    $password = Read-Host "Senha de cardapio_migrator para $Lab" -AsSecureString
    $ptr = [IntPtr]::Zero
    $plain = $null
    $url = $null
    $info = $null
    try {
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        Assert-PasswordFormat -Value $plain
        Assert-ApprovedHash
        Assert-Staging -Root $staging
        $phase = 'preflight'
        # Preflight é a última operação com banco antes de chamar Prisma.
        Invoke-CatalogCheck -Psql $psql -Root $staging -Password $plain -Sql (
            (Get-PreflightSql).Replace('__LAB__', $Lab))

        $phase = 'deploy'
        try {
            $url = 'postgresql://cardapio_migrator:' + [uri]::EscapeDataString($plain) +
                '@127.0.0.1:5432/' + $Lab + '?schema=public'
            $info = New-IsolatedProcess -Executable $node -WorkingDirectory $staging -Arguments (
                '"' + $prismaCli + '" migrate deploy --schema "' +
                (Join-Path $staging 'prisma\schema.prisma') + '" --config "' +
                (Join-Path $staging 'prisma.config.js') + '"'
            )
            $info.EnvironmentVariables['DATABASE_URL'] = $url
            $info.EnvironmentVariables['SHADOW_DATABASE_URL'] =
                'postgresql://disabled:disabled@127.0.0.1:1/no_shadow'
            $url = $null
            $info.RedirectStandardOutput = $true
            $info.RedirectStandardError = $true
            try {
                $ignored = $null
                $code = [Rf004ProcessGuardB4]::Run($info, $null, 180000, 1048576, $false,
                    [ref]$ignored)
            }
            catch { throw (Get-SafeFailureCode -Exception $_.Exception) }
            if ($code -ne 0) { throw 'RF004_PRISMA_EXIT' }
        }
        finally {
            $url = $null
            if ($info) { $info.EnvironmentVariables.Clear() }
        }
        $phase = 'postflight'
        Invoke-CatalogCheck -Psql $psql -Root $staging -Password $plain -Sql (
            (Get-PostflightSql).Replace('__LAB__', $Lab).Replace('__HASH__',
                $ApprovedInitialSha256.ToLowerInvariant()))
        Assert-ApprovedHash
        Assert-Staging -Root $staging
        Write-Output "OK: migration inicial validada em $Lab. Staging preservado em $staging"
    }
    finally {
        $plain = $null
        if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
        if ($password) { $password.Dispose() }
        $password = $null
    }
}
catch {
    # Não publicar exceções de comandos, subprocessos ou valores de ambiente.
    $location = if ($staging) { " Staging preservado em $staging." } else { '' }
    $safeCode = Get-SafeFailureCode -Exception $_.Exception
    Write-Error -Message "$safeCode; fase=$phase.$location Não repetir automaticamente." -ErrorAction Continue
    exit 1
}
