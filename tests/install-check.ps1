param([string]$ReleaseDirectory = (Join-Path $PSScriptRoot '../publish-0.5.2'))
$ErrorActionPreference = 'Stop'
$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$installer = Join-Path $PSScriptRoot '../scripts/Install-Mica.ps1'
$testDirectory = Join-Path $PSScriptRoot ('output/install-' + [Guid]::NewGuid().ToString('N'))
$target = Join-Path $testDirectory 'Mica'
$executable = Join-Path $target 'app/Mica.exe'
function Assert($condition, [string]$message) { if (!$condition) { throw $message }; Write-Output "PASS $message" }
& $installer -SourceDirectory $release -InstallRoot $target -SkipIntegrations
Assert (Test-Path -LiteralPath $executable) 'First installation creates the stable entry point'
$hash = (Get-FileHash -LiteralPath $executable).Hash
& $installer -SourceDirectory $release -InstallRoot $target -SkipIntegrations
Assert ((Get-FileHash -LiteralPath $executable).Hash -eq $hash) 'Reinstallation retains the same executable path and valid bytes'
Assert (@(Get-ChildItem -LiteralPath $target -Filter 'backup-*' -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'app/Mica.exe') }).Count -eq 1) 'Previous application is recoverable'
$rejected = $false
try { & $installer -SourceDirectory $target -InstallRoot $target -SkipIntegrations } catch { $rejected = $_.Exception.Message -like '*outside*' }
Assert $rejected 'Source inside installation root is rejected'
$oldRelease = Join-Path $PSScriptRoot '../publish-0.5.1'
if (Test-Path -LiteralPath $oldRelease) {
    $rejected = $false
    try { & $installer -SourceDirectory $oldRelease -InstallRoot $target -SkipIntegrations } catch { $rejected = $_.Exception.Message -like '*downgrade*' }
    Assert $rejected 'An older release cannot replace the installed version'
}
# Keep only this synthetic host process alive; never stop a user's Mica window.
$start = [Diagnostics.ProcessStartInfo]::new($executable, '--native-messaging')
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$process = [Diagnostics.Process]::Start($start)
try {
    $rejected = $false
    try { & $installer -SourceDirectory $release -InstallRoot $target -SkipIntegrations } catch { $rejected = $_.Exception.Message -like '*is running*' }
    Assert $rejected 'Running installed app blocks updates without killing it'
    Assert (!$process.HasExited) 'The running process is preserved'
    Assert ((Get-FileHash -LiteralPath $executable).Hash -eq $hash) 'Blocked update leaves application intact'
} finally {
    $process.StandardInput.Close()
    if (!$process.WaitForExit(10000)) { $process.Kill(); $process.WaitForExit() }
    $process.Dispose()
}
Assert (!(Test-Path -LiteralPath (Join-Path $target 'conversations'))) 'Installer keeps application files separate from user data'
Write-Output "PASS isolated installation regression: $testDirectory"
