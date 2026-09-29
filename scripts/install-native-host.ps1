param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z]{32}$')]
  [string]$ExtensionId,
  [string]$ExecutablePath = (Join-Path $PSScriptRoot '..\publish\LightSession.Desktop.exe')
)

$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath -ErrorAction Stop).Path
$hostDirectory = Join-Path $env:LOCALAPPDATA 'LightSession\native-host'
$manifestPath = Join-Path $hostDirectory 'com.lightsession.desktop.json'
New-Item -ItemType Directory -Path $hostDirectory -Force | Out-Null

$manifest = [ordered]@{
  name = 'com.lightsession.desktop'
  description = 'LightSession desktop conversation sync host'
  path = $resolvedExecutable
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifestJson = $manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, [System.Text.UTF8Encoding]::new($false))

$registries = @(
  'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.lightsession.desktop',
  'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.lightsession.desktop'
)
foreach ($registry in $registries) {
  New-Item -Path $registry -Force | Out-Null
  Set-Item -Path $registry -Value $manifestPath
}

Write-Host "LightSession native host installed for extension $ExtensionId"
Write-Host "Manifest: $manifestPath"
