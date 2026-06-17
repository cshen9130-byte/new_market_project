/**
 * Test 估值表 parsing against a local .xls/.xlsx file.
 *
 * Usage:
 *   npx tsx scripts/ma/test_valuation_parse.ts path/to/valuation.xls
 */

import { readFileSync } from "fs"
import { basename } from "path"
import { extractValuationFromBuffer } from "@/lib/server/email-valuation-attachment"

const filePath = process.argv[2]
if (!filePath) {
  console.error("Usage: npx tsx scripts/ma/test_valuation_parse.ts <file.xls|xlsx>")
  process.exit(1)
}

const buffer = readFileSync(filePath)
const filename = basename(filePath)
const subject = filename

const result = extractValuationFromBuffer(buffer, filename, subject)
if (!result) {
  console.log(JSON.stringify({ ok: false, filename, error: "parse failed" }, null, 2))
  process.exit(1)
}

console.log(
  JSON.stringify(
    {
      ok: true,
      filename,
      productCode: result.productCode,
      fundName: result.fundName,
      valuationDate: result.valuationDate,
      unitNav: result.unitNav,
      cumulativeNav: result.cumulativeNav,
      custodyBalance: result.custodyBalance,
      netAssetValue: result.netAssetValue,
      totalAsset: result.totalAsset,
      totalLiability: result.totalLiability,
      holdingsCount: result.holdingsCount,
      summary: result.analysis.summary,
      sampleHoldings: result.analysis.portfolio_data
        .filter((row) => row.include_in_detail)
        .slice(0, 5)
        .map((row) => ({
          code: row.code,
          name: row.name,
          market_value: row.market_value,
          quantity: row.quantity ?? row.position,
        })),
    },
    null,
    2,
  ),
)
