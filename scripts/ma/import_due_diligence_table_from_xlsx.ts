/**
 * Import 尽调表格 seed from Excel.
 * Usage: npx tsx scripts/ma/import_due_diligence_table_from_xlsx.ts <xlsx-path> [--push-db]
 */
import fs from "fs"
import path from "path"
import * as XLSX from "xlsx"
import { DD_TABLE_COLUMNS, mergeOtherInfoIntoDdConclusion } from "../../lib/ma/due-diligence-table"

const SEED_KEYS = DD_TABLE_COLUMNS.map((c) => c.key)

for (const fname of [".env.local", ".env"]) {
  const envPath = path.join(process.cwd(), fname)
  if (!fs.existsSync(envPath)) continue
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2]
  }
}

function formatDateCell(value: unknown, serialFallback?: unknown): string {
  if (typeof serialFallback === "number" && serialFallback > 40_000) {
    const parsed = XLSX.SSF.parse_date_code(serialFallback)
    if (parsed?.y) return `${parsed.y}/${parsed.m}/${parsed.d}`
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}/${value.getMonth() + 1}/${value.getDate()}`
  }
  const s = String(value ?? "").trim()
  if (!s) return ""
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}/${Number(iso[2])}/${Number(iso[3])}`
  return s
}

function formatTimeCell(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const h = String(value.getHours()).padStart(2, "0")
    const m = String(value.getMinutes()).padStart(2, "0")
    return `${h}:${m}`
  }
  if (typeof value === "number" && value >= 0 && value < 1) {
    const totalMinutes = Math.round(value * 24 * 60)
    const h = Math.floor(totalMinutes / 60) % 24
    const m = totalMinutes % 60
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  }
  const s = String(value ?? "").trim()
  const match = s.match(/(\d{1,2}):(\d{2})/)
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : s
}

function cellText(value: unknown): string {
  if (value == null) return ""
  if (value instanceof Date) return ""
  return String(value).trim()
}

function rowHasMainContent(values: Record<string, string>): boolean {
  const mainKeys = [
    "ddPersonnel",
    "ddDate",
    "ddMethod",
    "ddTarget",
    "fundCompany",
    "investmentManager",
    "ddConclusion",
  ] as const
  return mainKeys.some((key) => values[key])
}

function shouldImportRow(values: Record<string, string>): boolean {
  if (rowHasMainContent(values)) return true
  // Keep numbered blank template rows from the spreadsheet.
  if (values.index && /^\d+$/.test(values.index)) {
    return SEED_KEYS.every((key) => key === "index" || !values[key])
  }
  return false
}

async function pushToDatabase(rows: Record<string, string>[]) {
  const { query } = await import("../../lib/db")

  await query(`
    CREATE TABLE IF NOT EXISTS due_diligence_team_table (
      id          TEXT PRIMARY KEY,
      rows        JSONB NOT NULL DEFAULT '[]',
      formats     JSONB NOT NULL DEFAULT '{}',
      updated_by  TEXT NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  const base = Date.now()
  const tableRows = rows.map((seed, index) => {
    const now = new Date(base - (rows.length - index) * 60_000).toISOString()
    const data = Object.fromEntries(SEED_KEYS.map((key) => [key, seed[key] ?? ""]))
    return {
      ...data,
      id: `seed-${index}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
    }
  })

  const updatedAt = new Date().toISOString()
  await query(
    `INSERT INTO due_diligence_team_table (id, rows, formats, updated_by, updated_at)
     VALUES ('team', $1::jsonb, '{}'::jsonb, 'excel-import', $2::timestamptz)
     ON CONFLICT (id)
     DO UPDATE SET
       rows = EXCLUDED.rows,
       formats = EXCLUDED.formats,
       updated_by = EXCLUDED.updated_by,
       updated_at = EXCLUDED.updated_at`,
    [JSON.stringify(tableRows), updatedAt],
  )
  console.log(`Pushed ${tableRows.length} rows to due_diligence_team_table`)
}

async function main() {
  const args = process.argv.slice(2)
  const xlsxPath = args.find((a) => !a.startsWith("--"))
  const pushDb = args.includes("--push-db")
  if (!xlsxPath) {
    console.error("Usage: npx tsx scripts/ma/import_due_diligence_table_from_xlsx.ts <xlsx-path> [--push-db]")
    process.exit(1)
  }

  const wb = XLSX.readFile(xlsxPath, { cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const sheet = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" })
  if (sheet.length < 2) throw new Error("Empty workbook")

  const imported: Record<string, string>[] = []
  for (let i = 1; i < sheet.length; i++) {
    const line = sheet[i]
    if (!Array.isArray(line)) continue

    const values: Record<string, string> = {
      index: cellText(line[0]) || String(imported.length + 1),
      ddPersonnel: cellText(line[1]),
      ddDate: formatDateCell(line[2], line[3]),
      ddTime: formatTimeCell(line[4]),
      ddMethod: cellText(line[5]),
      ddTarget: cellText(line[6]),
      recommender: cellText(line[7]),
      strategyPreliminary: cellText(line[8]),
      fundCompany: cellText(line[9]),
      investmentManager: cellText(line[10]),
      representativeProduct: cellText(line[11]),
      strategyLevel1: cellText(line[12]),
      strategyLevel2: cellText(line[13]),
      strategyLevel3: cellText(line[14]),
      inTrackingPool: cellText(line[15]),
      ddMaterials: cellText(line[16]),
      ddConclusion: mergeOtherInfoIntoDdConclusion(cellText(line[18]), cellText(line[17])),
    }

    if (!shouldImportRow(values)) continue
    imported.push(values)
  }

  if (imported.length === 0) throw new Error("No data rows found")

  const outPath = path.join(process.cwd(), "lib/ma/due-diligence-table-seed.json")
  fs.writeFileSync(outPath, `${JSON.stringify(imported, null, 2)}\n`, "utf8")
  console.log(`Wrote ${imported.length} rows to ${outPath}`)

  if (pushDb) {
    await pushToDatabase(imported)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
