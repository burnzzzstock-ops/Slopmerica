# Convert selected QA captures to compact JPEGs for the pull request.
# Run after communeQa.mjs, streetQa.mjs, and perfTown.mjs.
Add-Type -AssemblyName System.Drawing
$out = Join-Path (Get-Location) 'docs/aa-world/qa'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$pairs = @(
  @('shots/before/appalachia-day-15m.png', 'commune-before-day-15.jpg'),
  @('shots/atmos-commune-final/appalachia-day-15.png', 'commune-after-day-15.jpg'),
  @('shots/before/appalachia-day-40m.png', 'commune-before-day-40.jpg'),
  @('shots/atmos-commune-final/appalachia-day-40.png', 'commune-after-day-40.jpg'),
  @('shots/before/appalachia-day-150m.png', 'commune-before-day-150.jpg'),
  @('shots/atmos-commune-final/appalachia-day-150.png', 'commune-after-day-150.jpg'),
  @('shots/before/appalachia-night-40m.png', 'commune-before-night-40.jpg'),
  @('shots/atmos-commune-final/appalachia-night-40.png', 'commune-after-night-40.jpg'),
  @('shots/before/appalachia-rain-40m.png', 'commune-before-rain-40.jpg'),
  @('shots/atmos-commune-final/appalachia-rain-40.png', 'commune-after-rain-40.jpg'),
  @('shots/before/appalachia-snow-40m.png', 'commune-before-snow-40.jpg'),
  @('shots/atmos-commune-final/appalachia-snow-40.png', 'commune-after-snow-40.jpg'),
  @('shots/atmos-commune-final/norcal-day-40.png', 'norcal-after-day-40.jpg'),
  @('shots/atmos-commune-final/florida-night-40.png', 'florida-after-night-40.jpg'),
  @('shots/merged-street-qa/street-signal-day.png', 'street-signal-day.jpg'),
  @('shots/merged-street-qa/street-signal-night.png', 'street-signal-night.jpg'),
  @('shots/merged-commune-leave-final/burnt-remains.png', 'commune-burnt-remains.jpg'),
  @('shots/merged-perf-final/town-high-1280x800-overlay.png', 'town-high-overlay.jpg'),
  @('shots/merged-perf-final/town-low-390x844-overlay.png', 'town-low-overlay.jpg'),
  @('shots/merged-perf-final/town-high-1280x800.png', 'town-high.jpg'),
  @('shots/merged-perf-final/town-low-390x844.png', 'town-low.jpg')
)
foreach ($pair in $pairs) {
  $src = (Resolve-Path -LiteralPath $pair[0]).Path
  $bmp = [System.Drawing.Bitmap]::FromFile($src)
  try { $bmp.Save((Join-Path $out $pair[1]), [System.Drawing.Imaging.ImageFormat]::Jpeg) }
  finally { $bmp.Dispose() }
}
Get-ChildItem -LiteralPath $out -File | Measure-Object Length -Sum | Select-Object Count,Sum
