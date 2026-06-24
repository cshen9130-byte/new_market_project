import { loadProjectEnvFiles } from "../../lib/server/load-project-env.ts"
import { loadEmailNavSeries, mergeNavSeriesWithEmail } from "../../lib/server/email-nav-query.ts"

loadProjectEnvFiles()

const code = process.argv[2] ?? "SBTX45"
const name = process.argv[3] ?? "衡颐承和FOF1号"

const emailRows = await loadEmailNavSeries(code, name, null, [name])
const merged = mergeNavSeriesWithEmail([], emailRows)
console.log(`Merged latest 8 for ${code}:`)
for (const r of merged.slice(-8)) {
  console.log(`  ${r.price_date}  unit=${r.nav}`)
}
