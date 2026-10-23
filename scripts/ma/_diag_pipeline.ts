import { ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
import { chartNavLevel } from "../../lib/server/nav-anomaly"

const CASES = [
  { code: "SEM163", from: "2019-01-08", to: "2019-01-18" },
  { code: "S39917", from: "2024-02-20", to: "2024-04-05" },
  { code: "SJE164", from: "2020-07-15", to: "2020-07-27" },
  { code: "SLN974", from: "2025-03-24", to: "2025-04-03" },
  { code: "SD9197", from: "2021-07-02", to: "2021-07-14" },
  { code: "SCB622", from: "2020-04-07", to: "2020-04-17" },
  { code: "SXV381", from: "2025-04-18", to: "2025-04-30" },
  { code: "SVL369", from: "2023-06-30", to: "2023-07-21" },
  { code: "SGK119", from: "2021-03-05", to: "2021-04-16" },
  { code: "SQD690", from: "2021-09-03", to: "2021-10-08" },
]

async function main() {
  ensureScriptDatabaseEnv()
  const { query } = await import("../../lib/db")
  const { loadPrivateFundLegacyNavRows, mergeNavSeriesWithEmail } = await import("../../lib/server/email-nav-query")
  const { loadMergedFundNavRows } = await import("../../lib/server/fund-nav-series")
  for (const { code, from, to } of CASES) {
    const names = await query<{ product_name: string }>(`SELECT product_name FROM private_fund_info WHERE beian_hao=$1 LIMIT 1`, [code])
    const name = names[0]?.product_name || code
    const legacy = await loadPrivateFundLegacyNavRows(code)
    const merged = await mergeNavSeriesWithEmail(legacy, [], { beian_hao: code, product_name: name })
    const full = await loadMergedFundNavRows(code, name, name)
    console.log(`\n===== ${code} =====`)
    const days = full.filter(r => { const d=r.price_date.slice(0,10); return d>=from && d<=to }).map(r=>r.price_date.slice(0,10))
    for (const d of days) {
      const L = legacy.find(r => r.price_date.slice(0,10)===d)
      const M = merged.find(r => r.price_date.slice(0,10)===d)
      const F = full.find(r => r.price_date.slice(0,10)===d)
      const fmt = (r: any) => r ? `u${r.nav} a${r.cumulative_nav} c${r.cum_nav_withdrawal} o${r.legacy_origin||""}` : "-"
      console.log(`${d}\n  L ${fmt(L)}\n  M ${fmt(M)}\n  F ${fmt(F)}`)
    }
  }
}
main().catch(e=>{console.error(e);process.exit(1)})
