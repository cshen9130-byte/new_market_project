import { ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
import { analyzeNavAnomaly, chartNavLevel, type NavAnomalyPoint } from "../../lib/server/nav-anomaly"
import { diagnoseNavAnomaly, type NavSourceSeries } from "../../lib/server/nav-anomaly-cause"

const CODES = [
  "SJE164", "SGK119", "SVP162", "SLN974", "SN3648", "SCB622", "SEM163", "SGH173",
  "SLC571", "SSH449", "LC571B", "SD9197", "SVL369", "SVC066", "SXV381", "S39917",
  "SCY439", "SST556", "SQD690",
]

function num(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

async function main() {
  ensureScriptDatabaseEnv()
  const { query } = await import("../../lib/db")
  const { loadMergedFundNavRows } = await import("../../lib/server/fund-nav-series")
  const names = await query<{ beian_hao: string; product_name: string }>(
    `SELECT beian_hao, product_name FROM private_fund_info WHERE beian_hao = ANY($1::text[])`,
    [CODES],
  )
  const nameOf = new Map(names.map((row) => [row.beian_hao, row.product_name]))
  for (const code of CODES) {
    const name = nameOf.get(code) || code
    const rows = await loadMergedFundNavRows(code, name, name)
    const points: NavAnomalyPoint[] = []
    for (const row of rows) {
      const value = chartNavLevel({
        adjusted: row.cumulative_nav,
        cumulative: row.cum_nav_withdrawal,
        unit: row.nav,
      })
      if (value != null) points.push({ date: row.price_date.slice(0, 10), value })
    }
    const stats = analyzeNavAnomaly(points)
    if (!stats.anomalous) {
      console.log(code, "clean")
      continue
    }
    const dates = stats.snippet.map((point) => point.date)
    const raw = await query<{ src: string; d: string; unit: string | null; adj: string | null; cum: string | null }>(
      `SELECT src, d, unit, adj, cum FROM (
         SELECT 'fof99' AS src, price_date::text AS d, nav::text AS unit, cumulative_nav::text AS adj, cum_nav_withdrawal::text AS cum
         FROM private_fund_nav WHERE beian_hao = $1 AND price_date::text = ANY($2::text[])
         UNION ALL
         SELECT 'type6', price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
         FROM private_fund_nav_group_type6 WHERE beian_hao = $1 AND price_date::text = ANY($2::text[])
         UNION ALL
         SELECT 'group', price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
         FROM private_fund_nav_group WHERE beian_hao = $1 AND price_date::text = ANY($2::text[])
         UNION ALL
         SELECT 'email', nav_date::text, nav::text, adjusted_nav::text, cumulative_nav::text
         FROM ops_email_nav_records WHERE product_code = $1 AND nav_date::text = ANY($2::text[])
       ) t ORDER BY d, src`,
      [code, dates],
    )
    const sources: NavSourceSeries[] = []
    const grouped = new Map<string, NavSourceSeries>()
    for (const row of raw) {
      let source = grouped.get(row.src)
      if (!source) {
        source = { key: row.src, label: row.src, points: [] }
        grouped.set(row.src, source)
        sources.push(source)
      }
      const unit = num(row.unit)
      const adj = num(row.adj)
      const cum = num(row.cum)
      if (unit != null) source.points.push({ date: row.d, value: unit, field: "unit" })
      if (adj != null) source.points.push({ date: row.d, value: adj, field: "adjusted" })
      if (cum != null) source.points.push({ date: row.d, value: cum, field: "cumulative" })
    }
    const diag = diagnoseNavAnomaly(points, sources, {
      reason: stats.reason as "jump" | "spike",
      date: stats.date,
      ratio: stats.ratio,
      snippet: stats.snippet,
    })
    console.log(`\n${code} ${stats.reason} ${stats.date} ${stats.ratio.toFixed(6)} ${diag.cause} ${diag.cause_detail}`)
    const focus = new Set([stats.snippet[Math.max(0, stats.snippet.findIndex((p) => p.date === stats.date) - 1)]?.date, stats.date, stats.snippet[stats.snippet.findIndex((p) => p.date === stats.date) + 1]?.date])
    for (const point of stats.snippet) {
      if (!focus.has(point.date)) continue
      const row = rows.find((item) => item.price_date.slice(0, 10) === point.date)
      const bits = raw.filter((item) => item.d === point.date).map((item) => `${item.src} u${item.unit} a${item.adj} c${item.cum}`)
      console.log(`  ${point.date} chart ${point.value} merged u${row?.nav} a${row?.cumulative_nav} c${row?.cum_nav_withdrawal} ${bits.join(" | ") || "NO RAW"}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
