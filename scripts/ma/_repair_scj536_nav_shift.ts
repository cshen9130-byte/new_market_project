/**
 * Thin wrapper — prefer:
 *   npx tsx scripts/ma/_repair_cms_nav_shift.ts --code=SCJ536
 */
import { spawnSync } from "node:child_process"

const extra = process.argv.slice(2)
const result = spawnSync(
  process.execPath,
  [
    ...process.execArgv,
    "scripts/ma/_repair_cms_nav_shift.ts",
    "--code=SCJ536",
    ...extra,
  ],
  { stdio: "inherit", shell: false },
)
process.exit(result.status ?? 1)
