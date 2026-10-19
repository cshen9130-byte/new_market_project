import fs from "fs"
import path from "path"

export const NAV_FIXES_CATALOG_PATH = path.join(process.cwd(), "reports", "nav-fixes-catalog.csv")

export type NavFixesCatalog = {
  columns: string[]
  rows: Record<string, string>[]
  updated_at: string
  bytes: number
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ""
  let inQuotes = false
  const src = text.replace(/^\uFEFF/, "")
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"') {
      if (inQuotes && src[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === "," && !inQuotes) {
      row.push(cur)
      cur = ""
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && src[i + 1] === "\n") i++
      row.push(cur)
      if (row.some((cell) => cell.length > 0)) rows.push(row)
      row = []
      cur = ""
    } else {
      cur += ch
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur)
    if (row.some((cell) => cell.length > 0)) rows.push(row)
  }
  return rows
}

export function readNavFixesCatalog(): NavFixesCatalog {
  const stat = fs.statSync(NAV_FIXES_CATALOG_PATH)
  const text = fs.readFileSync(NAV_FIXES_CATALOG_PATH, "utf8")
  const parsed = parseCsv(text)
  const columns = parsed[0] ?? []
  if (columns.length === 0 || columns[0] !== "记录类型") {
    throw new Error("净值规则表表头无法识别")
  }
  const rows = parsed.slice(1).map((cells) => {
    const record: Record<string, string> = {}
    columns.forEach((column, index) => {
      record[column] = cells[index] ?? ""
    })
    return record
  })
  return {
    columns,
    rows,
    updated_at: stat.mtime.toISOString(),
    bytes: stat.size,
  }
}
