/**
 * Import custodian NAV CSV into ops_team_nav_manual with is_protected=true.
 * Usage: npx tsx scripts/ma/import_protected_nav_from_excel.ts
 */
import fs from "fs"
import path from "path"

function loadEnv() {
  for (const fname of [".env.local", ".env"]) {
    const envPath = path.join(process.cwd(), fname)
    if (!fs.existsSync(envPath)) continue
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2]
    }
  }
}

function formatDate(value: unknown): string | null {
  const s = String(value ?? "").trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  const n = Number(s)
  if (Number.isFinite(n) && n > 20000101 && n < 21001231) {
    const t = String(Math.trunc(n))
    if (t.length === 8) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
  }
  return null
}

function parseNum(value: unknown): number | null {
  const n = parseFloat(String(value ?? "").trim().replace(/,/g, ""))
  return Number.isFinite(n) && n > 0 ? n : null
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ""
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') inQ = false
      else cur += ch
      continue
    }
    if (ch === '"') {
      inQ = true
      continue
    }
    if (ch === ",") {
      row.push(cur)
      cur = ""
      continue
    }
    if (ch === "\n") {
      row.push(cur)
      rows.push(row)
      row = []
      cur = ""
      continue
    }
    if (ch === "\r") continue
    cur += ch
  }
  if (cur.length || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows
}

type Row = { nav_date: string; unit_nav: number; cumulative_nav: number }

function readCsvNav(filePath: string): Row[] {
  const sheet = parseCsv(fs.readFileSync(filePath, "utf8"))
  if (sheet.length < 2) throw new Error(`Empty csv: ${filePath}`)
  const header = sheet[0].map((c) => String(c ?? "").trim())
  const dateIdx = header.findIndex((h) => /日期|估值日期/.test(h))
  const unitIdx = header.findIndex((h) => /单位净值|份额净值/.test(h) && !/累计/.test(h))
  const cumIdx = header.findIndex((h) => /累计/.test(h) && /净值/.test(h))
  const rows: Row[] = []
  for (let i = 1; i < sheet.length; i++) {
    const line = sheet[i]
    const nav_date = formatDate(line[dateIdx >= 0 ? dateIdx : 0])
    if (!nav_date) continue
    const unit_nav = parseNum(line[unitIdx >= 0 ? unitIdx : 3])
    if (unit_nav == null) continue
    const cumulative_nav = parseNum(line[cumIdx >= 0 ? cumIdx : unitIdx]) ?? unit_nav
    rows.push({ nav_date, unit_nav, cumulative_nav })
  }
  return rows
}

async function main() {
  loadEnv()
  const { ensureDevPostgresTunnel } = await import("../../lib/server/dev-prod-db-tunnel")
  await ensureDevPostgresTunnel()
  const { query } = await import("../../lib/db")

  await query(`
    CREATE TABLE IF NOT EXISTS ops_team_nav_manual (
      id             SERIAL PRIMARY KEY,
      beian_hao      VARCHAR(64) NOT NULL,
      nav_date       DATE NOT NULL,
      unit_nav       NUMERIC(16,6) NOT NULL,
      cumulative_nav NUMERIC(16,6),
      adjusted_nav   NUMERIC(16,6),
      nav_type       VARCHAR(16) NOT NULL DEFAULT 'pre_fee',
      is_protected   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (beian_hao, nav_date, nav_type)
    )
  `)
  await query(`ALTER TABLE ops_team_nav_manual ADD COLUMN IF NOT EXISTS adjusted_nav NUMERIC(16,6)`).catch(() => {})
  await query(`ALTER TABLE ops_team_nav_manual ADD COLUMN IF NOT EXISTS is_protected BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {})

  const files = [
    { path: "C:/Users/Administrator/SXP646_nav.csv", beian: "SXP646" },
    { path: "C:/Users/Administrator/SBPC39_nav.csv", beian: "SBPC39" },
  ]

  const imports: Array<Record<string, unknown>> = []
  for (const f of files) {
    if (!fs.existsSync(f.path)) throw new Error(`Missing ${f.path}`)
    const rows = readCsvNav(f.path)
    if (rows.length === 0) throw new Error(`No rows in ${f.path}`)
    const byDate = new Map<string, Row>()
    for (const r of rows.sort((a, b) => a.nav_date.localeCompare(b.nav_date))) byDate.set(r.nav_date, r)
    const unique = [...byDate.values()]
    let upserted = 0
    for (const row of unique) {
      await query(
        `INSERT INTO ops_team_nav_manual
           (beian_hao, nav_date, unit_nav, cumulative_nav, adjusted_nav, nav_type, is_protected)
         VALUES ($1, $2::date, $3::numeric, $4::numeric, $4::numeric, 'pre_fee', TRUE)
         ON CONFLICT (beian_hao, nav_date, nav_type) DO UPDATE SET
           unit_nav = EXCLUDED.unit_nav,
           cumulative_nav = EXCLUDED.cumulative_nav,
           adjusted_nav = EXCLUDED.adjusted_nav,
           is_protected = TRUE,
           created_at = NOW()`,
        [f.beian, row.nav_date, row.unit_nav, row.cumulative_nav],
      )
      upserted++
    }
    const info = await query<{ product_name: string }>(
      `SELECT product_name FROM private_fund_info WHERE UPPER(BTRIM(beian_hao)) = $1 LIMIT 1`,
      [f.beian],
    ).catch(() => [] as { product_name: string }[])
    const counts = await query<{ total: string; protected: string; min_d: string; max_d: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE is_protected)::text AS protected,
              MIN(nav_date)::text AS min_d,
              MAX(nav_date)::text AS max_d
       FROM ops_team_nav_manual
       WHERE UPPER(BTRIM(beian_hao)) = $1 AND nav_type = 'pre_fee'`,
      [f.beian],
    )
    imports.push({
      file: path.basename(f.path),
      beian: f.beian,
      product: info[0]?.product_name || null,
      upserted,
      db_total: counts[0]?.total,
      db_protected: counts[0]?.protected,
      range: `${counts[0]?.min_d}..${counts[0]?.max_d}`,
    })
  }

  console.log(JSON.stringify({ ok: true, imports }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
