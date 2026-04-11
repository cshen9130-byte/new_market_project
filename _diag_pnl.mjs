import pg from "pg"
import { readFileSync, writeFileSync } from "fs"

try {
  const env = readFileSync(".env.local", "utf8")
  for (const line of env.split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#") || !t.includes("=")) continue
    const [k, ...rest] = t.split("=")
    if (!process.env[k.trim()]) process.env[k.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "")
  }
} catch {}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const n = (col) => `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text,''),',',''),' ',''),'')::numeric,0)`
const q = (sql) => pool.query(sql).then((r) => r.rows)

const rows = await q(`
  SELECT
    COALESCE(d.account, f.account)   AS account,
    COALESCE(d.dt, f.dt)::text       AS date,
    COALESCE(d.dr_pos,  0)           AS daily_report,
    COALESCE(f.fut_pos, 0)           AS futures_position,
    ROUND(COALESCE(d.dr_pos,0) - COALESCE(f.fut_pos,0), 2) AS diff
  FROM
    (SELECT "账户" AS account, "交易日期"::date AS dt,
            SUM(${n("持仓盈亏")}) AS dr_pos
     FROM mom_daily_reports
     GROUP BY 1, 2) d
  FULL JOIN
    (SELECT "账户" AS account, "交易日期"::date AS dt,
            SUM(${n("持仓盈亏")}) AS fut_pos
     FROM mom_futures_position_details
     GROUP BY 1, 2) f
      ON f.account = d.account AND f.dt = d.dt
  WHERE ABS(COALESCE(d.dr_pos,0) - COALESCE(f.fut_pos,0)) > 0.01
  ORDER BY account, date
`)

const total = rows.reduce((s, r) => s + parseFloat(r.diff), 0)
const outPath = "pos_pnl_diff_by_account.csv"

const csvLines = [
  "\uFEFF账户,日期,每日报告_持仓盈亏,期货持仓明细_持仓盈亏,差额(报告-明细)",
  ...rows.map((r) => `"${r.account}",${r.date},${r.daily_report},${r.futures_position},${r.diff}`),
  `合计,,,, ${total.toFixed(2)}`,
]
writeFileSync(outPath, csvLines.join("\r\n"), "utf8")
console.log(`Saved ${rows.length} rows to ${outPath}  (cumulative diff: ${total.toFixed(2)})`)

await pool.end()
