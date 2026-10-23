import { ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
import { analyzeNavAnomaly, chartNavLevel } from "../../lib/server/nav-anomaly"

const CODES = [
  "SJE164", "SGK119", "SVP162", "SLN974", "SN3648", "SCB622", "SEL138", "SEM163",
  "SGH173", "SGL366", "SJ4234", "SLC571", "SNN006", "QS560A", "SY2679", "SSH449",
  "LC571B", "SD9197", "SVL369", "SVC066", "SQG174", "SQS560", "SXV381", "S39917",
  "SS6192", "SCY439", "SST556", "SQD690",
]

async function main() {
  ensureScriptDatabaseEnv()
  const { query } = await import("../../lib/db")
  const { loadMergedFundNavRows } = await import("../../lib/server/fund-nav-series")
  const names = await query<{ beian_hao: string; product_name: string }>(
    `SELECT beian_hao, product_name FROM private_fund_info WHERE beian_hao = ANY($1::text[])`,
    [CODES],
  )
  const nameOf = new Map(names.map((row) => [row.beian_hao, row.product_name]))
  const flags = await query<{ beian_hao: string; hit: string; ratio: string; reason: string }>(
    `SELECT beian_hao, anomaly->>'date' AS hit, anomaly->>'ratio' AS ratio, anomaly->>'reason' AS reason
     FROM ops_nav_series_flags WHERE beian_hao = ANY($1::text[])`,
    [CODES],
  )
  const flagOf = new Map(flags.map((row) => [row.beian_hao, row]))
  for (const code of CODES) {
    const name = nameOf.get(code) || code
    const flag = flagOf.get(code)
    const rows = await loadMergedFundNavRows(code, name, name)
    const points = rows.map((row) => {
      const value = chartNavLevel({
        adjusted: row.cumulative_nav,
        cumulative: row.cum_nav_withdrawal,
        unit: row.nav,
      })
      return value == null ? null : { date: row.price_date.slice(0, 10), value }
    }).filter((point): point is { date: string; value: number } => point != null)
    const hit = analyzeNavAnomaly(points)
    const at = flag ? points.find((point) => point.date === flag.hit) : undefined
    const prev = flag ? points.filter((point) => point.date < flag.hit).at(-1) : undefined
    console.log([
      code,
      flag ? `${flag.reason} ${flag.hit} cached ${flag.ratio}` : "no flag",
      at ? `live ${at.value}` : "live missing",
      prev ? `prev ${prev.date} ${prev.value}` : "",
      hit.anomalous ? `still ${hit.reason} ${hit.date} ${hit.ratio.toFixed(6)}` : "clean",
      `n=${points.length}`,
    ].join(" | "))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
