param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId,
  [string]$ExecutablePath = (Join-Path $PSScriptRoot '..\publish\Mica.exe')
)

$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath -ErrorAction Stop).Path
$hostDirectory = Join-Path $env:LOCALAPPDATA 'Mica\native-host'
$manifestPath = Join-Path $hostDirectory 'com.mica.desktop.json'
New-Item -ItemType Directory -Path $hostDirectory -Force | Out-Null

$manifest = [ordered]@{
  name = 'com.mica.desktop'
  description = 'Mica desktop conversation sync host'
  path = $resolvedExecutable
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifestJson = $manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, [System.Text.UTF8Encoding]::new($false))

$registries = @(
  'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.mica.desktop',
  'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.mica.desktop'
)
foreach ($registry in $registries) {
  New-Item -Path $registry -Force | Out-Null
  Set-Item -Path $registry -Value $manifestPath
}

Write-Host "Mica native host installed for extension $ExtensionId"
Write-Host "Manifest: $manifestPath"
