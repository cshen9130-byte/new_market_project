import { ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
import { analyzeNavAnomaly, chartNavLevel } from "../../lib/server/nav-anomaly"
import { diagnoseNavAnomaly, type NavSourceSeries } from "../../lib/server/nav-anomaly-cause"
async function main() {
  ensureScriptDatabaseEnv()
  const { loadMergedFundNavRows } = await import("../../lib/server/fund-nav-series")
  const { query } = await import("../../lib/db")
  const rows = await loadMergedFundNavRows("SVL369", "德贝中证1000指数增强1号私募证券投资基金", "德贝中证1000指数增强1号私募证券投资基金")
  const points = rows.map(r => {
    const v = chartNavLevel({ adjusted: r.cumulative_nav, cumulative: r.cum_nav_withdrawal, unit: r.nav })
    return v == null ? null : { date: r.price_date.slice(0,10), value: v }
  }).filter(Boolean) as {date:string;value:number}[]
  const stats = analyzeNavAnomaly(points)
  console.log(stats)
  if (!stats.anomalous) return
  const idx = points.findIndex(p => p.date === stats.date)
  for (const p of points.slice(Math.max(0,idx-2), idx+3)) {
    const r = rows.find(x => x.price_date.slice(0,10)===p.date)
    console.log(p.date, "chart", p.value, "u", r?.nav, "a", r?.cumulative_nav, "c", r?.cum_nav_withdrawal)
  }
}
main().catch(e=>{console.error(e);process.exit(1)})
