/**
 * Week view of knowledge-base folder 外部私募业绩排行.
 * A file belongs to the selected week when its filename date/range, or the
 * workbook's nav as-of date, falls inside Monday..weekEnd.
 */

import { readFile } from "fs/promises"
import * as XLSX from "xlsx"
import {
  EXTERNAL_RANK_FOLDER,
  type ExternalRankDetectedWeek,
  type ExternalRankWeekFile,
  type ExternalRankWeekGroup,
  type ExternalRankWeekPreview,
  type ExternalRankWeekRow,
} from "@/lib/ma/external-rank-week"
import { getKnowledgeBaseFile, listKnowledgeBaseIndexableFiles } from "@/lib/server/knowledge-base"
import { parseExternalRankWorkbook, type ExternalRankRow, type ParsedExternalRank } from "@/lib/server/external-rank-sheet"

const PREVIEW_ROW_CAP = 2000
const PARSE_CACHE_MAX = 80

type DateSpan = { start: string; end: string }
type MonthDay = { month: number; day: number }

export type RankFileDates = {
  spans: DateSpan[]
  shorts: MonthDay[]
}

type CatalogFile = {
  path: string
  name: string
  size: number
  updatedAt: string
  dates: RankFileDates
  parsed: ParsedExternalRank | null
  parseError: string | null
  asOf: string | null
  spans: DateSpan[]
}

const parseCache = new Map<string, { parsed: ParsedExternalRank | null; error: string | null }>()

function isoFromLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

/** Same default as 周度回顾: the most recent Friday, including today. */
export function defaultExternalRankWeekEnd(today = shanghaiToday()): string {
  const d = new Date(`${today}T12:00:00`)
  const day = d.getDay()
  const back = day >= 5 ? day - 5 : day + 2
  d.setDate(d.getDate() - back)
  return isoFromLocalDate(d)
}

export function mondayOfWeek(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return isoFromLocalDate(d)
}

export function externalRankWeekWindow(weekEndRaw: string, today = shanghaiToday()): { weekStart: string; weekEnd: string } {
  const weekEnd = /^\d{4}-\d{2}-\d{2}$/.test(weekEndRaw) ? weekEndRaw : defaultExternalRankWeekEnd(today)
  return { weekStart: mondayOfWeek(weekEnd), weekEnd }
}

/** Friday of the calendar week. Saturday and Sunday belong to the Friday just passed. */
export function weekFriday(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  const day = d.getDay()
  const add = day === 6 ? -1 : day === 0 ? -2 : 5 - day
  d.setDate(d.getDate() + add)
  return isoFromLocalDate(d)
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  d.setDate(d.getDate() + days)
  return isoFromLocalDate(d)
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function parseMonthDayDigits(digits: string): MonthDay | null {
  if (digits.length === 3) {
    const month = Number(digits.slice(0, 1))
    const day = Number(digits.slice(1))
    return toIso(2020, month, day) ? { month, day } : null
  }
  if (digits.length === 4) {
    const month = Number(digits.slice(0, 2))
    const day = Number(digits.slice(2))
    return toIso(2020, month, day) ? { month, day } : null
  }
  return null
}

function markUsed(used: boolean[], start: number, end: number) {
  for (let i = start; i < end; i++) used[i] = true
}

function overlapsUsed(used: boolean[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) if (used[i]) return true
  return false
}

/** Dates written into a ranking filename. Year-less forms stay as month/day. */
export function extractRankFileDates(fileName: string): RankFileDates {
  const spans: DateSpan[] = []
  const shorts: MonthDay[] = []
  const used = new Array(fileName.length).fill(false)

  const rangeRe = /(20\d{2})\s*[.\-/年]\s*(\d{1,2})\s*[.\-/月]\s*(\d{1,2})\s*日?\s*[~～\-至到]\s*(?:(20\d{2})\s*[.\-/年]\s*)?(\d{1,2})\s*[.\-/月]\s*(\d{1,2})\s*日?/g
  for (const match of fileName.matchAll(rangeRe)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    const startIso = toIso(Number(match[1]), Number(match[2]), Number(match[3]))
    const endYear = match[4] ? Number(match[4]) : Number(match[1])
    let endIso = toIso(endYear, Number(match[5]), Number(match[6]))
    if (startIso && endIso && endIso < startIso && !match[4]) {
      endIso = toIso(endYear + 1, Number(match[5]), Number(match[6]))
    }
    if (!startIso || !endIso) continue
    spans.push(startIso <= endIso ? { start: startIso, end: endIso } : { start: endIso, end: startIso })
    markUsed(used, start, end)
  }

  const fullRe = /(20\d{2})\s*[.\-/年]\s*(\d{1,2})\s*[.\-/月]\s*(\d{1,2})\s*日?/g
  for (const match of fileName.matchAll(fullRe)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (overlapsUsed(used, start, end)) continue
    const iso = toIso(Number(match[1]), Number(match[2]), Number(match[3]))
    if (!iso) continue
    spans.push({ start: iso, end: iso })
    markUsed(used, start, end)
  }

  const compactRe = /(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/g
  for (const match of fileName.matchAll(compactRe)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (overlapsUsed(used, start, end)) continue
    const iso = toIso(Number(match[1]), Number(match[2]), Number(match[3]))
    if (!iso) continue
    spans.push({ start: iso, end: iso })
    markUsed(used, start, end)
  }

  const shortRe = /截止\s*(?:(\d{1,2})\s*[.月]\s*(\d{1,2})|(\d{3,4}))(?!\d)/g
  for (const match of fileName.matchAll(shortRe)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (overlapsUsed(used, start, end)) continue
    const monthDay = match[3]
      ? parseMonthDayDigits(match[3])
      : toIso(2020, Number(match[1]), Number(match[2]))
        ? { month: Number(match[1]), day: Number(match[2]) }
        : null
    if (!monthDay) continue
    shorts.push(monthDay)
    markUsed(used, start, end)
  }

  const bareRe = /(?<!\d)(\d{1,2})\s*[.月]\s*(\d{1,2})\s*日?\s*[~～\-至到]\s*(\d{1,2})\s*[.月]\s*(\d{1,2})\s*日?/g
  for (const match of fileName.matchAll(bareRe)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (overlapsUsed(used, start, end)) continue
    const left = toIso(2020, Number(match[1]), Number(match[2])) ? { month: Number(match[1]), day: Number(match[2]) } : null
    const right = toIso(2020, Number(match[3]), Number(match[4])) ? { month: Number(match[3]), day: Number(match[4]) } : null
    if (!left || !right) continue
    shorts.push(left, right)
    markUsed(used, start, end)
  }

  return { spans, shorts }
}

export function yearForShortDates(fileName: string, asOf: string | null, folderYear: number): number {
  const inName = fileName.match(/20\d{2}/)
  if (inName) return Number(inName[0])
  if (asOf && /^\d{4}/.test(asOf)) return Number(asOf.slice(0, 4))
  return folderYear
}

export function concreteDateSpans(dates: RankFileDates, year: number): DateSpan[] {
  const spans = dates.spans.map((span) => ({ ...span }))
  for (const short of dates.shorts) {
    const iso = toIso(year, short.month, short.day)
    if (iso) spans.push({ start: iso, end: iso })
  }
  return spans
}

function spansOverlap(span: DateSpan, weekStart: string, weekEnd: string): boolean {
  return span.start <= weekEnd && span.end >= weekStart
}

export function matchRankWeek(
  spans: DateSpan[],
  asOf: string | null,
  weekStart: string,
  weekEnd: string,
): "as_of" | "filename" | "both" | null {
  const byName = spans.some((span) => spansOverlap(span, weekStart, weekEnd))
  if (asOf) {
    const byAsOf = asOf >= weekStart && asOf <= weekEnd
    if (!byAsOf) return null
    return byName ? "both" : "as_of"
  }
  return byName ? "filename" : null
}

function fridaysCovered(span: DateSpan): string[] {
  const out: string[] = []
  let cursor = weekFriday(span.start)
  const last = weekFriday(span.end)
  let guard = 0
  while (cursor <= last && guard < 60) {
    out.push(cursor)
    cursor = addDays(cursor, 7)
    guard += 1
  }
  return out
}

function folderYearFrom(files: Array<{ dates: RankFileDates; asOf: string | null }>, today: string): number {
  let year = Number(today.slice(0, 4))
  for (const file of files) {
    if (file.asOf) year = Math.max(year, Number(file.asOf.slice(0, 4)))
    for (const span of file.dates.spans) year = Math.max(year, Number(span.start.slice(0, 4)))
  }
  return year
}

function isMissingPath(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "ENOENT"
}

function rememberParse(key: string, value: { parsed: ParsedExternalRank | null; error: string | null }) {
  if (parseCache.has(key)) parseCache.delete(key)
  parseCache.set(key, value)
  while (parseCache.size > PARSE_CACHE_MAX) {
    const oldest = parseCache.keys().next().value
    if (oldest == null) break
    parseCache.delete(oldest)
  }
}

async function parseCached(relativePath: string, size: number, updatedAt: string, data: Buffer) {
  const key = `${relativePath}\0${size}\0${updatedAt}`
  const hit = parseCache.get(key)
  if (hit) {
    rememberParse(key, hit)
    return hit
  }
  try {
    const parsed = parseExternalRankWorkbook(data, relativePath)
    const value = { parsed, error: null }
    rememberParse(key, value)
    return value
  } catch (err) {
    const value = { parsed: null, error: err instanceof Error ? err.message : String(err) }
    rememberParse(key, value)
    return value
  }
}

async function loadCatalog(today = shanghaiToday()): Promise<CatalogFile[]> {
  if (process.platform === "win32") {
    const { ensureDevRemoteRankFolder } = await import("./dev-remote-rank-folder")
    await ensureDevRemoteRankFolder()
  }
  let listed: { relativePath: string; size: number }[]
  try {
    listed = await listKnowledgeBaseIndexableFiles(EXTERNAL_RANK_FOLDER)
  } catch (err) {
    if (isMissingPath(err)) {
      throw new Error(`知识库里还没有「${EXTERNAL_RANK_FOLDER}」文件夹。请先在 AI 知识库上传榜单文件。`)
    }
    throw err
  }
  const spreadsheets = listed.filter((file) => /\.xlsx?$/i.test(file.relativePath))
  const partial: Array<Omit<CatalogFile, "spans">> = []
  for (const item of spreadsheets) {
    try {
      const file = await getKnowledgeBaseFile(item.relativePath)
      const data = await readFile(file.absolutePath)
      const parsed = await parseCached(file.relativePath, file.size, file.updatedAt, data)
      partial.push({
        path: file.relativePath,
        name: file.name,
        size: file.size,
        updatedAt: file.updatedAt,
        dates: extractRankFileDates(file.name),
        parsed: parsed.parsed,
        parseError: parsed.error,
        asOf: parsed.parsed?.as_of ?? null,
      })
    } catch (err) {
      partial.push({
        path: item.relativePath,
        name: item.relativePath.split("/").pop() || item.relativePath,
        size: item.size,
        updatedAt: "",
        dates: extractRankFileDates(item.relativePath),
        parsed: null,
        parseError: err instanceof Error ? err.message : String(err),
        asOf: null,
      })
    }
  }
  const folderYear = folderYearFrom(partial, today)
  return partial.map((file) => ({
    ...file,
    spans: concreteDateSpans(file.dates, yearForShortDates(file.name, file.asOf, folderYear)),
  }))
}

function detectedWeeks(files: CatalogFile[]): ExternalRankDetectedWeek[] {
  const fridays = new Set<string>()
  for (const file of files) {
    if (file.asOf) {
      fridays.add(weekFriday(file.asOf))
      continue
    }
    for (const span of file.spans) {
      for (const friday of fridaysCovered(span)) fridays.add(friday)
    }
  }
  const weeks: ExternalRankDetectedWeek[] = []
  for (const weekEnd of [...fridays].sort((a, b) => b.localeCompare(a))) {
    const weekStart = mondayOfWeek(weekEnd)
    const fileCount = files.filter((file) => matchRankWeek(file.spans, file.asOf, weekStart, weekEnd)).length
    if (fileCount > 0) weeks.push({ week_start: weekStart, week_end: weekEnd, file_count: fileCount })
  }
  return weeks
}

function toPreviewRow(row: ExternalRankRow): ExternalRankWeekRow {
  return {
    rank: row.rank,
    strategy: row.strategy,
    class_key: row.class_key,
    manager: row.manager,
    product: row.product,
    aum: row.aum,
    nav_date: row.nav_date,
    ytd: row.ytd,
    ytd_drawdown: row.ytd_drawdown,
    ret_1w: row.ret_1w,
    sheet: row.sheet,
  }
}

function groupsOf(files: ExternalRankWeekFile[]): ExternalRankWeekGroup[] {
  const map = new Map<string, { rowCount: number; files: Set<string> }>()
  for (const file of files) {
    if (!file.parsed) continue
    const seen = new Set<string>()
    for (const row of file.rows) {
      const key = row.class_key || row.strategy || "未分类"
      const bucket = map.get(key) ?? { rowCount: 0, files: new Set<string>() }
      bucket.rowCount += 1
      bucket.files.add(file.path)
      map.set(key, bucket)
      seen.add(key)
    }
    for (const key of file.classes) {
      if (seen.has(key)) continue
      const bucket = map.get(key) ?? { rowCount: 0, files: new Set<string>() }
      bucket.files.add(file.path)
      map.set(key, bucket)
    }
  }
  return [...map.entries()]
    .map(([strategy, bucket]) => ({
      strategy,
      row_count: bucket.rowCount,
      file_count: bucket.files.size,
    }))
    .sort((a, b) => b.row_count - a.row_count || a.strategy.localeCompare(b.strategy, "zh-CN"))
}

function weekFiles(catalog: CatalogFile[], weekStart: string, weekEnd: string): ExternalRankWeekFile[] {
  const files: ExternalRankWeekFile[] = []
  for (const file of catalog) {
    const matched = matchRankWeek(file.spans, file.asOf, weekStart, weekEnd)
    if (!matched) continue
    const rows = file.parsed?.rows ?? []
    files.push({
      path: file.path,
      name: file.name,
      size: file.size,
      updated_at: file.updatedAt,
      parsed: !!file.parsed,
      error: file.parseError,
      title: file.parsed?.title || file.name,
      as_of: file.asOf,
      window_label: file.parsed?.window_label ?? null,
      classes: file.parsed?.classes ?? [],
      matched_by: matched,
      row_count: rows.length,
      truncated: false,
      rows: rows.map(toPreviewRow),
    })
  }
  files.sort((a, b) => (b.as_of || "").localeCompare(a.as_of || "") || a.name.localeCompare(b.name, "zh-CN"))
  return files
}

async function collectWeek(weekEndRaw: string): Promise<ExternalRankWeekPreview> {
  const { weekStart, weekEnd } = externalRankWeekWindow(weekEndRaw)
  const catalog = await loadCatalog()
  const files = weekFiles(catalog, weekStart, weekEnd)
  return {
    folder: EXTERNAL_RANK_FOLDER,
    week_start: weekStart,
    week_end: weekEnd,
    scanned: catalog.length,
    files,
    groups: groupsOf(files),
    weeks: detectedWeeks(catalog),
  }
}

export async function buildExternalRankWeekPreview(weekEndRaw: string): Promise<ExternalRankWeekPreview> {
  const full = await collectWeek(weekEndRaw)
  return {
    ...full,
    files: full.files.map((file) => ({
      ...file,
      truncated: file.rows.length > PREVIEW_ROW_CAP,
      rows: file.rows.slice(0, PREVIEW_ROW_CAP),
    })),
  }
}

function sheetTitle(name: string, used: Set<string>): string {
  const cleaned = name
    .replace(/\.(xlsx|xls)$/i, "")
    .replace(/[\\/?*[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "榜单"
  let base = cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned
  let title = base
  let n = 2
  while (used.has(title)) {
    const suffix = ` ${n}`
    const room = Math.max(1, 31 - suffix.length)
    base = cleaned.slice(0, room)
    title = `${base}${suffix}`
    n += 1
  }
  used.add(title)
  return title
}

function applyPercent(ws: XLSX.WorkSheet, rowCount: number, cols: number[], headerRows: number) {
  for (let r = headerRows; r < rowCount; r++) {
    for (const c of cols) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (!cell || typeof cell.v !== "number") continue
      cell.t = "n"
      cell.z = "0.00%"
    }
  }
}

export function externalRankWeekFileName(weekEnd: string): string {
  const [y, m, d] = weekEnd.split("-")
  return `外部私募业绩排行 - ${y}.${Number(m)}.${Number(d)}.xlsx`
}

export function buildExternalRankWeekWorkbook(preview: Pick<ExternalRankWeekPreview, "week_start" | "week_end" | "files">): Buffer {
  const book = XLSX.utils.book_new()
  const used = new Set<string>(["概览"])
  const overview: unknown[][] = [
    ["外部私募业绩排行"],
    ["统计区间", `${preview.week_start} ~ ${preview.week_end}`],
    [],
    ["文件", "截止日期", "策略", "行数", "说明"],
  ]
  for (const file of preview.files) {
    overview.push([
      file.name,
      file.as_of || "",
      file.classes.join("、"),
      file.row_count,
      file.parsed ? "已纳入" : (file.error || "未能识别成业绩榜，未写入明细"),
    ])
  }
  overview.push([])
  overview.push(["策略", "行数", "文件数"])
  for (const group of groupsOf(preview.files)) {
    overview.push([group.strategy, group.row_count, group.file_count])
  }
  const overviewSheet = XLSX.utils.aoa_to_sheet(overview)
  overviewSheet["!cols"] = [{ wch: 42 }, { wch: 16 }, { wch: 24 }, { wch: 10 }, { wch: 36 }]
  XLSX.utils.book_append_sheet(book, overviewSheet, "概览")

  const combined: unknown[][] = [[
    "来源文件", "序号", "策略类型", "基金管理人", "产品名称", "管理规模", "净值日期", "收益率", "今年以来最大回撤", "近一周收益率",
  ]]
  for (const file of preview.files) {
    if (!file.parsed) continue
    for (const row of file.rows) {
      combined.push([
        file.name,
        row.rank,
        row.strategy || row.class_key,
        row.manager,
        row.product || "",
        row.aum || "",
        row.nav_date || "",
        row.ytd,
        row.ytd_drawdown,
        row.ret_1w,
      ])
    }
  }
  if (combined.length > 1) {
    const combinedSheet = XLSX.utils.aoa_to_sheet(combined)
    applyPercent(combinedSheet, combined.length, [7, 8, 9], 1)
    combinedSheet["!cols"] = [
      { wch: 36 }, { wch: 8 }, { wch: 16 }, { wch: 28 }, { wch: 28 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 14 },
    ]
    combinedSheet["!views"] = [{ state: "frozen", ySplit: 1 }]
    used.add("汇总")
    XLSX.utils.book_append_sheet(book, combinedSheet, "汇总")
  }

  for (const file of preview.files) {
    if (!file.parsed || file.rows.length === 0) continue
    const returnHeader = file.window_label === "近一年" ? "近一年收益率" : "今年以来收益率"
    const aoa: unknown[][] = [
      [file.title || file.name],
      ["序号", "策略类型", "基金管理人", "产品名称", "管理规模", "净值日期", returnHeader, "今年以来最大回撤", "近一周收益率"],
    ]
    for (const row of file.rows) {
      aoa.push([
        row.rank,
        row.strategy || row.class_key,
        row.manager,
        row.product || "",
        row.aum || "",
        row.nav_date || "",
        row.ytd,
        row.ytd_drawdown,
        row.ret_1w,
      ])
    }
    const sheet = XLSX.utils.aoa_to_sheet(aoa)
    applyPercent(sheet, aoa.length, [6, 7, 8], 2)
    sheet["!cols"] = [
      { wch: 8 }, { wch: 16 }, { wch: 28 }, { wch: 28 }, { wch: 14 },
      { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 14 },
    ]
    sheet["!views"] = [{ state: "frozen", ySplit: 2 }]
    XLSX.utils.book_append_sheet(book, sheet, sheetTitle(file.name, used))
  }

  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer
}

export async function buildExternalRankWeekFile(weekEndRaw: string): Promise<{ buffer: Buffer; fileName: string }> {
  const preview = await collectWeek(weekEndRaw)
  const parsedRows = preview.files.reduce((sum, file) => sum + (file.parsed ? file.row_count : 0), 0)
  if (parsedRows === 0) {
    throw new Error(preview.files.length === 0
      ? "这一周没有匹配到外部私募业绩排行文件"
      : "这一周的文件没能识别成业绩榜，请下载原文件查看")
  }
  return {
    buffer: buildExternalRankWeekWorkbook(preview),
    fileName: externalRankWeekFileName(preview.week_end),
  }
}
