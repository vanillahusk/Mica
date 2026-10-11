param(
    [string]$SourceDirectory = $PSScriptRoot,
    [string]$InstallRoot = '',
    # For isolated deployment tests only: no registry, shortcuts or native-host writes.
    [switch]$SkipIntegrations
)
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $SourceDirectory).Path).TrimEnd('\')
if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Mica')
    try { if ($key) { $InstallRoot = [string]$key.GetValue('InstallDirectory') } }
    finally { if ($key) { $key.Dispose() } }
    if ([string]::IsNullOrWhiteSpace($InstallRoot)) { $InstallRoot = Join-Path (Split-Path -Parent $source) 'Mica' }
}
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if ([IO.Path]::GetFileName($root) -ne 'Mica' -or $root -eq [IO.Path]::GetPathRoot($root)) {
    throw 'The installation root must be a dedicated Mica directory.'
}
if ($source.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or
    $source.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $root.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Run the installer from an extracted release outside the installation directory.'
}
foreach ($required in @('Mica.exe','Mica.dll','Mica.deps.json','Mica.runtimeconfig.json','ReaderAssets\index.html','ReaderAssets\reader.js','ReaderAssets\themes.json')) {
    if (!(Test-Path -LiteralPath (Join-Path $source $required) -PathType Leaf)) { throw "Incomplete release: $required" }
}
$items = @(Get-ChildItem -LiteralPath $source -Recurse -Force)
if ($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Release must not contain symlinks or junctions.' }
if ((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Release root must not be a junction.' }
$newVersion = [version]([Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $source 'Mica.exe')).FileVersion)
$app = Join-Path $root 'app'
$executable = Join-Path $app 'Mica.exe'
# Verify every computed move destination stays inside the explicit application root.
function Assert-AppPath([string]$path) {
    if (![IO.Path]::GetFullPath($path).StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe application path: $path" }
}
for ($ancestor = $root; $ancestor; $ancestor = [IO.Path]::GetDirectoryName($ancestor)) {
    if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Installation path must not traverse a junction: $ancestor"
    }
}
New-Item -ItemType Directory -Path $root -Force | Out-Null
$lock = [IO.File]::Open((Join-Path $root 'install.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
    if (Test-Path -LiteralPath $app) {
        if ((Get-Item -LiteralPath $app).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Installed app must not be a junction.' }
        if (!(Test-Path -LiteralPath $executable)) { throw 'Existing app directory is not a recognized Mica installation; refusing to replace it.' }
        $oldVersion = [version]([Diagnostics.FileVersionInfo]::GetVersionInfo($executable).FileVersion)
        if ($newVersion -lt $oldVersion) { throw "Refusing downgrade: $oldVersion -> $newVersion" }
    }
    $running = @(Get-Process Mica -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -and $_.Path.Equals($executable, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($running.Count) { throw 'Mica is running from the installation directory. Save your edits and close it, then retry. No process was stopped.' }

    $transaction = [Guid]::NewGuid().ToString('N')
    $stage = Join-Path $root ('staging-' + $transaction)
    $backup = Join-Path $root ('backup-' + $transaction)
    Assert-AppPath $app; Assert-AppPath $stage; Assert-AppPath $backup
    New-Item -ItemType Directory -Path $stage | Out-Null
    Get-ChildItem -LiteralPath $source -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $stage -Recurse }
    foreach ($file in @($items | Where-Object { !$_.PSIsContainer })) {
        $relative = $file.FullName.Substring($source.Length + 1)
        if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath (Join-Path $stage $relative)).Hash) {
            throw "Staged file failed verification: $relative"
        }
    }
    New-Item -ItemType Directory -Path $backup | Out-Null
    $previous = Join-Path $backup 'app'
    Assert-AppPath $previous
    if (Test-Path -LiteralPath $app) { Move-Item -LiteralPath $app -Destination $previous }
    try { Move-Item -LiteralPath $stage -Destination $app }
    catch {
        if ((Test-Path -LiteralPath $previous) -and !(Test-Path -LiteralPath $app)) { Move-Item -LiteralPath $previous -Destination $app }
        throw
    }
    Write-Output "Installed Mica $newVersion at $executable"
    Write-Output "Backup directory: $backup"
    if ($SkipIntegrations) { return }

    # Save all overwritten registry values for recovery. Never touch UserChoice or its hash.
    $command = '"' + $executable + '" "%1"'
    $entries = @(
        @('Software\Mica', 'InstallDirectory', $root),
        @('Software\Classes\Mica.Markdown', '', 'Markdown document'),
        @('Software\Classes\Mica.Markdown\DefaultIcon', '', ('"' + $executable + '",0')),
        @('Software\Classes\Mica.Markdown\shell\open\command', '', $command),
        @('Software\Classes\Applications\Mica.exe', 'FriendlyAppName', 'Mica'),
        @('Software\Classes\Applications\Mica.exe\shell\open\command', '', $command),
        @('Software\Classes\Applications\Mica.exe\SupportedTypes', '.md', ''),
        @('Software\Classes\Applications\Mica.exe\SupportedTypes', '.markdown', ''),
        @('Software\Classes\.md\OpenWithProgids', 'Mica.Markdown', ''),
        @('Software\Classes\.markdown\OpenWithProgids', 'Mica.Markdown', ''),
        @('Software\Mica\Capabilities', 'ApplicationName', 'Mica'),
        @('Software\Mica\Capabilities', 'ApplicationDescription', 'Markdown and ChatGPT reader'),
        @('Software\Mica\Capabilities\FileAssociations', '.md', 'Mica.Markdown'),
        @('Software\Mica\Capabilities\FileAssociations', '.markdown', 'Mica.Markdown'),
        @('Software\RegisteredApplications', 'Mica', 'Software\Mica\Capabilities'),
        @('Software\Microsoft\Windows\CurrentVersion\App Paths\Mica.exe', '', $executable)
    )
    $manifestPath = Join-Path $env:LOCALAPPDATA 'Mica\native-host\com.mica.desktop.json'
    $manifest = $null
    if (Test-Path -LiteralPath $manifestPath) {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        if ($manifest.name -ne 'com.mica.desktop' -or $manifest.type -ne 'stdio' -or !($manifest.allowed_origins) -or
            @($manifest.allowed_origins | Where-Object { $_ -cnotmatch '^chrome-extension://[a-p]{32}/$' }).Count) {
            throw 'Existing native-host manifest is invalid. Installed app is intact; reconnect through its ChatGPT settings.'
        }
        Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $backup 'native-host.json')
        foreach ($browser in @('Google\Chrome', 'Microsoft\Edge')) {
            $entries += ,@("Software\$browser\NativeMessagingHosts\com.mica.desktop", '', $manifestPath)
        }
    }
    $snapshot = @()
    foreach ($entry in $entries) {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($entry[0])
        try {
            $existed = $null -ne $key -and $key.GetValueNames() -contains $entry[1]
            $snapshot += [pscustomobject]@{ Path=$entry[0]; Name=$entry[1]; Existed=$existed; Value=$(if($existed){$key.GetValue($entry[1])}else{$null}); Kind=$(if($existed){$key.GetValueKind($entry[1]).ToString()}else{$null}) }
        } finally { if($null -ne $key){ $key.Dispose() } }
    }
    $snapshot | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $backup 'registry-values.json') -Encoding UTF8
    if ($manifest) {
        $manifest.path = $executable
        $temporary = $manifestPath + '.' + $transaction + '.tmp'
        [IO.File]::WriteAllText($temporary, ($manifest | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
        # File.Replace requires a backup on the same volume as the native manifest.
        $manifestBackup = $manifestPath + '.' + $transaction + '.bak'
        [IO.File]::Replace($temporary, $manifestPath, $manifestBackup)
        Assert-AppPath (Join-Path $backup 'native-host-before-replace.json')
        Move-Item -LiteralPath $manifestBackup -Destination (Join-Path $backup 'native-host-before-replace.json')
        Write-Output 'Existing ChatGPT connection migrated; allowed extension origins preserved.'
    }
    foreach ($entry in $entries) {
        $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($entry[0])
        try { $key.SetValue($entry[1], $entry[2], [Microsoft.Win32.RegistryValueKind]::String) }
        finally { $key.Dispose() }
    }

    $shell = New-Object -ComObject WScript.Shell
    $shortcutPaths = @(
        (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Mica.lnk'),
        (Join-Path ([Environment]::GetFolderPath('Programs')) 'Mica.lnk')
    )
    # Repair existing Mica shortcuts, including pinned shortcuts, when they target this app.
    $roots = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('StartMenu'),
        (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'))
    foreach ($shortcutRoot in $roots) {
        if (!(Test-Path -LiteralPath $shortcutRoot)) { continue }
        foreach ($file in @(Get-ChildItem -LiteralPath $shortcutRoot -Filter '*Mica*.lnk' -File -Recurse -ErrorAction SilentlyContinue)) {
            $link = $shell.CreateShortcut($file.FullName)
            if ([IO.Path]::GetFileName($link.TargetPath) -ieq 'Mica.exe') { $shortcutPaths += $file.FullName }
        }
    }
    $shortcutIndex = 0
    foreach ($shortcutPath in @($shortcutPaths | Select-Object -Unique)) {
        $link = $shell.CreateShortcut($shortcutPath)
        if ((Test-Path -LiteralPath $shortcutPath) -and [IO.Path]::GetFileName($link.TargetPath) -ine 'Mica.exe') {
            Write-Warning "Unrelated shortcut was not overwritten: $shortcutPath"; continue
        }
        if (Test-Path -LiteralPath $shortcutPath) { Copy-Item -LiteralPath $shortcutPath -Destination (Join-Path $backup ("shortcut-$shortcutIndex.lnk")) }
        $shortcutIndex++
        $link.TargetPath = $executable
        $link.WorkingDirectory = $app
        $link.IconLocation = $executable + ',0'
        $link.Description = 'Mica Markdown reader'
        $link.Save()
        Write-Output "Shortcut: $shortcutPath"
    }
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class MicaShellNotify { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e, uint f, IntPtr a, IntPtr b); }'
    [MicaShellNotify]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
    Write-Output 'File associations now use the fixed installation path. Your default app selection was NOT changed.'
    Write-Output 'If needed, open Mica > More > Default Markdown application and select Mica in Windows Settings.'
}
finally { $lock.Dispose() }
