# Convert selected QA captures to compact JPEGs for the pull request.
# Run after communeQa.mjs, streetQa.mjs, and perfTown.mjs.
Add-Type -AssemblyName System.Drawing
$out = Join-Path (Get-Location) 'docs/aa-world/qa'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$pairs = @(
  @('shots/before/appalachia-day-15m.png', 'commune-before-day-15.jpg'),
  @('shots/final-qa/appalachia-day-15.png', 'commune-after-day-15.jpg'),
  @('shots/before/appalachia-day-40m.png', 'commune-before-day-40.jpg'),
  @('shots/final-qa/appalachia-day-40.png', 'commune-after-day-40.jpg'),
  @('shots/before/appalachia-day-150m.png', 'commune-before-day-150.jpg'),
  @('shots/final-qa/appalachia-day-150.png', 'commune-after-day-150.jpg'),
  @('shots/before/appalachia-night-40m.png', 'commune-before-night-40.jpg'),
  @('shots/final-qa/appalachia-night-40.png', 'commune-after-night-40.jpg'),
  @('shots/before/appalachia-rain-40m.png', 'commune-before-rain-40.jpg'),
  @('shots/final-qa/appalachia-rain-40.png', 'commune-after-rain-40.jpg'),
  @('shots/before/appalachia-snow-40m.png', 'commune-before-snow-40.jpg'),
  @('shots/final-qa/appalachia-snow-40.png', 'commune-after-snow-40.jpg'),
  @('shots/final-qa/norcal-day-40.png', 'norcal-after-day-40.jpg'),
  @('shots/final-qa/florida-night-40.png', 'florida-after-night-40.jpg'),
  @('shots/street-qa/street-signal-day.png', 'street-signal-day.jpg'),
  @('shots/street-qa/street-signal-night.png', 'street-signal-night.jpg'),
  @('shots/commune-leave/burnt-remains.png', 'commune-burnt-remains.jpg'),
  @('shots/perf-hardware-reflection/town-high-1280x800-overlay.png', 'town-high-overlay.jpg'),
  @('shots/perf-hardware-reflection/town-low-390x844-overlay.png', 'town-low-overlay.jpg')
)
foreach ($pair in $pairs) {
  $src = (Resolve-Path -LiteralPath $pair[0]).Path
  $bmp = [System.Drawing.Bitmap]::FromFile($src)
  try { $bmp.Save((Join-Path $out $pair[1]), [System.Drawing.Imaging.ImageFormat]::Jpeg) }
  finally { $bmp.Dispose() }
}
Get-ChildItem -LiteralPath $out -File | Measure-Object Length -Sum | Select-Object Count,Sum
