# Packages the Firefox add-ons as .xpi files and opens them for normal (persistent) installation.
# NOTE: Regular Firefox permanently installs only signed add-ons. If Firefox says the
# add-on is corrupt/unverified, sign the generated .xpi on AMO or use Firefox
# Developer Edition/Nightly/ESR with signature enforcement disabled.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutDir = Join-Path $Root 'build\firefox-addons'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Addons = @(
  @{ Name = 'moodle-extractor'; Path = Join-Path $Root 'moodle-extractor' },
  @{ Name = 'classtime-extension'; Path = Join-Path $Root 'classtime-extension' }
)

foreach ($Addon in $Addons) {
  $Xpi = Join-Path $OutDir ($Addon.Name + '.xpi')
  if (Test-Path $Xpi) { Remove-Item $Xpi -Force }

  Push-Location $Addon.Path
  try {
    Compress-Archive -Path * -DestinationPath $Xpi -Force
  } finally {
    Pop-Location
  }

  Write-Host "Created $Xpi"
  Start-Process $Xpi
}

Write-Host ''
Write-Host 'If Firefox accepts the install prompt, these add-ons are permanent and survive restarts.'
Write-Host 'If Firefox blocks them as unsigned, sign the .xpi files on addons.mozilla.org or use Developer Edition/Nightly/ESR with xpinstall.signatures.required=false.'
