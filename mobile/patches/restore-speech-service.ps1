$dest = Join-Path $PSScriptRoot "..\node_modules\expo-speech-recognition\android\src\main\java\expo\modules\speechrecognition\ExpoSpeechService.kt"
$src = Join-Path $PSScriptRoot "ExpoSpeechService.kt"
$dir = Split-Path $dest
if ((Test-Path $src) -and (Test-Path $dir)) {
  Copy-Item -Force $src $dest
  Write-Host "Restored patched ExpoSpeechService.kt"
}