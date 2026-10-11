$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore, WindowsBase

# The small, path-only SVG is the editable source. No remote assets or image tooling required.
$assetDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../Assets'))
[xml]$svg = [IO.File]::ReadAllText((Join-Path $assetDirectory 'mica.svg'))
$paths = $svg.SelectNodes('/*[local-name()="svg"]/*[local-name()="path"]')
$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$frames = @()
foreach ($size in $sizes) {
    $visual = [Windows.Media.DrawingVisual]::new()
    $drawing = $visual.RenderOpen()
    $drawing.PushTransform([Windows.Media.ScaleTransform]::new($size / 256.0, $size / 256.0))
    foreach ($path in $paths) {
        $brush = [Windows.Media.BrushConverter]::new().ConvertFromInvariantString($path.GetAttribute('fill'))
        $geometry = [Windows.Media.Geometry]::Parse($path.GetAttribute('d'))
        $drawing.DrawGeometry($brush, $null, $geometry)
    }
    $drawing.Pop()
    $drawing.Close()
    $bitmap = [Windows.Media.Imaging.RenderTargetBitmap]::new($size, $size, 96, 96, [Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($visual)
    $encoder = [Windows.Media.Imaging.PngBitmapEncoder]::new()
    $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $buffer = [IO.MemoryStream]::new()
    $encoder.Save($buffer)
    $bytes = $buffer.ToArray()
    $buffer.Dispose()
    $frames += ,$bytes
    if ($size -eq 256) { [IO.File]::WriteAllBytes((Join-Path $assetDirectory 'mica.png'), $bytes) }
}

$file = [IO.File]::Create((Join-Path $assetDirectory 'mica.ico'))
$writer = [IO.BinaryWriter]::new($file)
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
        $writer.Write([byte]$dimension)
        $writer.Write([byte]$dimension)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$frames[$i].Length)
        $writer.Write([uint32]$offset)
        $offset += $frames[$i].Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
}
finally { $writer.Dispose() }
Write-Output "Built mica.ico with $($sizes.Count) sizes (16–256 px), and mica.png."
