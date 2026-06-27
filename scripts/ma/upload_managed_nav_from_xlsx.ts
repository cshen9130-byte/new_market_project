/**
 * Upload corrected NAV rows for a 在管产品 (managed product) from xlsx into
 * ops_team_nav_manual, overriding any wrong email / previous manual rows.
 *
 * Usage:
 *   npx tsx scripts/ma/upload_managed_nav_from_xlsx.ts <xlsx-path> <beian_hao> [--from YYYY-MM-DD]
 *
 * The --from flag limits which dates get written (default: all rows in the file).
 * Rows already in the table are updated via ON CONFLICT DO UPDATE.
 */
import fs from "fs"
import path from "path"
import * as XLSX from "xlsx"
import { query } from "../../lib/db"

for (const fname of [".env.local", ".env"]) {
  const envPath = path.join(process.cwd(), fname)
  if (!fs.existsSync(envPath)) continue
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2]
  }
}

function formatDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  const s = String(value ?? "").trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}

async function main() {
  const args = process.argv.slice(2)
  const xlsxPath = args[0]
  const beianHao = args[1]
  if (!xlsxPath || !beianHao) {
    console.error("Usage: npx tsx scripts/ma/upload_managed_nav_from_xlsx.ts <xlsx-path> <beian_hao> [--from YYYY-MM-DD]")
    process.exit(1)
  }

  let fromDate = ""
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1]) {
      fromDate = args[i + 1]
      i++
    }
  }

  const wb = XLSX.readFile(xlsxPath, { cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const sheet = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" })
  if (sheet.length < 2) throw new Error("Empty workbook")

  const header = (sheet[0] as unknown[]).map((c) => String(c ?? "").trim())
  const dateIdx = header.findIndex((h) => /日期/.test(h))
  const unitIdx = header.findIndex((h) => /单位净值/.test(h))
  const cumIdx  = header.findIndex((h) => /累计净值/.test(h))

  const rows: Array<{ nav_date: string; unit_nav: number; cumulative_nav: number }> = []

  for (let i = 1; i < sheet.length; i++) {
    const line = sheet[i] as unknown[]
    if (!Array.isArray(line)) continue
    const nav_date = formatDate(line[dateIdx >= 0 ? dateIdx : 0])
    if (!nav_date) continue
    if (fromDate && nav_date < fromDate) continue
    const unit_nav = parseFloat(String(line[unitIdx >= 0 ? unitIdx : 1] ?? ""))
    if (!Number.isFinite(unit_nav) || unit_nav <= 0) continue
    const cumulative_nav = parseFloat(String(line[cumIdx >= 0 ? cumIdx : 2] ?? unit_nav)) || unit_nav
    rows.push({ nav_date, unit_nav, cumulative_nav })
  }

  if (rows.length === 0) throw new Error("No valid rows found")
  rows.sort((a, b) => a.nav_date.localeCompare(b.nav_date))

  // Ensure table exists
  await query(`
    CREATE TABLE IF NOT EXISTS ops_team_nav_manual (
      id             SERIAL PRIMARY KEY,
      beian_hao      VARCHAR(64) NOT NULL,
      nav_date       DATE NOT NULL,
      unit_nav       NUMERIC(16,6) NOT NULL,
      cumulative_nav NUMERIC(16,6),
      nav_type       VARCHAR(16) NOT NULL DEFAULT 'pre_fee',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (beian_hao, nav_date, nav_type)
    )
  `)

  let upserted = 0
  for (const row of rows) {
    await query(
      `INSERT INTO ops_team_nav_manual (beian_hao, nav_date, unit_nav, cumulative_nav, nav_type)
       VALUES ($1, $2::date, $3::numeric, $4::numeric, 'pre_fee')
       ON CONFLICT (beian_hao, nav_date, nav_type) DO UPDATE SET
         unit_nav       = EXCLUDED.unit_nav,
         cumulative_nav = EXCLUDED.cumulative_nav,
         created_at     = NOW()`,
      [beianHao, row.nav_date, row.unit_nav, row.cumulative_nav],
    )
    upserted++
  }

  const latest = rows[rows.length - 1]
  console.log(`Upserted ${upserted} rows into ops_team_nav_manual for ${beianHao}`)
  console.log(`Latest: ${latest.nav_date}  unit_nav=${latest.unit_nav}  cum_nav=${latest.cumulative_nav}`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
