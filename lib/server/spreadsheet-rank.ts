import { readFile } from "fs/promises"
import * as XLSX from "xlsx"
import { getKnowledgeBaseFile, listKnowledgeBaseIndexableFiles } from "@/lib/server/knowledge-base"

export type SheetCell = string | number | null

export type SheetTable = {
  sheet: string
  headers: string[]
  rows: Array<Record<string, SheetCell>>
}

export type RankQuery = {
  direction: "desc" | "asc"
  limit: number
  tokens: string[]
}

export type SpreadsheetRank = {
  path: string
  sheet: string
  sort_key: string
  order: "desc" | "asc"
  as_of: string | null
  row_count: number
  rows: Array<Record<string, SheetCell>>
}

const SHEET_SIGNAL = /点睛|排行榜|业绩榜|业绩放送|\.xlsx/i
const RANK_CUE = /最高|最低|最大|最小|前\s*\d+|排名|highest|lowest|top\s*\d+/i

export function isSheetRankQuestion(question: string): boolean {
  return SHEET_SIGNAL.test(question) && RANK_CUE.test(question)
}

export function parseRankQuestion(question: string): RankQuery | null {
  if (!isSheetRankQuestion(question)) return null
  const limitMatch = question.match(/前\s*(\d{1,3})/)
  const limit = limitMatch ? Math.min(100, Math.max(1, Number(limitMatch[1]))) : 10
  const wantsLow = /最低|最小|lowest/i.test(question) && !/最高|最大|highest/i.test(question)
  return {
    direction: wantsLow ? "asc" : "desc",
    limit,
    tokens: rankFileTokens(question),
  }
}

export function rankFileTokens(question: string): string[] {
  const tokens: string[] = []
  if (question.includes("点睛")) tokens.push("点睛")
  else if (/业绩榜|业绩放送/.test(question)) tokens.push("业绩")
  const dated = question.match(/20\d{2}-?\d{2}-?\d{2}/)
  if (dated) tokens.push(dated[0].replace(/-/g, ""))
  else {
    const short = question.match(/截止\s*(\d{3,4})/)
    if (short) tokens.push(short[1])
  }
  const strategy = question.match(/主观多头|量化股票|主观CTA|量化CTA|量化期货/)
  if (strategy) tokens.push(strategy[0])
  if (/基金管理人|管理人/.test(question)) tokens.push("管理人")
  return tokens
}

export function pathHasToken(filePath: string, token: string): boolean {
  const path = filePath.replace(/\s/g, "")
  const compact = token.replace(/\s/g, "")
  if (!compact) return true
  if (path.includes(compact)) return true
  const digits = compact.replace(/\D/g, "")
  if (digits.length === 8 && digits.startsWith("20")) {
    const monthDay = digits.slice(4)
    const short = `${Number(digits.slice(4, 6))}${digits.slice(6)}`
    return path.includes(digits) || path.includes(monthDay) || path.includes(short)
  }
  return false
}

export function chooseRankFile(paths: string[], tokens: string[]): string | null {
  const xlsx = paths.filter((file) => /\.xlsx?$/i.test(file))
  const pool = xlsx.length ? xlsx : paths
  if (tokens.length === 0) return null
  const required = tokens.filter((token) => token === "点睛" || token === "业绩" || /^\d{3,8}$/.test(token))
  const preferred = tokens.filter((token) => !required.includes(token))
  let hits = pool.filter((file) => required.every((token) => pathHasToken(file, token)))
  if (hits.length === 0) hits = pool.filter((file) => tokens.filter((token) => pathHasToken(file, token)).length >= Math.min(2, tokens.length))
  if (hits.length === 0) return null
  const narrowed = preferred.length
    ? hits.filter((file) => preferred.every((token) => pathHasToken(file, token)))
    : []
  const chosen = narrowed.length ? narrowed : hits
  chosen.sort((a, b) => tokenScore(b, tokens) - tokenScore(a, tokens) || a.length - b.length)
  return chosen[0] ?? null
}

function tokenScore(filePath: string, tokens: string[]): number {
  return tokens.reduce((score, token) => score + (pathHasToken(filePath, token) ? 1 : 0), 0)
}

function compact(value: string): string {
  return value.replace(/\s/g, "").replace(/[（(][^）)]*[）)]/g, "")
}

export function matchColumn(headers: string[], question: string): string | null {
  const q = question.replace(/\s/g, "")
  let best: string | null = null
  let bestLen = 0
  for (const header of headers) {
    const core = compact(header)
    if (core.length < 2 || !q.includes(core) || core.length <= bestLen) continue
    best = header
    bestLen = core.length
  }
  return best
}

function headerRowIndex(matrix: unknown[][]): number {
  const named = matrix.findIndex((row) =>
    Array.isArray(row) && row.some((cell) => /基金管理人|管理人名称|产品名称|成立以来夏普|序号/.test(compact(String(cell ?? "")))),
  )
  if (named >= 0) return named
  return matrix.findIndex((row) => Array.isArray(row) && row.filter((cell) => String(cell ?? "").trim()).length >= 3)
}

function sheetMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  const ref = sheet["!ref"]
  if (!ref) return []
  const range = XLSX.utils.decode_range(ref)
  const rows: unknown[][] = []
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row: unknown[] = []
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined
      if (!cell) {
        row.push(null)
        continue
      }
      const shown = typeof cell.w === "string" ? cell.w.trim() : ""
      row.push(shown || (cell.v ?? null))
    }
    rows.push(row)
  }
  return rows
}

function cellValue(value: unknown): SheetCell {
  if (value == null) return null
  const text = String(value).trim()
  if (!text || text === "-" || text === "—" || text === "–") return null
  if (text.endsWith("%")) return text
  const numeric = Number(text.replace(/,/g, ""))
  if (Number.isFinite(numeric) && /^-?\d+(\.\d+)?$/.test(text.replace(/,/g, ""))) return numeric
  return text
}

export function tablesFromWorkbook(buffer: Buffer): SheetTable[] {
  const book = XLSX.read(buffer, { type: "buffer" })
  return book.SheetNames.map((sheet) => {
    const matrix = sheetMatrix(book.Sheets[sheet])
    const headerAt = headerRowIndex(matrix)
    if (headerAt < 0) return { sheet, headers: [], rows: [] }
    const seen = new Map<string, number>()
    const headers = (matrix[headerAt] ?? []).map((cell, index) => {
      const base = compact(String(cell ?? "")) || `列${index + 1}`
      const count = seen.get(base) ?? 0
      seen.set(base, count + 1)
      return count === 0 ? base : `${base}_${count + 1}`
    })
    const rows: Array<Record<string, SheetCell>> = []
    for (const raw of matrix.slice(headerAt + 1)) {
      if (!Array.isArray(raw)) continue
      const record: Record<string, SheetCell> = {}
      let filled = 0
      headers.forEach((header, index) => {
        const value = cellValue(raw[index])
        if (value != null) filled += 1
        record[header] = value
      })
      if (filled > 0) rows.push(record)
    }
    return { sheet, headers, rows }
  }).filter((table) => table.headers.length > 0)
}

function sortNumber(value: SheetCell): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return null
  const text = value.replace(/,/g, "").replace(/%$/, "").trim()
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

export function sortSheetRows(
  rows: Array<Record<string, SheetCell>>,
  column: string,
  direction: "desc" | "asc",
): Array<Record<string, SheetCell>> {
  const sign = direction === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = sortNumber(a[column])
    const bv = sortNumber(b[column])
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return (av - bv) * sign
  })
}

function percentHeader(header: string): boolean {
  return /收益率|年化|回撤|波动/.test(header) && !/夏普/.test(header)
}

function displayRows(table: SheetTable, rows: Array<Record<string, SheetCell>>): Array<Record<string, SheetCell>> {
  return rows.map((row) => {
    const next: Record<string, SheetCell> = {}
    for (const header of table.headers) {
      const value = row[header]
      if (typeof value === "number" && percentHeader(header) && Math.abs(value) <= 3) {
        next[header] = `${(value * 100).toFixed(2)}%`
      } else {
        next[header] = value ?? null
      }
    }
    return next
  })
}

export function pickRankTable(tables: SheetTable[], question: string): { table: SheetTable; column: string } | null {
  const hits = tables
    .map((table) => ({ table, column: matchColumn(table.headers, question) }))
    .filter((hit): hit is { table: SheetTable; column: string } => Boolean(hit.column))
  if (hits.length === 0) return null
  hits.sort((a, b) => tokenScore(b.table.sheet, rankFileTokens(question)) - tokenScore(a.table.sheet, rankFileTokens(question)))
  return hits[0]
}

function asOf(question: string, rows: Array<Record<string, SheetCell>>): string | null {
  const dated = question.match(/20(\d{2})-?(\d{2})-?(\d{2})/)
  if (dated) return `20${dated[1]}-${dated[2]}-${dated[3]}`
  const header = Object.keys(rows[0] ?? {}).find((key) => /净值日期|截止日期/.test(key))
  const value = header ? rows.find((row) => row[header] != null)?.[header] : null
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  return null
}

function managerHeader(headers: string[]): string | null {
  return headers.find((header) => /基金管理人|管理人名称|^管理人$/.test(header))
    ?? headers.find((header) => /产品名称|基金名称/.test(header))
    ?? null
}

export function formatRankAnswer(rank: SpreadsheetRank, fileName: string): string {
  const who = managerHeader(Object.keys(rank.rows[0] ?? {}))
  const lines = rank.rows.map((row, index) => {
    const name = who ? String(row[who] ?? "") : ""
    const value = row[rank.sort_key]
    return `${index + 1}. ${name}  ${rank.sort_key} ${value ?? ""}`
  })
  const orderLabel = rank.order === "desc" ? "从高到低" : "从低到高"
  const asOf = rank.as_of ? `截止 ${rank.as_of}。` : ""
  return [
    `按「${rank.sort_key}」${orderLabel}。${asOf}工作表「${rank.sheet}」。`,
    `排序键是「${rank.sort_key}」，与文件名分开。文件「${fileName}」原表的行序不是这个排序。`,
    ...lines,
  ].join("\n")
}

export function sheetTablesText(tables: SheetTable[]): string {
  return tables.map((table) => {
    const lines = [`Sheet: ${table.sheet}`, table.headers.join("\t")]
    for (const row of table.rows) {
      lines.push(table.headers.map((header) => {
        const value = row[header]
        return value == null ? "" : String(value)
      }).join("\t"))
    }
    return lines.join("\n")
  }).join("\n\n")
}

export function capSheetTables(tables: SheetTable[], cap = 80_000): {
  tables: SheetTable[]
  text: string
  truncated: boolean
  next_row: number | null
} {
  const full = sheetTablesText(tables)
  if (full.length <= cap) return { tables, text: full, truncated: false, next_row: null }
  const kept = tables.map((table) => ({ ...table, rows: [...table.rows] }))
  let nextRow: number | null = null
  while (sheetTablesText(kept).length > cap) {
    const largest = kept.reduce((best, table) => (table.rows.length > best.rows.length ? table : best), kept[0])
    if (!largest || largest.rows.length === 0) break
    largest.rows.pop()
    nextRow = largest.rows.length
  }
  return { tables: kept, text: sheetTablesText(kept), truncated: true, next_row: nextRow }
}

export async function answerSpreadsheetRank(question: string): Promise<{
  answer: string
  sources: string[]
  citations: Array<{ n: number; quote: string; path: string; page: number | null; sheet?: string; sort_key?: string }>
  citations_grounded: boolean
  ranking: SpreadsheetRank | null
  model: string
} | null> {
  const query = parseRankQuestion(question)
  if (!query) return null
  const listed = await listKnowledgeBaseIndexableFiles("").catch(() => [])
  const path = chooseRankFile(listed.map((file) => file.relativePath), query.tokens)
  if (!path) {
    return {
      answer: `没有找到同时符合这些问题词的业绩榜：${query.tokens.join("、") || question}`,
      sources: [],
      citations: [],
      citations_grounded: true,
      ranking: null,
      model: "sheet-sort",
    }
  }
  const file = await getKnowledgeBaseFile(path)
  const tables = tablesFromWorkbook(await readFile(file.absolutePath))
  const picked = pickRankTable(tables, question)
  if (!picked) {
    const headers = tables.flatMap((table) => table.headers)
    return {
      answer: `文件「${file.name}」里没有问题点名的那一列。表头是：${headers.join("、")}`,
      sources: [file.relativePath],
      citations: [],
      citations_grounded: true,
      ranking: null,
      model: "sheet-sort",
    }
  }
  const sorted = sortSheetRows(picked.table.rows, picked.column, query.direction)
  const shown = displayRows(picked.table, sorted.slice(0, query.limit))
  const ranking: SpreadsheetRank = {
    path: file.relativePath,
    sheet: picked.table.sheet,
    sort_key: picked.column,
    order: query.direction,
    as_of: asOf(question, picked.table.rows),
    row_count: picked.table.rows.length,
    rows: shown,
  }
  const top = shown[0]
  const who = managerHeader(picked.table.headers)
  const quote = `${picked.column} ${who ? top?.[who] ?? "" : ""} ${top?.[picked.column] ?? ""}`.trim()
  return {
    answer: formatRankAnswer(ranking, file.name),
    sources: [file.relativePath],
    citations: [{ n: 1, quote, path: file.relativePath, page: null, sheet: picked.table.sheet, sort_key: picked.column }],
    citations_grounded: true,
    ranking,
    model: "sheet-sort",
  }
}
