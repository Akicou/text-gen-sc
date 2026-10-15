# Packages the Firefox add-ons as .xpi files and installs them permanently in
# Firefox Developer Edition by placing them in the profile's extensions folder.
# Unsigned add-ons survive restarts there once xpinstall.signatures.required is
# false; regular Firefox only keeps signed ones.
# Close Developer Edition before running: prefs and extensions load on startup.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutDir = Join-Path $Root 'build\firefox-addons'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Firefox = Join-Path $env:ProgramFiles 'Firefox Developer Edition\firefox.exe'
if (-not (Test-Path $Firefox)) {
  throw "Firefox Developer Edition not found at $Firefox"
}

$Profiles = Join-Path $env:APPDATA 'Mozilla\Firefox\Profiles'
$DevProfile = Get-ChildItem $Profiles -Directory -Filter '*.dev-edition-default' | Select-Object -First 1
if (-not $DevProfile) {
  throw 'Developer Edition profile not found. Start Developer Edition once, close it, then rerun.'
}

# Allow unsigned add-ons and auto-enable add-ons dropped into the profile folder.
$UserJs = Join-Path $DevProfile.FullName 'user.js'
$Prefs = @(
  'user_pref("xpinstall.signatures.required", false);',
  'user_pref("extensions.autoDisableScopes", 0);'
)
foreach ($Pref in $Prefs) {
  if (-not ((Test-Path $UserJs) -and (Select-String -Path $UserJs -SimpleMatch $Pref -Quiet))) {
    Add-Content -Path $UserJs -Value $Pref
    Write-Host "Added $Pref to $UserJs"
  }
}

$ExtDir = Join-Path $DevProfile.FullName 'extensions'
New-Item -ItemType Directory -Force -Path $ExtDir | Out-Null

$Addons = @(
  @{ Name = 'moodle-extractor'; Path = Join-Path $Root 'moodle-extractor' },
  @{ Name = 'classtime-extension'; Path = Join-Path $Root 'classtime-extension' }
)

foreach ($Addon in $Addons) {
  $Xpi = Join-Path $OutDir ($Addon.Name + '.xpi')
  if (Test-Path $Xpi) { Remove-Item $Xpi -Force }

  # Firefox rejects zip entries with backslashes, so write forward-slash paths explicitly.
  $Zip = [System.IO.Compression.ZipFile]::Open($Xpi, 'Create')
  try {
    Get-ChildItem -Path $Addon.Path -Recurse -File | ForEach-Object {
      $Entry = $_.FullName.Substring($Addon.Path.Length + 1).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($Zip, $_.FullName, $Entry) | Out-Null
    }
  } finally {
    $Zip.Dispose()
  }

  # Firefox loads <profile>\extensions\<gecko id>.xpi on startup.
  $Manifest = Get-Content (Join-Path $Addon.Path 'manifest.json') -Raw | ConvertFrom-Json
  $Id = $Manifest.browser_specific_settings.gecko.id
  Copy-Item $Xpi (Join-Path $ExtDir ($Id + '.xpi')) -Force
  Write-Host "Installed $($Addon.Name) as $Id"
}

Start-Process $Firefox -ArgumentList 'about:addons'

Write-Host ''
Write-Host 'Done. The add-ons are permanent in Firefox Developer Edition; rerun this script to update them.'
