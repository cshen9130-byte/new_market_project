import * as XLSX from "xlsx"

const WIND_FORMULA = /i_dq_close|gt_de_close|wsd\(|wss\(/i
const WIND_CODE = /^[A-Za-z0-9_]+\.(WI|NHF|CCI|NH|SH|SZ|CFE|CZC|SHF|DCE|INE|GFE)$/i

export type ParsedFactorColumn = {
  key: string
  name: string
  code: string | null
}

export type ParsedFactorWorkbook = {
  fileName: string
  sheetName: string
  factors: ParsedFactorColumn[]
  /** Calendar dates of the close series. The first date has no return. */
  dates: string[]
  /** Fractional close-to-close returns. Null means that day has no price. */
  series: Record<string, Array<number | null>>
  warnings: string[]
}

function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null
  const ms = Math.round((serial - 25569) * 86400 * 1000)
  return new Date(ms).toISOString().slice(0, 10)
}

function cellDate(cell: XLSX.CellObject | undefined): string | null {
  if (!cell || cell.v == null || cell.v === "") return null
  if (typeof cell.v === "number") return excelSerialToIso(cell.v)
  const text = String(cell.w ?? cell.v).trim()
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (!iso) return null
  return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`
}

function cellNumber(cell: XLSX.CellObject | undefined): number | null {
  if (!cell || cell.v == null || cell.v === "") return null
  if (typeof cell.v === "number" && Number.isFinite(cell.v)) return cell.v
  if (typeof cell.v === "string") {
    const parsed = Number(cell.v.replace(/,/g, "").trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v == null) return ""
  return String(cell.v).trim()
}

function isWindCode(text: string): boolean {
  return WIND_CODE.test(text)
}

type SheetCandidate = {
  sheetName: string
  score: number
  parsed: Omit<ParsedFactorWorkbook, "fileName">
}

function parseSheet(ws: XLSX.WorkSheet, sheetName: string): SheetCandidate | null {
  const ref = ws["!ref"]
  if (!ref) return null
  const range = XLSX.utils.decode_range(ref)
  if (range.e.r - range.s.r < 10 || range.e.c <= range.s.c) return null

  let dateCol = range.s.c
  let dateCount = 0
  for (let c = range.s.c; c <= range.e.c; c++) {
    let count = 0
    for (let r = range.s.r; r <= range.e.r; r++) {
      if (cellDate(ws[XLSX.utils.encode_cell({ r, c })])) count++
    }
    if (count > dateCount) {
      dateCount = count
      dateCol = c
    }
  }
  if (dateCount < 30) return null

  let firstDataRow = -1
  for (let r = range.s.r; r <= range.e.r; r++) {
    if (cellDate(ws[XLSX.utils.encode_cell({ r, c: dateCol })])) {
      firstDataRow = r
      break
    }
  }
  if (firstDataRow < 0) return null

  const nameRow = firstDataRow - 1
  const codeRow = firstDataRow - 2
  const usedKeys = new Set<string>()
  const columns: Array<{
    key: string
    name: string
    code: string | null
    levels: Map<string, number>
    zero: number
    numeric: number
    formula: number
  }> = []

  for (let c = range.s.c; c <= range.e.c; c++) {
    if (c === dateCol) continue
    const above = nameRow >= range.s.r ? cellText(ws[XLSX.utils.encode_cell({ r: nameRow, c })]) : ""
    const above2 = codeRow >= range.s.r ? cellText(ws[XLSX.utils.encode_cell({ r: codeRow, c })]) : ""
    let name = above
    let code: string | null = null
    if (isWindCode(above) && above2 && !isWindCode(above2)) {
      name = above2
      code = above
    } else if (isWindCode(above2)) {
      code = above2
      if (!name || name === "Wind代码" || isWindCode(name)) name = above2
    } else if (isWindCode(above)) {
      code = above
      name = above
    }
    if (!name || name === "Wind代码") name = code ?? ""

    const levels = new Map<string, number>()
    let zero = 0
    let numeric = 0
    let formula = 0
    for (let r = firstDataRow; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell?.f && WIND_FORMULA.test(String(cell.f))) formula++
      const date = cellDate(ws[XLSX.utils.encode_cell({ r, c: dateCol })])
      if (!date) continue
      const value = cellNumber(cell)
      if (value == null) continue
      numeric++
      if (value === 0) {
        zero++
        continue
      }
      levels.set(date, value)
    }
    if (levels.size < 30 && numeric < 30) continue
    if (!name) name = `列${c + 1}`
    const base = (code ?? name).replace(/[^A-Za-z0-9_\u4e00-\u9fff]+/g, "_").replace(/^_|_$/g, "")
    let key = base || `col_${c + 1}`
    if (usedKeys.has(key)) key = `${key}_${c + 1}`
    usedKeys.add(key)
    columns.push({ key, name, code, levels, zero, numeric, formula })
  }

  if (!columns.length) return null

  const warnings: string[] = []
  const kept = columns.filter((col) => {
    const zeroShare = col.numeric > 0 ? col.zero / col.numeric : 1
    if (col.levels.size < 30) {
      warnings.push(`${col.name}：有效收盘价少于 30 个，已跳过。`)
      return false
    }
    if (zeroShare >= 0.8 && col.formula > 0) {
      warnings.push(
        `${col.name}：保存下来的值几乎全是 0，格子里是万得公式。请先打开并登录 Wind 终端，在 Excel 里刷新后保存，再上传。这一列已跳过。`,
      )
      return false
    }
    if (zeroShare >= 0.8) {
      warnings.push(`${col.name}：非零收盘价太少，已跳过。`)
      return false
    }
    if (col.zero > 0 && col.formula > 0) {
      warnings.push(`${col.name}：有 ${col.zero} 个 0。万得公式在终端没打开时会被算成 0，这些点已当作缺失。`)
    }
    return true
  })

  if (!kept.length) {
    return {
      sheetName,
      score: 0,
      parsed: {
        sheetName,
        factors: [],
        dates: [],
        series: {},
        warnings: warnings.length
          ? warnings
          : ["没有可用的因子列。若表格使用万得公式，请先打开 Wind 终端刷新并保存。"],
      },
    }
  }

  const nameCount = new Map<string, number>()
  for (const col of kept) nameCount.set(col.name, (nameCount.get(col.name) ?? 0) + 1)

  const dateSet = new Set<string>()
  for (const col of kept) {
    for (const date of col.levels.keys()) dateSet.add(date)
  }
  const dates = [...dateSet].sort()
  const series: Record<string, Array<number | null>> = {}
  for (const col of kept) {
    const returns: Array<number | null> = []
    let last: number | null = null
    for (const date of dates) {
      const level = col.levels.get(date)
      if (level == null) {
        returns.push(null)
        continue
      }
      returns.push(last != null && last > 0 ? level / last - 1 : null)
      last = level
    }
    series[col.key] = returns
  }

  return {
    sheetName,
    score: kept.reduce((sum, col) => sum + col.levels.size, 0) + (sheetName.includes("因子") ? 1_000_000 : 0),
    parsed: {
      sheetName,
      factors: kept.map((col) => ({
        key: col.key,
        name: (nameCount.get(col.name) ?? 0) > 1 && col.code ? `${col.name}（${col.code}）` : col.name,
        code: col.code,
      })),
      dates,
      series,
      warnings,
    },
  }
}

/** Read a one-time factor workbook. Uses cached cell values, not live Wind formulas. */
export function parseFactorWorkbook(buffer: Buffer, fileName: string): ParsedFactorWorkbook {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, cellFormula: true })
  const candidates = workbook.SheetNames
    .map((name) => parseSheet(workbook.Sheets[name], name))
    .filter((item): item is SheetCandidate => item != null && item.parsed.factors.length > 0)
    .sort((a, b) => b.score - a.score)

  if (!candidates.length) {
    const failed = workbook.SheetNames
      .map((name) => parseSheet(workbook.Sheets[name], name))
      .find((item) => item && item.parsed.warnings.length)
    const detail = failed?.parsed.warnings[0]
    throw new Error(
      detail
        ?? "没有读到因子收盘价。若格子是万得公式，请先打开并登录 Wind 终端，在 Excel 里刷新并保存后再上传。刷新失败时不要保存，否则会把原来的数字覆盖成 0。",
    )
  }

  const best = candidates[0]
  const warnings = [...best.parsed.warnings]
  const skipped = candidates.slice(1).map((item) => item.sheetName)
  if (skipped.length) {
    warnings.push(`本次使用工作表「${best.sheetName}」。未使用：${skipped.join("、")}。`)
  }

  return {
    fileName,
    ...best.parsed,
    warnings,
  }
}
