import { ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
import { chartNavLevel } from "../../lib/server/nav-anomaly"

const CASES = [
  { code: "SVL369", around: "2023-07-17" },
  { code: "SLC571", around: "2025-06-24" },
  { code: "LC571B", around: "2024-06-26" },
  { code: "SEM163", around: "2019-01-14" },
  { code: "SVP162", around: "2026-02-06" },
  { code: "SLN974", around: "2025-03-28" },
  { code: "SGK119", around: "2021-03-26" },
  { code: "S39917", around: "2024-03-01" },
  { code: "SXV381", around: "2025-04-24" },
  { code: "SCB622", around: "2020-04-13" },
  { code: "SD9197", around: "2021-07-08" },
  { code: "SQD690", around: "2021-09-24" },
  { code: "SJE164", around: "2020-07-21" },
  { code: "SNN006", around: "2024-08-02" },
]

async function main() {
  ensureScriptDatabaseEnv()
  const { query } = await import("../../lib/db")
  const { loadMergedFundNavRows } = await import("../../lib/server/fund-nav-series")
  for (const { code, around } of CASES) {
    const names = await query<{ product_name: string }>(
      `SELECT product_name FROM private_fund_info WHERE beian_hao = $1 LIMIT 1`, [code],
    )
    const name = names[0]?.product_name || code
    const rows = await loadMergedFundNavRows(code, name, name)
    const idx = rows.findIndex((r) => r.price_date.slice(0, 10) >= around)
    const from = Math.max(0, idx - 4)
    const to = Math.min(rows.length, idx + 5)
    console.log(`\n===== ${code} ${name} around ${around} =====`)
    for (let i = from; i < to; i++) {
      const r = rows[i]
      const d = r.price_date.slice(0, 10)
      const chart = chartNavLevel({ adjusted: r.cumulative_nav, cumulative: r.cum_nav_withdrawal, unit: r.nav })
      console.log(`${d} u=${r.nav} a=${r.cumulative_nav} c=${r.cum_nav_withdrawal} chart=${chart} tip=${(r as any).tip ?? ""} src=${(r as any).source ?? (r as any).nav_source ?? ""}`)
    }
    // raw around window
    const dates = rows.slice(from, to).map((r) => r.price_date.slice(0, 10))
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
         SELECT 'hy', price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
         FROM private_fund_nav_group_hy WHERE beian_hao = $1 AND price_date::text = ANY($2::text[])
         UNION ALL
         SELECT 'email', nav_date::text, nav::text, adjusted_nav::text, cumulative_nav::text
         FROM ops_email_nav_records WHERE product_code = $1 AND nav_date::text = ANY($2::text[])
         UNION ALL
         SELECT 'manual', nav_date::text, unit_nav::text, adjusted_nav::text, cumulative_nav::text
         FROM ops_team_nav_manual WHERE beian_hao = $1 AND nav_date::text = ANY($2::text[]) AND nav_type = 'pre_fee'
       ) t ORDER BY d, src`,
      [code, dates],
    )
    for (const row of raw) console.log(`  RAW ${row.src} ${row.d} u${row.unit} a${row.adj} c${row.cum}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
