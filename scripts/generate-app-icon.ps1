# Draws the Fid Coder app icon from the same geometry as assets/app-icon/icon.svg.
# Run from the repo root: powershell -ExecutionPolicy Bypass -File scripts/generate-app-icon.ps1
param(
  [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "assets\app-icon")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath([single]$Size, [single]$Radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
  $path.AddArc($Size - $diameter, 0, $diameter, $diameter, 270, 90)
  $path.AddArc($Size - $diameter, $Size - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc(0, $Size - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-GlyphPath([single]$Size) {
  $s = $Size / 512.0
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $stemX = [single](187.6 * $s)
  $bottomY = [single](382.0 * $s)
  $topY = [single](135.4 * $s)
  $rightX = [single](335.2 * $s)
  $middleY = [single](259.6 * $s)
  $middleRightX = [single](295.6 * $s)
  $path.AddLine($stemX, $bottomY, $stemX, $topY)
  $path.AddLine($stemX, $topY, $rightX, $topY)
  $path.StartFigure()
  $path.AddLine($stemX, $middleY, $middleRightX, $middleY)
  return $path
}

function New-IconBitmap([int]$Size) {
  $bitmap = [System.Drawing.Bitmap]::new(
    $Size,
    $Size,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $scale = [single]$Size / 512.0
    $background = New-RoundedRectPath -Size $Size -Radius ([single](148.0 * $scale))
    $lime = [System.Drawing.SolidBrush]::new(
      [System.Drawing.ColorTranslator]::FromHtml("#d8f878")
    )
    try {
      $graphics.FillPath($lime, $background)
    } finally {
      $lime.Dispose()
      $background.Dispose()
    }

    $ink = [System.Drawing.ColorTranslator]::FromHtml("#11140c")
    $pen = [System.Drawing.Pen]::new($ink, [single](54.0 * $scale))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $glyph = New-GlyphPath -Size $Size
    try {
      $graphics.DrawPath($pen, $glyph)
    } finally {
      $glyph.Dispose()
      $pen.Dispose()
    }

    $dot = [System.Drawing.SolidBrush]::new($ink)
    try {
      $radius = [single](32.4 * $scale)
      $diameter = $radius * 2
      $graphics.FillEllipse(
        $dot,
        [single](335.2 * $scale) - $radius,
        [single](362.2 * $scale) - $radius,
        $diameter,
        $diameter
      )
    } finally {
      $dot.Dispose()
    }
  } finally {
    $graphics.Dispose()
  }
  return $bitmap
}

function Get-PngBytes([System.Drawing.Bitmap]$Bitmap) {
  $stream = [System.IO.MemoryStream]::new()
  try {
    $Bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    return $stream.ToArray()
  } finally {
    $stream.Dispose()
  }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$big = New-IconBitmap 512
try {
  $big.Save((Join-Path $OutDir "icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $big.Dispose()
}

$tray = New-IconBitmap 32
try {
  $tray.Save((Join-Path $OutDir "tray.png"), [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $tray.Dispose()
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$frames = foreach ($size in $sizes) {
  $bitmap = New-IconBitmap $size
  try {
    [pscustomobject]@{
      Size = $size
      Bytes = [byte[]](Get-PngBytes $bitmap)
    }
  } finally {
    $bitmap.Dispose()
  }
}

$iconPath = Join-Path $OutDir "icon.ico"
$stream = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($stream)
try {
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$frames.Count)
  $offset = 6 + 16 * $frames.Count
  foreach ($frame in $frames) {
    $dimension = if ($frame.Size -ge 256) { 0 } else { $frame.Size }
    $writer.Write([byte]$dimension)
    $writer.Write([byte]$dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$frame.Bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $frame.Bytes.Length
  }
  foreach ($frame in $frames) {
    $writer.Write([byte[]]$frame.Bytes)
  }
  [System.IO.File]::WriteAllBytes($iconPath, $stream.ToArray())
} finally {
  $writer.Dispose()
  $stream.Dispose()
}

Write-Host "Wrote $OutDir\icon.png, tray.png, and icon.ico ($($frames.Count) sizes)."
