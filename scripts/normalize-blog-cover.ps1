# Crop/scale blog covers to exact 1920x1080 (16:9) for post-card preview.
# -FocalPoint Top keeps headline text when source is taller than 16:9.
param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [string]$OutputPath = '',
  [ValidateSet('Center', 'Top')]
  [string]$FocalPoint = 'Top'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$targetW = 1920
$targetH = 1080
$out = if ($OutputPath) { $OutputPath } else { $InputPath }
$src = [System.Drawing.Image]::FromFile((Resolve-Path $InputPath))
try {
  $srcRatio = $src.Width / $src.Height
  $targetRatio = $targetW / $targetH
  if ($srcRatio -gt $targetRatio) {
    $cropH = $src.Height
    $cropW = [int][Math]::Round($cropH * $targetRatio)
    $x = [int][Math]::Floor(($src.Width - $cropW) / 2)
    $y = 0
  } else {
    $cropW = $src.Width
    $cropH = [int][Math]::Round($cropW / $targetRatio)
    $x = 0
    $y = if ($FocalPoint -eq 'Top') { 0 } else { [int][Math]::Floor(($src.Height - $cropH) / 2) }
  }
  $crop = New-Object System.Drawing.Bitmap $cropW, $cropH
  $gCrop = [System.Drawing.Graphics]::FromImage($crop)
  $gCrop.DrawImage($src, 0, 0, (New-Object System.Drawing.Rectangle $x, $y, $cropW, $cropH), [System.Drawing.GraphicsUnit]::Pixel)
  $gCrop.Dispose()
  $bmp = New-Object System.Drawing.Bitmap $targetW, $targetH
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($crop, 0, 0, $targetW, $targetH)
  $g.Dispose()
  $crop.Dispose()
  $dir = Split-Path $out -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $bmp.Dispose()
  Write-Host "Wrote ${targetW}x${targetH}: $out"
} finally {
  $src.Dispose()
}
