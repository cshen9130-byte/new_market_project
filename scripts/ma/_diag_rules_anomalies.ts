import { ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
import { diagnoseNavAnomaly, type NavSourceSeries } from "../../lib/server/nav-anomaly-cause"
import type { NavAnomalyHit, NavAnomalyPoint } from "../../lib/server/nav-anomaly"

type FlagRow = {
  beian_hao: string
  reason: string
  hit: string
  ratio: string
  snippet: NavAnomalyPoint[]
}

type RawRow = {
  src: string
  code: string
  d: string
  unit: string | null
  adj: string | null
  cum: string | null
}

function num(raw: string | null): number | null {
  if (raw == null || raw === "") return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.001 || Math.abs(a - b) / Math.max(a, b) <= 0.02
}

async function main() {
  ensureScriptDatabaseEnv()
  const { query } = await import("../../lib/db")
  const flags = await query<FlagRow>(
    `SELECT beian_hao, anomaly->>'reason' AS reason, anomaly->>'date' AS hit,
            anomaly->>'ratio' AS ratio, anomaly->'snippet' AS snippet
     FROM ops_nav_series_flags
     WHERE anomaly IS NOT NULL`,
  )
  const codes = [...new Set(flags.map((row) => row.beian_hao))]
  const dates = [...new Set(flags.flatMap((row) => (row.snippet ?? []).map((point) => point.date)))]
  const raw = await query<RawRow>(
    `SELECT src, UPPER(BTRIM(code)) AS code, d, unit, adj, cum FROM (
       SELECT 'fof99' AS src, beian_hao AS code, price_date::text AS d,
              nav::text AS unit, cumulative_nav::text AS adj, cum_nav_withdrawal::text AS cum
       FROM private_fund_nav
       WHERE beian_hao = ANY($1::text[]) AND price_date::text = ANY($2::text[])
       UNION ALL
       SELECT 'type6', beian_hao, price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
       FROM private_fund_nav_group_type6
       WHERE beian_hao = ANY($1::text[]) AND price_date::text = ANY($2::text[])
       UNION ALL
       SELECT 'group', beian_hao, price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
       FROM private_fund_nav_group
       WHERE beian_hao = ANY($1::text[]) AND price_date::text = ANY($2::text[])
       UNION ALL
       SELECT 'hy', beian_hao, price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
       FROM private_fund_nav_group_hy
       WHERE beian_hao = ANY($1::text[]) AND price_date::text = ANY($2::text[])
       UNION ALL
       SELECT 'email', product_code, nav_date::text, nav::text, adjusted_nav::text, cumulative_nav::text
       FROM ops_email_nav_records
       WHERE product_code = ANY($1::text[]) AND nav_date::text = ANY($2::text[])
       UNION ALL
       SELECT 'manual', beian_hao, nav_date::text, unit_nav::text, adjusted_nav::text, cumulative_nav::text
       FROM ops_team_nav_manual
       WHERE beian_hao = ANY($1::text[]) AND nav_date::text = ANY($2::text[]) AND nav_type = 'pre_fee'
     ) t`,
    [codes, dates],
  )
  const byKey = new Map<string, RawRow[]>()
  for (const row of raw) {
    const key = `${row.code}|${row.d}`
    const list = byKey.get(key)
    if (list) list.push(row)
    else byKey.set(key, [row])
  }

  const rules: string[] = []
  for (const flag of flags) {
    const snippet = [...(flag.snippet ?? [])].sort((a, b) => a.date.localeCompare(b.date))
    const sources: NavSourceSeries[] = []
    const grouped = new Map<string, NavSourceSeries>()
    for (const point of snippet) {
      for (const row of byKey.get(`${flag.beian_hao}|${point.date}`) ?? []) {
        let source = grouped.get(row.src)
        if (!source) {
          source = { key: row.src, label: row.src, points: [] }
          grouped.set(row.src, source)
          sources.push(source)
        }
        const unit = num(row.unit)
        const adj = num(row.adj)
        const cum = num(row.cum)
        if (unit != null) source.points.push({ date: point.date, value: unit, field: "unit" })
        if (adj != null) source.points.push({ date: point.date, value: adj, field: "adjusted" })
        if (cum != null) source.points.push({ date: point.date, value: cum, field: "cumulative" })
      }
    }
    const hit: NavAnomalyHit = {
      reason: flag.reason === "spike" ? "spike" : "jump",
      date: flag.hit,
      ratio: Number(flag.ratio),
      snippet,
    }
    const diag = diagnoseNavAnomaly(snippet, sources, hit)
    if (diag.cause !== "rules") continue
    const lines = [`${flag.beian_hao} ${flag.reason} ${flag.hit} ${flag.ratio} ${diag.cause_detail}`]
    for (const point of snippet) {
      const rows = byKey.get(`${flag.beian_hao}|${point.date}`) ?? []
      const bits = rows.map((row) => {
        const mark = [row.unit, row.adj, row.cum]
          .map((value) => (num(value) != null && close(num(value) as number, point.value) ? "*" : ""))
        return `${row.src} u${row.unit ?? "-"} a${row.adj ?? "-"} c${row.cum ?? "-"}${mark.join("")}`
      })
      const star = point.date === flag.hit ? " *" : ""
      lines.push(`  ${point.date} chart ${point.value}${star} ${bits.join(" | ") || "NO RAW"}`)
    }
    rules.push(lines.join("\n"))
  }
  console.log("rules", rules.length)
  console.log(rules.join("\n\n"))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
