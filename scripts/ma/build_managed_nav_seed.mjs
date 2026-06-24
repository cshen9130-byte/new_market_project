/**
 * Build managed-product NAV seed JSON from reference xlsx (rows before a cutoff date).
 * Usage: npx tsx scripts/ma/build_managed_nav_seed.mjs <xlsx-path> <beian_hao> [--before YYYY-MM-DD]
 */
import { analyzeNavWorkbook } from "../../lib/server/nav-cleaner.ts"
import fs from "fs"
import path from "path"

const args = process.argv.slice(2)
const xlsxPath = args[0]
const beianHao = args[1]
let beforeDate = "2026-01-16"
for (let i = 2; i < args.length; i++) {
  if (args[i] === "--before" && args[i + 1]) {
    beforeDate = args[i + 1]
    i++
  } else if (args[i] === "--all") {
    beforeDate = null
  }
}

if (!xlsxPath || !beianHao) {
  console.error("Usage: npx tsx scripts/ma/build_managed_nav_seed.mjs <xlsx-path> <beian_hao> [--before YYYY-MM-DD]")
  process.exit(1)
}

const analysis = analyzeNavWorkbook(fs.readFileSync(xlsxPath), path.basename(xlsxPath))
const rows = analysis.rows
  .filter((r) => beforeDate == null || r.date < beforeDate)
  .map((r) => ({
    price_date: r.date,
    nav: String(r.unitNav),
    cumulative_nav: String(r.adjustedNav ?? r.cumulativeNav),
    cum_nav_withdrawal: String(r.cumulativeNav),
    price_change: "",
  }))

const outDir = path.join(process.cwd(), "data", "managed-product-nav")
fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, `${beianHao}.json`)
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      beian_hao: beianHao,
      before_date: beforeDate,
      source_file: path.basename(xlsxPath),
      row_count: rows.length,
      rows,
    },
    null,
    2,
  ),
)
console.log(`Wrote ${rows.length} rows to ${outPath}${beforeDate ? ` (before ${beforeDate})` : " (full series)"}`)
