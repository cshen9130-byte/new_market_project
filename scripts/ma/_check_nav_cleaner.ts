import { analyzeNavWorkbook } from "../../lib/server/nav-cleaner"
import fs from "fs"

const xlsxPath = process.argv[2] ?? "C:/Users/13904/Downloads/荣熙恒盈2号净值20260625.xlsx"
const analysis = analyzeNavWorkbook(fs.readFileSync(xlsxPath), "check.xlsx")

console.log("Detected columns:", JSON.stringify(analysis.detectedColumns, null, 2))
console.log("Total rows:", analysis.rows.length)
console.log("\nFirst 3 rows:")
for (const r of analysis.rows.slice(0, 3)) {
  console.log(`  ${r.date}  unit=${r.unitNav}  cum=${r.cumulativeNav}  adj=${r.adjustedNav}`)
}
console.log("\nLast 5 rows:")
for (const r of analysis.rows.slice(-5)) {
  console.log(`  ${r.date}  unit=${r.unitNav}  cum=${r.cumulativeNav}  adj=${r.adjustedNav}`)
}

// Find dividend date (around 2026-04-30)
console.log("\nRows around 2026-04-30:")
for (const r of analysis.rows.filter(r => r.date >= "2026-04-28" && r.date <= "2026-05-06")) {
  console.log(`  ${r.date}  unit=${r.unitNav}  cum=${r.cumulativeNav}  adj=${r.adjustedNav}`)
}
process.exit(0)
