import { config } from "dotenv"
import { resolve } from "node:path"
config({ path: resolve(process.cwd(), ".env.local") })
config({ path: resolve(process.cwd(), ".env") })

async function main() {
  const weeks = process.argv.slice(2)
  const { generateAndCacheWeeklyReviewExcel } = await import("../../lib/server/weekly-review-excel-cache")
  const results = []
  for (const weekEnd of weeks) {
    try {
      const meta = await generateAndCacheWeeklyReviewExcel("equity", weekEnd, ["jy"])
      results.push({ weekEnd, ok: true, fileName: meta.fileName })
      console.log(JSON.stringify({ weekEnd, ok: true, fileName: meta.fileName }))
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      results.push({ weekEnd, ok: false, error })
      console.error(JSON.stringify({ weekEnd, ok: false, error }))
    }
  }
  console.log(JSON.stringify({ results }, null, 2))
  if (results.some((row) => !row.ok)) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
