param(
  [string]$Apk = "$PSScriptRoot\..\public\app\fof-research.apk",
  [string]$Version = "$PSScriptRoot\..\public\app\version.json"
)

$ErrorActionPreference = "Stop"
$key = Join-Path $env:USERPROFILE ".ssh\id_ed25519_server"
if (-not (Test-Path $Apk)) { throw "Missing APK: $Apk" }
if (-not (Test-Path $Version)) { throw "Missing version file: $Version" }

ssh -i $key -o BatchMode=yes root@8.154.33.143 "mkdir -p /root/new_market_project/public/app"
scp -i $key -o BatchMode=yes $Apk "${Version}" root@8.154.33.143:/root/new_market_project/public/app/
Write-Output "Published $(Split-Path $Apk -Leaf) and version.json"
