/**
 * One-off CLI: standardize all mom_data xlsx filenames and folder names.
 *
 *   npx tsx scripts/ma/run_standardize_names.mts
 */
import { formatStandardizeNamesSummary, standardizeMomDataNames } from "../../lib/server/mom-data-standardize-names.ts"

const result = standardizeMomDataNames()

console.log(JSON.stringify(result, null, 2))
for (const line of formatStandardizeNamesSummary(result)) {
  console.log(line)
}
if (result.errors.length > 0) {
  for (const err of result.errors.slice(0, 20)) {
    console.error(err)
  }
  if (result.errors.length > 20) {
    console.error(`… and ${result.errors.length - 20} more errors`)
  }
  process.exit(1)
}
