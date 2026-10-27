/**
 * Cross-platform postinstall for EAS (Linux/Mac builders) and local Windows.
 * Only restores the Android ExpoSpeechService.kt patch on Windows.
 */
const { spawnSync } = require('child_process');
const path = require('path');

if (process.platform !== 'win32') {
  process.exit(0);
}

const script = path.join(__dirname, 'restore-speech-service.ps1');
const result = spawnSync(
  'powershell',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
  { stdio: 'inherit' }
);
process.exit(result.status == null ? 1 : result.status);
