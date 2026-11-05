#Requires -Version 5.1
<#
.SYNOPSIS
Runs the project's fixed set of npm health checks.
.DESCRIPTION
Static (default) runs only typecheck. Full also runs builds and backend tests.
Reports are created in a unique directory under LOCALAPPDATA. Dependencies
must already be installed. npm lifecycle hooks are disabled for every check.
.EXAMPLE
.\Check-HealthProject.ps1 -Scope All -Mode Static
.EXAMPLE
.\Check-HealthProject.ps1 -Scope Backend -Mode Full
#>
[CmdletBinding(PositionalBinding = $false)]
param(
    [ValidateSet('All', 'Frontend', 'Backend')]
    [string]$Scope = 'All',

    [ValidateSet('Static', 'Full')]
    [string]$Mode = 'Static'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This is the complete command allowlist. No command text comes from parameters
# or package.json. A changed npm script must be reviewed before it can run.
$steps = @(
    [pscustomobject]@{
        Component = 'Frontend'; Directory = 'frontend'; Script = 'typecheck'
        Definition = 'tsc --noEmit'; Tools = @('tsc'); FullOnly = $false
    }
    [pscustomobject]@{
        Component = 'Frontend'; Directory = 'frontend'; Script = 'build'
        Definition = 'tsc --noEmit && vite build'; Tools = @('tsc', 'vite'); FullOnly = $true
    }
    [pscustomobject]@{
        Component = 'Backend'; Directory = 'backend'; Script = 'typecheck'
        Definition = 'tsc --noEmit'; Tools = @('tsc'); FullOnly = $false
    }
    [pscustomobject]@{
        Component = 'Backend'; Directory = 'backend'; Script = 'build'
        Definition = 'tsc -p tsconfig.build.json'; Tools = @('tsc'); FullOnly = $true
    }
    [pscustomobject]@{
        Component = 'Backend'; Directory = 'backend'; Script = 'test'
        Definition = 'vitest run'; Tools = @('vitest'); FullOnly = $true
    }
)

function Invoke-HealthStep {
    param(
        [Parameter(Mandatory = $true)] [psobject]$Step,
        [Parameter(Mandatory = $true)] [string]$ReportDirectory
    )

    $startedAt = [DateTime]::UtcNow
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $required = ($Scope -eq 'All' -or $Scope -eq $Step.Component) -and
        ($Mode -eq 'Full' -or -not $Step.FullOnly)
    $status = 'SKIP'
    $reason = ''
    $exitCode = $null
    $processTimer = $null
    $processDurationMs = $null
    $process = $null
    $stdoutPath = $null
    $stderrPath = $null

    try {
        if ($Scope -ne 'All' -and $Scope -ne $Step.Component) {
            $reason = 'Component not selected by Scope.'
        }
        elseif ($Mode -eq 'Static' -and $Step.FullOnly) {
            $reason = 'Step not selected in Static mode.'
        }
        else {
            $componentDirectory = Join-Path $PSScriptRoot $Step.Directory
            $packagePath = Join-Path $componentDirectory 'package.json'
            if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
                throw "Missing package.json for $($Step.Component)."
            }

            $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
            $scriptsProperty = $package.PSObject.Properties['scripts']
            if ($null -eq $scriptsProperty -or $null -eq $scriptsProperty.Value) {
                throw "Missing scripts object for $($Step.Component)."
            }
            $scriptProperty = $scriptsProperty.Value.PSObject.Properties[$Step.Script]
            if ($null -eq $scriptProperty) {
                throw "Missing npm script '$($Step.Script)' for $($Step.Component)."
            }
            if ($scriptProperty.Value -isnot [string] -or $scriptProperty.Value -cne $Step.Definition) {
                throw "Script '$($Step.Script)' differs from the reviewed allowlist; execution refused."
            }

            $dependenciesPath = Join-Path $componentDirectory 'node_modules'
            if (-not (Test-Path -LiteralPath $dependenciesPath -PathType Container)) {
                throw "Dependencies missing for $($Step.Component); install them separately before retrying."
            }
            foreach ($tool in $Step.Tools) {
                $toolPath = Join-Path $dependenciesPath ".bin\$tool.cmd"
                if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) {
                    throw "Required local command '$tool' is missing for $($Step.Component)."
                }
            }

            $node = Get-Command -Name 'node.exe' -CommandType Application -ErrorAction SilentlyContinue |
                Select-Object -First 1
            $npm = Get-Command -Name 'npm.cmd' -CommandType Application -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($null -eq $node -or $null -eq $npm) {
                throw 'node.exe and npm.cmd must be available on PATH.'
            }

            # Invoke npm's CLI through Node directly: no dynamic shell command.
            # Standard Windows Node/npm installations keep the CLI next to npm.cmd.
            $npmCli = Join-Path (Split-Path -Parent $npm.Source) 'node_modules\npm\bin\npm-cli.js'
            if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
                throw 'npm CLI not found beside npm.cmd; this npm installation layout is unsupported.'
            }

            $logName = '{0}-{1}' -f $Step.Component.ToLowerInvariant(), $Step.Script
            $stdoutPath = Join-Path $ReportDirectory "$logName.stdout.log"
            $stderrPath = Join-Path $ReportDirectory "$logName.stderr.log"
            if ((Test-Path -LiteralPath $stdoutPath) -or (Test-Path -LiteralPath $stderrPath)) {
                throw 'Step log already exists; refusing to overwrite it.'
            }

            # --ignore-scripts blocks implicit pre/post hooks, but still runs the
            # explicitly requested, allowlisted npm script.
            $arguments = @(('"{0}"' -f $npmCli), 'run', $Step.Script, '--ignore-scripts')
            $processTimer = [Diagnostics.Stopwatch]::StartNew()
            $process = Start-Process -FilePath $node.Source -ArgumentList $arguments `
                -WorkingDirectory $componentDirectory -NoNewWindow -Wait -PassThru `
                -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
            $processTimer.Stop()
            $processDurationMs = $processTimer.ElapsedMilliseconds
            $exitCode = $process.ExitCode
            if ($null -eq $exitCode) {
                throw 'Process completed without an available exit code.'
            }
            if ($exitCode -eq 0) {
                $status = 'PASS'
                $reason = 'Process completed successfully.'
            }
            else {
                $status = 'FAIL'
                $reason = "Process returned exit code $exitCode; see stdout/stderr logs."
            }
        }
    }
    catch {
        $status = 'FAIL'
        $reason = $_.Exception.Message
    }
    finally {
        $timer.Stop()
        if ($null -ne $processTimer) {
            $processTimer.Stop()
            $processDurationMs = $processTimer.ElapsedMilliseconds
        }
        if ($null -ne $process) {
            $process.Dispose()
        }
    }

    [pscustomobject]@{
        Component = $Step.Component
        Step = $Step.Script
        Command = "npm run $($Step.Script) --ignore-scripts"
        Required = $required
        Status = $status
        StartedAtUtc = $startedAt.ToString('o')
        DurationMs = $timer.ElapsedMilliseconds
        ProcessDurationMs = $processDurationMs
        ExitCode = $exitCode
        Reason = $reason
        StdoutLog = $stdoutPath
        StderrLog = $stderrPath
    }
}

$results = New-Object 'System.Collections.Generic.List[object]'
$runStartedAt = [DateTime]::UtcNow
$runTimer = [Diagnostics.Stopwatch]::StartNew()
$reportDirectory = $null
$overallExitCode = 1

try {
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA) -or
        -not [IO.Path]::IsPathRooted($env:LOCALAPPDATA)) {
        throw 'LOCALAPPDATA must contain an absolute path; no repository fallback is allowed.'
    }
    if (-not (Test-Path -LiteralPath $env:LOCALAPPDATA -PathType Container)) {
        throw 'LOCALAPPDATA directory does not exist.'
    }

    $reportRoot = Join-Path $env:LOCALAPPDATA 'CardapioDigital\health-reports'
    if (-not (Test-Path -LiteralPath $reportRoot -PathType Container)) {
        New-Item -Path $reportRoot -ItemType Directory -Force | Out-Null
    }
    $runId = '{0}-{1}' -f $runStartedAt.ToString('yyyyMMddTHHmmssfffZ'), [Guid]::NewGuid().ToString('N')
    $reportDirectory = Join-Path $reportRoot $runId
    New-Item -Path $reportDirectory -ItemType Directory | Out-Null

    foreach ($step in $steps) {
        $result = Invoke-HealthStep -Step $step -ReportDirectory $reportDirectory
        $results.Add($result)
        Write-Host ('[{0}] {1}/{2}: {3}' -f $result.Status, $result.Component, $result.Step, $result.Reason)
    }

    $failures = @($results | Where-Object { $_.Required -and $_.Status -eq 'FAIL' })
    $overallExitCode = 0
    if ($failures.Count -gt 0) {
        $overallExitCode = 1
    }
    $runTimer.Stop()
    $summary = [ordered]@{
        RunId = $runId
        Scope = $Scope
        Mode = $Mode
        StartedAtUtc = $runStartedAt.ToString('o')
        DurationMs = $runTimer.ElapsedMilliseconds
        ExitCode = $overallExitCode
        ReportDirectory = $reportDirectory
        Results = $results.ToArray()
    }
    $summary | ConvertTo-Json -Depth 6 |
        Out-File -LiteralPath (Join-Path $reportDirectory 'summary.json') -Encoding utf8 -NoClobber
    $results.ToArray() | Export-Csv -LiteralPath (Join-Path $reportDirectory 'summary.csv') `
        -NoTypeInformation -Encoding UTF8 -NoClobber

    $text = New-Object 'System.Collections.Generic.List[string]'
    $text.Add("Run: $runId | Scope: $Scope | Mode: $Mode")
    $text.Add("DurationMs: $($runTimer.ElapsedMilliseconds) | ExitCode: $overallExitCode")
    $text.Add('ExitCode is empty when no process was started (SKIP or preflight failure).')
    foreach ($result in $results) {
        $text.Add(('[{0}] {1}/{2} | Required={3} | DurationMs={4} | ProcessDurationMs={5} | ExitCode={6} | {7}' -f
            $result.Status, $result.Component, $result.Step, $result.Required,
            $result.DurationMs, $result.ProcessDurationMs, $result.ExitCode, $result.Reason))
    }
    $text | Out-File -LiteralPath (Join-Path $reportDirectory 'summary.txt') -Encoding utf8 -NoClobber
    Write-Host "Reports: $reportDirectory"
}
catch {
    $overallExitCode = 1
    $message = "[FAIL] Orchestrator: $($_.Exception.Message)"
    Write-Host $message
    if ($null -ne $reportDirectory -and (Test-Path -LiteralPath $reportDirectory -PathType Container)) {
        try {
            $message | Out-File -LiteralPath (Join-Path $reportDirectory 'orchestrator-error.log') `
                -Encoding utf8 -NoClobber
            Write-Host "Partial reports: $reportDirectory"
        }
        catch {
            Write-Host '[FAIL] Could not save the orchestrator error log.'
        }
    }
}
finally {
    $runTimer.Stop()
}

exit $overallExitCode
