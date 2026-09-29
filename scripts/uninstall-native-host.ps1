$registries = @(
  'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.mica.desktop',
  'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.mica.desktop'
)
foreach ($registry in $registries) {
  Remove-Item -LiteralPath $registry -Recurse -Force -ErrorAction SilentlyContinue
}
$manifestPath = Join-Path $env:LOCALAPPDATA 'Mica\native-host\com.mica.desktop.json'
Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
Write-Host 'Mica native host uninstalled.'
