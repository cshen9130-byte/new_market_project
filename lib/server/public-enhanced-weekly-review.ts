/**
 * 公募指增 weekly workbook. Same layout as the stock weekly review:
 * 目录 + 口径说明 + 股票市场回顾 + one sheet per benchmark bucket.
 * Share classes of one product collapse to a single row. Excess uses the
 * same calculator as the stock weekly review.
 */

import { randomUUID } from "crypto"
import { mkdir, readFile, writeFile } from "fs/promises"
import path from "path"
import { fmtIso, n, query } from "@/lib/db"
import {
  PUBLIC_ENHANCED_ABSOLUTE_BUCKET,
  PUBLIC_ENHANCED_BUCKET_ORDER,
  publicEnhancedBucket,
  type PublicEnhancedBucket,
} from "@/lib/ma/public-enhanced-weekly-buckets"
import { isChinaTradingDay } from "@/lib/server/china-trading-calendar"
import {
  BENCH_BY_BUCKET,
  buildMarketRows,
  computeFundMetrics,
  defaultWeeklyReviewWeekEnd,
  displayName,
  resolveWeekWindow,
  type FundMetrics,
  type MetricMode,
  type WeeklyReviewFund,
  type WeeklyReviewPreview,
} from "@/lib/server/jy-weekly-review"
import { NAV_HISTORY_LOOKBACK_DAYS, addDays, type NavPoint } from "@/lib/server/list-cache-nav-batch"

const HEADER_FILL = "1F4E79"
const ALT_FILL = "F2F2F2"
const RED = "C00000"
const GREEN = "006600"
const FONT_NAME = "宋体"

const SHARE_RANK: Record<string, number> = { A: 0, E: 1, "": 2, C: 3, Y: 4 }

type ShareRow = {
  choice_code: string
  short_name: string | null
  full_name: string | null
  share_class: string | null
  benchmark_index: string | null
  benchmark_desc: string | null
  track_method: string | null
  type_l2: string | null
  nav_row_count: number | null
  bucket: PublicEnhancedBucket
}

type CellStyle = {
  font?: { name?: string; sz?: number; bold?: boolean; color?: { rgb: string } }
  fill?: { patternType: "solid"; fgColor: { rgb: string } }
  alignment?: { wrapText?: boolean; vertical?: string; horizontal?: string }
  numFmt?: string
}

function headerStyle(): CellStyle {
  return {
    font: { name: FONT_NAME, sz: 11, bold: true, color: { rgb: "FFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: HEADER_FILL } },
    alignment: { wrapText: true, vertical: "center" },
  }
}

function bodyStyle(alt: boolean, color?: string, numFmt?: string): CellStyle {
  const style: CellStyle = {
    font: { name: FONT_NAME, sz: 11, color: color ? { rgb: color } : undefined },
    alignment: { wrapText: true, vertical: "center" },
  }
  if (alt) style.fill = { patternType: "solid", fgColor: { rgb: ALT_FILL } }
  if (numFmt) style.numFmt = numFmt
  return style
}

function signedColor(value: number | null): string | undefined {
  if (value == null || !Number.isFinite(value) || value === 0) return undefined
  return value > 0 ? RED : GREEN
}

function sheetName(seq: number, title: string): string {
  return `${String(seq).padStart(2, "0")}_${title}`.replace(/[:\\/?*[\]]/g, " ").slice(0, 31)
}

function shareRank(shareClass: string | null): number {
  return SHARE_RANK[(shareClass ?? "").trim().toUpperCase()] ?? 5
}

function betterShare(left: ShareRow, right: ShareRow): ShareRow {
  const rank = shareRank(left.share_class) - shareRank(right.share_class)
  if (rank !== 0) return rank < 0 ? left : right
  return (left.nav_row_count ?? 0) >= (right.nav_row_count ?? 0) ? left : right
}

async function loadShares(): Promise<ShareRow[]> {
  const rows = await query<{
    choice_code: string
    short_name: string | null
    full_name: string | null
    share_class: string | null
    benchmark_index: string | null
    benchmark_desc: string | null
    track_method: string | null
    type_l2: string | null
    nav_row_count: number | null
  }>(
    `SELECT choice_code, short_name, full_name, share_class, benchmark_index,
            benchmark_desc, track_method, type_l2, nav_row_count
     FROM public_enhanced_index_share`,
  ).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    if (/public_enhanced_index_share/.test(message)) {
      throw new Error("公募指增名单还没有入库")
    }
    throw err
  })
  const out: ShareRow[] = []
  for (const row of rows) {
    const bucket = publicEnhancedBucket({
      benchmark: `${row.benchmark_index ?? ""} ${row.benchmark_desc ?? ""}`,
      name: `${row.short_name ?? ""} ${row.full_name ?? ""}`,
      typeL2: row.type_l2,
      trackMethod: row.track_method,
    })
    if (!bucket) continue
    out.push({ ...row, bucket })
  }
  return out
}

function collapseShares(rows: ShareRow[]): ShareRow[] {
  const byProduct = new Map<string, ShareRow>()
  for (const row of rows) {
    const product = (row.full_name || row.short_name || row.choice_code).trim()
    const key = `${row.bucket}\0${product}`
    const prev = byProduct.get(key)
    byProduct.set(key, prev ? betterShare(prev, row) : row)
  }
  return [...byProduct.values()]
}

function toFunds(rows: ShareRow[]): WeeklyReviewFund[] {
  return rows.map((row) => ({
    beian_hao: row.choice_code,
    product_name: row.full_name || row.short_name || row.choice_code,
    short_name: row.short_name,
    l1: "公募指增",
    l2: row.benchmark_index,
    l3: row.bucket,
  }))
}

export async function buildPublicEnhancedWeeklyPreview(weekEndRaw: string): Promise<WeeklyReviewPreview> {
  const { weekStart, weekEnd, asOf } = resolveWeekWindow(weekEndRaw || defaultWeeklyReviewWeekEnd())
  const funds = collapseShares(await loadShares())
  const counts = new Map<string, number>()
  for (const fund of funds) counts.set(fund.bucket, (counts.get(fund.bucket) ?? 0) + 1)
  const groups = PUBLIC_ENHANCED_BUCKET_ORDER
    .filter((bucket) => (counts.get(bucket) ?? 0) > 0)
    .map((bucket) => ({
      bucket,
      mode: (bucket === PUBLIC_ENHANCED_ABSOLUTE_BUCKET ? "absolute" : "excess") as MetricMode,
      count: counts.get(bucket) ?? 0,
    }))
  return {
    week_start: weekStart,
    week_end: weekEnd,
    as_of: asOf,
    fund_count: funds.length,
    groups,
  }
}

type PerfPoint = {
  ret_1w: number | null
  ret_1m: number | null
  ret_3m: number | null
  ret_6m: number | null
  ret_1y: number | null
}

export type PublicEnhancedWeeklyPerformance = {
  week_start: string
  week_end: string
  as_of: string
  fund_count: number
  groups: Array<{
    bucket: string
    mode: MetricMode
    count: number
    median: PerfPoint
    products: Array<PerfPoint & { code: string; name: string }>
  }>
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null
}

function medianOf(values: Array<number | null>): number | null {
  const nums = values.filter((value): value is number => value != null).sort((a, b) => a - b)
  if (nums.length === 0) return null
  const mid = Math.floor(nums.length / 2)
  return nums.length % 2 === 1 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
}

function perfPoint(row: FundMetrics, mode: MetricMode): PerfPoint {
  const source = mode === "excess" ? row.excess : row.ret
  return {
    ret_1w: finiteOrNull(source.ret_1w),
    ret_1m: finiteOrNull(source.ret_1m),
    ret_3m: finiteOrNull(source.ret_3m),
    ret_6m: finiteOrNull(source.ret_6m),
    ret_1y: finiteOrNull(source.ret_1y),
  }
}

export async function buildPublicEnhancedWeeklyPerformance(weekEndRaw: string): Promise<PublicEnhancedWeeklyPerformance> {
  const { weekStart, weekEnd, asOf } = resolveWeekWindow(weekEndRaw || defaultWeeklyReviewWeekEnd())
  const shares = collapseShares(await loadShares())
  const funds = toFunds(shares)
  const histories = await loadNavHistories(funds.map((fund) => fund.beian_hao), asOf)
  const metrics = funds.length === 0 ? [] : await computeFundMetrics(funds, asOf, histories, {
    bucketFor: (fund) => fund.l3 || PUBLIC_ENHANCED_ABSOLUTE_BUCKET,
    modeFor: (bucket) => (bucket === PUBLIC_ENHANCED_ABSOLUTE_BUCKET ? "absolute" : "excess"),
  })
  const byBucket = new Map<string, FundMetrics[]>()
  for (const row of metrics) {
    const list = byBucket.get(row.bucket) ?? []
    list.push(row)
    byBucket.set(row.bucket, list)
  }
  const groups = PUBLIC_ENHANCED_BUCKET_ORDER
    .filter((bucket) => (byBucket.get(bucket) ?? []).length > 0)
    .map((bucket) => {
      const mode: MetricMode = bucket === PUBLIC_ENHANCED_ABSOLUTE_BUCKET ? "absolute" : "excess"
      const products = [...(byBucket.get(bucket) ?? [])]
        .map((row) => ({ code: row.beian_hao, name: row.name, ...perfPoint(row, mode) }))
        .sort((a, b) => (b.ret_1w ?? -Infinity) - (a.ret_1w ?? -Infinity))
      const median: PerfPoint = {
        ret_1w: medianOf(products.map((row) => row.ret_1w)),
        ret_1m: medianOf(products.map((row) => row.ret_1m)),
        ret_3m: medianOf(products.map((row) => row.ret_3m)),
        ret_6m: medianOf(products.map((row) => row.ret_6m)),
        ret_1y: medianOf(products.map((row) => row.ret_1y)),
      }
      return { bucket, mode, count: products.length, median, products }
    })
  return {
    week_start: weekStart,
    week_end: weekEnd,
    as_of: asOf,
    fund_count: shares.length,
    groups,
  }
}

async function loadNavHistories(codes: string[], asOf: string): Promise<Map<string, NavPoint[]>> {
  const out = new Map<string, NavPoint[]>()
  if (codes.length === 0) return out
  const since = addDays(asOf, NAV_HISTORY_LOOKBACK_DAYS)
  const rows = await query<{
    choice_code: string
    nav_date: Date | string
    unit_nav: string | number | null
    rehabilitation_nav: string | number | null
  }>(
    `SELECT choice_code, nav_date, unit_nav, rehabilitation_nav
     FROM public_enhanced_index_nav
     WHERE choice_code = ANY($1::text[])
       AND nav_date >= $2::date
       AND nav_date <= $3::date
     ORDER BY choice_code, nav_date`,
    [codes, since, asOf],
  )
  for (const row of rows) {
    const rehab = n(row.rehabilitation_nav)
    const unit = n(row.unit_nav)
    const value = rehab != null && rehab > 0 ? rehab : unit
    if (value == null || value <= 0) continue
    const navDate = fmtIso(row.nav_date)
    if (!isChinaTradingDay(navDate)) continue
    const list = out.get(row.choice_code) ?? []
    list.push({ nav: value, nav_date: navDate, return_nav: value })
    out.set(row.choice_code, list)
  }
  return out
}

function benchNote(bucket: string): string {
  const codes = BENCH_BY_BUCKET[bucket] ?? []
  const dotted = codes.filter((code) => code.includes("."))
  if (dotted.length === 0) return "绝对收益，不计算超额"
  if (dotted.length === 1) return dotted[0]
  return `${dotted[0]}；序列缺失时依次改用 ${dotted.slice(1).join("、")}`
}

function methodologyRows(weekStart: string, weekEnd: string): Array<{ kind: "title" | "pair" | "spacer"; label?: string; text: string }> {
  const benchRows = PUBLIC_ENHANCED_BUCKET_ORDER
    .filter((bucket) => bucket !== PUBLIC_ENHANCED_ABSOLUTE_BUCKET)
    .map((bucket) => ({ kind: "pair" as const, label: bucket, text: benchNote(bucket) }))
  return [
    { kind: "title", text: `口径说明（统计区间 ${weekStart} ~ ${weekEnd}，截止日 ${weekEnd}）` },
    {
      kind: "pair",
      label: "样本范围",
      text: "Choice 公募增强指数型份额。债券和全债指数增强不进入。量化选股、灵活配置等非指数增强产品不进入。",
    },
    {
      kind: "pair",
      label: "份额合并",
      text: "同一基准分组里，同一产品的 A/C/E 份额合并为一行。优先 A，其次 E，再次没有份额字母的份额，然后是 C。同一级别里净值点数更多的份额优先。场内 ETF 和联接基金名称不同，各占一行。",
    },
    {
      kind: "pair",
      label: "净值取值",
      text: "收益用 Choice 复权单位净值。没有复权净值时用单位净值。只保留 A 股交易日。回看约 400 个自然日。",
    },
    {
      kind: "pair",
      label: "统计截止",
      text: "近一周收益和近一周超额的期末净值必须落在统计区间内（该周周一至截止日）。区间内没有净值时这两格留空。近一月及更长区间截止到截止日当日或之前最近一条已公布净值。",
    },
    {
      kind: "pair",
      label: "超额收益",
      text: "指数增强分组先把基金复权净值和基准收盘价各自归一，超额净值 = 基金归一净值 / 基准归一净值。各期超额是超额净值在 7 / 30 / 90 / 180 / 365 个自然日窗口上的涨跌幅。基准对齐到每个净值日当日或之前的最近收盘价。其他指增列绝对收益、近一年夏普和近一年卡玛。",
    },
    {
      kind: "pair",
      label: "排序与颜色",
      text: "各表按近一周超额（其他指增按近一周收益）从高到低排列。正收益为红色，负收益为绿色。百分比单元格存的是小数（1% 为 0.01）。",
    },
    { kind: "spacer", text: "" },
    { kind: "title", text: "超额基准对照" },
    ...benchRows,
    {
      kind: "pair",
      label: "其他指增",
      text: "基准不是上面这些宽基的增强产品。不计算超额，改为绝对收益。",
    },
  ]
}

export async function generatePublicEnhancedWeeklyWorkbook(weekEndRaw: string): Promise<{
  buffer: Buffer
  fileName: string
  fundCount: number
  groupCount: number
}> {
  const { weekStart, weekEnd, asOf } = resolveWeekWindow(weekEndRaw || defaultWeeklyReviewWeekEnd())
  const shares = collapseShares(await loadShares())
  if (shares.length === 0) throw new Error("没有可导出的公募指增产品")
  const funds = toFunds(shares)
  const histories = await loadNavHistories(funds.map((fund) => fund.beian_hao), asOf)
  const metrics = await computeFundMetrics(funds, asOf, histories, {
    bucketFor: (fund) => fund.l3 || "其他指增",
    modeFor: (bucket) => (bucket === PUBLIC_ENHANCED_ABSOLUTE_BUCKET ? "absolute" : "excess"),
  })
  const market = await buildMarketRows(weekStart, weekEnd)

  const xlsxMod = await import("xlsx-js-style") as {
    default?: typeof import("xlsx")
    utils?: typeof import("xlsx")["utils"]
    write?: (wb: unknown, opts: { bookType: string; type: string; cellStyles?: boolean }) => Buffer
  }
  const XLSX = (xlsxMod.utils ? xlsxMod : xlsxMod.default) as typeof import("xlsx") & {
    write: (wb: unknown, opts: { bookType: string; type: string; cellStyles?: boolean }) => Buffer
  }
  const wb = XLSX.utils.book_new()
  const groups = new Map<string, FundMetrics[]>()
  for (const row of metrics) {
    const list = groups.get(row.bucket) ?? []
    list.push(row)
    groups.set(row.bucket, list)
  }
  const ordered = PUBLIC_ENHANCED_BUCKET_ORDER.filter((bucket) => (groups.get(bucket) ?? []).length > 0)

  const tocRows: unknown[][] = [["页码", "工作表", "标题", "行数", "列数"]]
  const sheets: Array<{
    name: string
    title: string
    aoa: unknown[][]
    styles: Map<string, CellStyle>
    cols: number[]
    rowHeight: number
  }> = []

  {
    const notes = methodologyRows(weekStart, weekEnd)
    const aoa: unknown[][] = []
    const styles = new Map<string, CellStyle>()
    notes.forEach((note, index) => {
      if (note.kind === "title") {
        aoa.push([note.text, ""])
        styles.set(`${index},0`, headerStyle())
      } else if (note.kind === "pair") {
        aoa.push([note.label, note.text])
        styles.set(`${index},0`, bodyStyle(false))
        styles.set(`${index},1`, bodyStyle(false))
      } else {
        aoa.push(["", ""])
      }
    })
    sheets.push({
      name: "口径说明",
      title: "口径说明",
      aoa,
      styles,
      cols: [16, 92],
      rowHeight: 32,
    })
    tocRows.push(["—", "口径说明", "口径说明", notes.filter((note) => note.kind !== "spacer").length, 2])
  }

  {
    const aoa: unknown[][] = []
    const styles = new Map<string, CellStyle>()
    const set = (r: number, c: number, value: unknown, style?: CellStyle) => {
      while (aoa.length <= r) aoa.push([])
      aoa[r][c] = value
      if (style) styles.set(`${r},${c}`, style)
    }
    const dateHeader = { ...headerStyle(), alignment: { wrapText: false, vertical: "center" as const } }
    set(0, 0, "起止日期", dateHeader)
    set(0, 1, market.rangeLabel, dateHeader)
    const headers = ["宽基指数", "代码", "涨跌幅", "风格指数", "代码", "涨跌幅", "全A成交量", "上涨家数", "大类指数", "代码", "涨跌幅"]
    headers.forEach((header, col) => set(1, col, header, bodyStyle(true)))
    const nRows = Math.max(market.broad.length, market.style.length, market.sector.length)
    for (let i = 0; i < nRows; i++) {
      const alt = i % 2 === 1
      const broad = market.broad[i]
      const style = market.style[i]
      const sector = market.sector[i]
      if (broad) {
        set(2 + i, 0, broad.name, bodyStyle(alt))
        set(2 + i, 1, broad.code, bodyStyle(alt))
        set(2 + i, 2, broad.ret, bodyStyle(alt, signedColor(broad.ret), "0.00%"))
      }
      if (style) {
        set(2 + i, 3, style.name, bodyStyle(alt))
        set(2 + i, 4, style.code, bodyStyle(alt))
        set(2 + i, 5, style.ret, bodyStyle(alt, signedColor(style.ret), "0.00%"))
      }
      if (sector) {
        set(2 + i, 8, sector.name, bodyStyle(alt))
        set(2 + i, 9, sector.code, bodyStyle(alt))
        set(2 + i, 10, sector.ret, bodyStyle(alt, signedColor(sector.ret), "0.00%"))
      }
    }
    market.breadth.slice(0, 5).forEach((day, i) => {
      const alt = i % 2 === 1
      set(2 + i, 6, day.amountYi == null ? null : Math.round(day.amountYi), bodyStyle(alt, undefined, "#,##0"))
      set(2 + i, 7, day.advancers == null ? null : Math.round(day.advancers), bodyStyle(alt, undefined, "#,##0"))
    })
    set(7, 6, "日均成交量", bodyStyle(true))
    set(7, 7, "平均上涨家数", bodyStyle(true))
    set(8, 6, market.avgAmount == null ? null : Math.round(market.avgAmount), bodyStyle(false, undefined, "#,##0"))
    set(8, 7, market.avgAdv == null ? null : Math.round(market.avgAdv), bodyStyle(false, undefined, "#,##0"))
    const name = sheetName(3, "股票市场回顾")
    sheets.push({
      name,
      title: "股票市场回顾",
      aoa,
      styles,
      cols: [14, 22, 10, 12, 14, 10, 14, 14, 12, 12, 10],
      rowHeight: 22,
    })
    tocRows.push([3, name, "股票市场回顾", nRows, 11])
  }

  let seq = 4
  for (const bucket of ordered) {
    const rows = groups.get(bucket) ?? []
    const mode: MetricMode = bucket === PUBLIC_ENHANCED_ABSOLUTE_BUCKET ? "absolute" : "excess"
    const headers = mode === "excess"
      ? ["产品名称", "近一周超额收益", "近一月超额收益", "近三月超额收益", "近六月超额收益", "近六月超额最大回撤", "近一年超额收益", "近一年超额最大回撤"]
      : ["产品名称", "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益", "近一年夏普比率", "近一年卡玛比率"]
    const sorted = [...rows].sort((a, b) => {
      const left = mode === "excess" ? a.excess.ret_1w : a.ret.ret_1w
      const right = mode === "excess" ? b.excess.ret_1w : b.ret.ret_1w
      return (right ?? -Infinity) - (left ?? -Infinity)
    })
    const aoa: unknown[][] = []
    const styles = new Map<string, CellStyle>()
    const set = (r: number, c: number, value: unknown, style?: CellStyle) => {
      while (aoa.length <= r) aoa.push([])
      aoa[r][c] = value ?? null
      if (style) styles.set(`${r},${c}`, style)
    }
    headers.forEach((header, col) => set(0, col, header, headerStyle()))
    sorted.forEach((row, index) => {
      const alt = index % 2 === 0
      const share = shares.find((item) => item.choice_code === row.beian_hao)
      set(index + 1, 0, displayName(share?.full_name || row.name, share?.short_name ?? row.name, row.beian_hao), bodyStyle(alt))
      if (mode === "excess") {
        const values = [
          row.excess.ret_1w, row.excess.ret_1m, row.excess.ret_3m, row.excess.ret_6m,
          row.excess_dd_6m, row.excess.ret_1y, row.excess_dd_1y,
        ]
        values.forEach((value, col) => {
          const drawdown = col === 4 || col === 6
          set(index + 1, col + 1, value, bodyStyle(alt, drawdown ? undefined : signedColor(value), "0.00%"))
        })
      } else {
        const values = [row.ret.ret_1w, row.ret.ret_1m, row.ret.ret_3m, row.ret.ret_6m, row.ret.ret_1y]
        values.forEach((value, col) => set(index + 1, col + 1, value, bodyStyle(alt, signedColor(value), "0.00%")))
        set(index + 1, 6, row.sharpe_1y, bodyStyle(alt, undefined, "0.0000"))
        set(index + 1, 7, row.calmar_1y, bodyStyle(alt, undefined, "0.0000"))
      }
    })
    const name = sheetName(seq, bucket)
    sheets.push({
      name,
      title: bucket,
      aoa,
      styles,
      cols: [28, 16, 16, 16, 16, 18, 16, 18],
      rowHeight: 27,
    })
    tocRows.push([seq, name, bucket, sorted.length, headers.length])
    seq += 1
  }

  const tocWs = XLSX.utils.aoa_to_sheet(tocRows)
  styleSheet(tocWs, tocRows.length, 5, (r) => (r === 0 ? headerStyle() : undefined), XLSX)
  tocWs["!cols"] = [{ wch: 10 }, { wch: 28 }, { wch: 22 }, { wch: 10 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, tocWs, "目录")
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.aoa)
    const maxCol = Math.max(0, ...sheet.aoa.map((row) => row.length))
    styleSheet(ws, sheet.aoa.length, maxCol, (r, c) => sheet.styles.get(`${r},${c}`), XLSX)
    ws["!cols"] = sheet.cols.map((wch) => ({ wch }))
    ws["!rows"] = Array.from({ length: sheet.aoa.length }, () => ({ hpt: sheet.rowHeight }))
    XLSX.utils.book_append_sheet(wb, ws, sheet.name)
  }

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer", cellStyles: true }) as unknown as Buffer
  const fileName = `公募指增周度回顾 - ${weekEnd.slice(2, 4)}.${weekEnd.slice(5, 7)}.${weekEnd.slice(8, 10)}.xlsx`
  return { buffer, fileName, fundCount: shares.length, groupCount: ordered.length }
}

function styleSheet(
  ws: Record<string, unknown>,
  rows: number,
  cols: number,
  styleAt: (r: number, c: number) => CellStyle | undefined,
  XLSX: typeof import("xlsx"),
) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[addr] as { s?: CellStyle; z?: string } | undefined
      if (!cell) continue
      const style = styleAt(r, c)
      if (!style) continue
      cell.s = style
      if (style.numFmt) cell.z = style.numFmt
    }
  }
}

const JOB_ROOT = path.join(process.cwd(), ".tmp", "public-enhanced-weekly-review")

export type PublicEnhancedWeeklyJobStatus = {
  status: "pending" | "running" | "done" | "error"
  jobId: string
  updatedAt: string
  error?: string
  fileName?: string
  fundCount?: number
  groupCount?: number
}

function jobDir(jobId: string): string {
  return path.join(JOB_ROOT, jobId)
}

export function isValidPublicEnhancedWeeklyJobId(id: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(id)
}

async function writeJobStatus(status: PublicEnhancedWeeklyJobStatus): Promise<void> {
  await mkdir(jobDir(status.jobId), { recursive: true })
  await writeFile(path.join(jobDir(status.jobId), "status.json"), JSON.stringify(status), "utf8")
}

export async function preparePublicEnhancedWeeklyJob(): Promise<string> {
  const jobId = randomUUID()
  await writeJobStatus({ status: "pending", jobId, updatedAt: new Date().toISOString() })
  return jobId
}

export async function getPublicEnhancedWeeklyJobStatus(jobId: string): Promise<PublicEnhancedWeeklyJobStatus> {
  if (!isValidPublicEnhancedWeeklyJobId(jobId)) throw new Error("无效的任务 ID")
  const raw = await readFile(path.join(jobDir(jobId), "status.json"), "utf8").catch(() => null)
  if (!raw) throw new Error("任务不存在")
  return JSON.parse(raw) as PublicEnhancedWeeklyJobStatus
}

export async function readPublicEnhancedWeeklyJobFile(jobId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const status = await getPublicEnhancedWeeklyJobStatus(jobId)
  if (status.status !== "done" || !status.fileName) throw new Error("文件尚未生成")
  const buffer = await readFile(path.join(jobDir(jobId), "report.xlsx"))
  return { buffer, fileName: status.fileName }
}

export async function runPublicEnhancedWeeklyJob(jobId: string, weekEnd: string): Promise<void> {
  await writeJobStatus({ status: "running", jobId, updatedAt: new Date().toISOString() })
  try {
    const result = await generatePublicEnhancedWeeklyWorkbook(weekEnd)
    await mkdir(jobDir(jobId), { recursive: true })
    await writeFile(path.join(jobDir(jobId), "report.xlsx"), result.buffer)
    await writeJobStatus({
      status: "done",
      jobId,
      updatedAt: new Date().toISOString(),
      fileName: result.fileName,
      fundCount: result.fundCount,
      groupCount: result.groupCount,
    })
  } catch (err) {
    await writeJobStatus({
      status: "error",
      jobId,
      updatedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
