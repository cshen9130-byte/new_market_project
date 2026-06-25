/**
 * One-off: import NAV rows from an xlsx file into private_fund_nav.
 * Usage: npx tsx scripts/ma/import_product_nav_from_xlsx.ts <xlsx-path> [beian_hao] [--through YYYY-MM-DD]
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

function parsePct(value: unknown): number | null {
  if (value == null || value === "" || value === "--") return null
  const s = String(value).trim().replace(/%/g, "").replace(/\+/g, "")
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
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
  if (!xlsxPath) {
    console.error("Usage: npx tsx scripts/ma/import_product_nav_from_xlsx.ts <xlsx-path> [beian_hao] [--through YYYY-MM-DD]")
    process.exit(1)
  }

  let beianHao = ""
  let throughDate = "2026-06-22"
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--through" && args[i + 1]) {
      throughDate = args[i + 1]
      i++
    } else if (!beianHao) {
      beianHao = args[i]
    }
  }

  const wb = XLSX.readFile(xlsxPath, { cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const sheet = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" })
  if (sheet.length < 2) throw new Error("Empty workbook")

  const header = sheet[0].map((c) => String(c ?? "").trim())
  const dateIdx = header.findIndex((h) => /日期/.test(h))
  const unitIdx = header.findIndex((h) => /单位净值/.test(h))
  const cumIdx = header.findIndex((h) => /累计净值/.test(h))
  const adjIdx = header.findIndex((h) => /复权净值/.test(h))
  const chgIdx = header.findIndex((h) => /涨跌幅/.test(h))

  const rows: Array<{
    price_date: string
    nav: number
    cumulative_nav: number
    cum_nav_withdrawal: number
    price_change: number | null
  }> = []

  for (let i = 1; i < sheet.length; i++) {
    const line = sheet[i]
    if (!Array.isArray(line)) continue
    const price_date = formatDate(line[dateIdx >= 0 ? dateIdx : 0])
    if (!price_date || price_date > throughDate) continue
    const nav = parseFloat(String(line[unitIdx >= 0 ? unitIdx : 1] ?? ""))
    if (!Number.isFinite(nav) || nav <= 0) continue
    const cum_nav_withdrawal = parseFloat(String(line[cumIdx >= 0 ? cumIdx : 2] ?? nav)) || nav
    const cumulative_nav =
      adjIdx >= 0
        ? parseFloat(String(line[adjIdx] ?? cum_nav_withdrawal)) || cum_nav_withdrawal
        : cum_nav_withdrawal
    const price_change = chgIdx >= 0 ? parsePct(line[chgIdx]) : null
    rows.push({ price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change })
  }

  if (rows.length === 0) throw new Error("No valid rows found")

  if (!beianHao) {
    const stem = xlsxPath.split(/[/\\]/).pop()?.replace(/\.xlsx?$/i, "") ?? ""
    const nameGuess = stem.replace(/净值\d+$/, "").trim()
    const found = await query<{ beian_hao: string; product_name: string }>(
      `SELECT beian_hao, product_name
       FROM private_fund_info
       WHERE product_name = $1
          OR product_name LIKE $2
       ORDER BY CASE WHEN product_name = $1 THEN 0 ELSE 1 END
       LIMIT 5`,
      [nameGuess, `%${nameGuess.slice(0, 8)}%`],
    )
    if (found.length === 0) throw new Error(`No fund found for name guess: ${nameGuess}`)
    beianHao = found[0].beian_hao
    console.log(`Matched fund: ${found[0].product_name} (${beianHao})`)
  }

  const info = await query<{ product_name: string }>(
    `SELECT product_name FROM private_fund_info WHERE beian_hao = $1 LIMIT 1`,
    [beianHao],
  )
  const productName = info[0]?.product_name ?? ""

  rows.sort((a, b) => a.price_date.localeCompare(b.price_date))

  // Recompute 涨跌幅 as percentage points from consecutive unit NAV (UI format).
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].nav
    rows[i].price_change = prev > 0 ? ((rows[i].nav / prev - 1) * 100) : null
  }
  if (rows.length > 0) rows[0].price_change = null

  let upserted = 0
  for (const row of rows) {
    await query(
      `INSERT INTO private_fund_nav
         (beian_hao, product_name, price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7)
       ON CONFLICT (beian_hao, price_date) DO UPDATE SET
         product_name       = EXCLUDED.product_name,
         nav                = EXCLUDED.nav,
         cumulative_nav     = EXCLUDED.cumulative_nav,
         cum_nav_withdrawal = EXCLUDED.cum_nav_withdrawal,
         price_change       = EXCLUDED.price_change`,
      [
        beianHao,
        productName,
        row.price_date,
        row.nav,
        row.cumulative_nav,
        row.cum_nav_withdrawal,
        row.price_change,
      ],
    )
    upserted++
  }

  const latest = rows[rows.length - 1]
  console.log(`Upserted ${upserted} NAV rows through ${throughDate}`)
  console.log(`Latest: ${latest.price_date} nav=${latest.nav} chg=${latest.price_change?.toFixed(2)}%`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
