param(
  [string]$Apk = "$PSScriptRoot\..\public\app\fof-research.apk",
  [string]$Version = "$PSScriptRoot\..\public\app\version.json"
)

$ErrorActionPreference = "Stop"
$key = Join-Path $env:USERPROFILE ".ssh\id_ed25519_server"
if (-not (Test-Path $Apk)) { throw "Missing APK: $Apk" }
if (-not (Test-Path $Version)) { throw "Missing version file: $Version" }

$meta = Get-Content $Version -Raw | ConvertFrom-Json
$wantCode = [int]$meta.versionCode
$wantName = [string]$meta.versionName
if ($wantCode -lt 1 -or [string]::IsNullOrWhiteSpace($wantName)) {
  throw "version.json missing versionCode/versionName"
}

$sdkDir = $null
$localProps = Join-Path $PSScriptRoot "..\mobile\android\local.properties"
if (Test-Path $localProps) {
  $line = Get-Content $localProps | Where-Object { $_ -match '^\s*sdk\.dir=' } | Select-Object -First 1
  if ($line) { $sdkDir = (($line -split '=', 2)[1]).Trim() -replace '\\\\', '\' }
}
if (-not $sdkDir) {
  foreach ($c in @(
    "$env:LOCALAPPDATA\Android\Sdk",
    "$env:USERPROFILE\Android\Sdk",
    "C:\Users\13904\Android\Sdk"
  )) { if (Test-Path $c) { $sdkDir = $c; break } }
}
if (-not $sdkDir) { throw "Android SDK not found; cannot verify APK version before publish" }

$aapt = Get-ChildItem "$sdkDir\build-tools" -Directory | Sort-Object Name -Descending |
  ForEach-Object { Join-Path $_.FullName "aapt.exe" } |
  Where-Object { Test-Path $_ } |
  Select-Object -First 1
if (-not $aapt) { throw "aapt.exe not found under $sdkDir\build-tools" }

$badging = & $aapt dump badging $Apk 2>&1 | Select-Object -First 1
$escapedName = [regex]::Escape($wantName)
if ($badging -notmatch "versionCode='$wantCode'" -or $badging -notmatch "versionName='$escapedName'") {
  throw "APK native version does not match version.json. want=$wantName ($wantCode); aapt=$badging"
}
Write-Output "Verified APK native version $wantName ($wantCode) matches version.json"

if ($meta.sha256) {
  $wantSha = ([string]$meta.sha256).Trim().ToLower()
  $actualSha = (Get-FileHash $Apk -Algorithm SHA256).Hash.ToLower()
  if ($wantSha -ne $actualSha) {
    throw "APK sha256 mismatch. version.json=$wantSha actual=$actualSha"
  }
  Write-Output "Verified APK sha256 matches version.json"
}

ssh -i $key -o BatchMode=yes root@8.154.33.143 "mkdir -p /root/new_market_project/public/app /var/www/market_dashboard_website/app"
scp -i $key -o BatchMode=yes $Apk "${Version}" root@8.154.33.143:/root/new_market_project/public/app/
ssh -i $key -o BatchMode=yes root@8.154.33.143 "cp -f /root/new_market_project/public/app/fof-research.apk /root/new_market_project/public/app/version.json /var/www/market_dashboard_website/app/ && chmod a+r /var/www/market_dashboard_website/app/fof-research.apk /var/www/market_dashboard_website/app/version.json"
Write-Output "Published $(Split-Path $Apk -Leaf) and version.json ($wantName / $wantCode)"