$registries = @(
  'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.lightsession.desktop',
  'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.lightsession.desktop'
)
foreach ($registry in $registries) {
  Remove-Item -LiteralPath $registry -Recurse -Force -ErrorAction SilentlyContinue
}
$manifestPath = Join-Path $env:LOCALAPPDATA 'LightSession\native-host\com.lightsession.desktop.json'
Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
Write-Host 'LightSession native host uninstalled.'
