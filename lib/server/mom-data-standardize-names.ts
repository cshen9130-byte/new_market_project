import fs from "fs"
import path from "path"
import * as XLSX from "xlsx"

export type StandardizeNamesResult = {
  renamedFiles: string[]
  renamedFolders: string[]
  errors: string[]
  duplicates: string[]
  nothingToDo: boolean
}

export function getMomDataBaseDir(): string {
  return process.env.MOM_DATA_DIR ?? path.join(process.cwd(), "..", "mom_data", "03.投顾逐日")
}

// Detail/position sheets. The header row is found by its first label because the
// 2026-11-18 export moved it from row 11 to row 9. Used so standardization keeps
// the richer file when two workbooks map to the same name.
const DATA_SHEETS = [
  "成交明细", "持仓明细", "期货成交明细", "期权成交明细",
  "平仓明细", "期货持仓明细", "期权持仓明细", "委托明细",
]
const HEADER_MARKERS = new Set(["合约", "报单编号", "品种"])
const ACCOUNT_LABELS = new Set(["账户", "账户(别名)", "账户（别名）"])

function cellText(ws: XLSX.WorkSheet, row: number, col: number): string {
  const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })]
  if (!cell || cell.v == null) return ""
  return String(cell.v).trim()
}

function normalizeSheetDate(raw: string): string {
  const compact = raw.trim().replace(/\.0$/, "").replace(/-/g, "").replace(/\//g, "")
  return /^\d{8}$/.test(compact) ? compact : raw.trim()
}

/** Account code before the alias parenthesis: rx311(李晓东（黑色）) -> rx311. */
function normalizeAccountCode(raw: string): string {
  return raw.split(/[（(]/)[0].trim()
}

/** 如川 rc* workbooks are packed with the 恒盈2 rx* files. MOM keeps rx only. */
export function isExcludedMomWorkbookName(filename: string): boolean {
  const base = path.basename(filename)
  return /^(?:核算信息_)?rc(?=\d|_)/i.test(base)
}

export function isExcludedMomAccount(account: string): boolean {
  return /^rc(?=\d|_)/i.test(account.trim())
}

/**
 * Read 账户 / 账户(别名) and 交易日期 from the 基本资料 block.
 * Old files put them at D6 / I6. The 2026-11-18 file puts them at C5 / E5.
 */
function readAccountAndDate(ws: XLSX.WorkSheet): { account: string; date: string } {
  let account = ""
  let date = ""
  const ref = ws["!ref"]
  if (!ref) return { account, date }
  const range = XLSX.utils.decode_range(ref)
  const lastRow = Math.min(range.e.r, 14)
  const lastCol = Math.min(Math.max(range.e.c, 0), 16)
  for (let row = range.s.r; row <= lastRow && (!account || !date); row++) {
    const cells: string[] = []
    for (let col = 0; col <= lastCol; col++) cells.push(cellText(ws, row, col))
    for (let col = 0; col < cells.length; col++) {
      const label = cells[col]
      if (!account && ACCOUNT_LABELS.has(label)) {
        const value = cells.slice(col + 1).find((item) => item && !ACCOUNT_LABELS.has(item) && item !== "交易日期")
        if (value) account = normalizeAccountCode(value)
      }
      if (!date && label === "交易日期") {
        const value = cells.slice(col + 1).find((item) => item && item !== "交易日期")
        if (value) date = normalizeSheetDate(value)
      }
    }
  }
  return { account, date }
}

/** Count real data rows across the detail/position sheets of a workbook. */
function countDataRows(wb: XLSX.WorkBook): number {
  let total = 0
  for (const name of DATA_SHEETS) {
    const ws = wb.Sheets[name]
    const ref = ws?.["!ref"]
    if (!ref) continue
    try {
      const range = XLSX.utils.decode_range(ref)
      let headerRow = -1
      const scanEnd = Math.min(range.e.r, range.s.r + 25)
      for (let row = range.s.r; row <= scanEnd; row++) {
        if (HEADER_MARKERS.has(cellText(ws, row, 1))) {
          headerRow = row
          break
        }
      }
      if (headerRow < 0) continue
      for (let row = headerRow + 1; row <= range.e.r; row++) {
        const lead = cellText(ws, row, 1)
        if (!lead) continue
        if (lead === "合计") break
        total += 1
      }
    } catch {
      // ignore malformed ranges
    }
  }
  return total
}

/**
 * Rename xlsx/xls files and day folders under 03.投顾逐日 to the canonical format.
 * When filterFolders is omitted or empty, all folders are processed.
 */
export function standardizeMomDataNames(filterFolders?: string[] | null): StandardizeNamesResult {
  const BASE_DIR = getMomDataBaseDir()

  const result: StandardizeNamesResult = {
    renamedFiles: [],
    renamedFolders: [],
    errors: [],
    duplicates: [],
    nothingToDo: false,
  }

  if (!fs.existsSync(BASE_DIR)) {
    result.errors.push(`目录不存在: ${BASE_DIR}`)
    result.nothingToDo = false
    return result
  }

  const folderDateMap: Record<string, string> = {}

  const allFolders = fs
    .readdirSync(BASE_DIR)
    .filter((e) => fs.statSync(path.join(BASE_DIR, e)).isDirectory())

  const folders =
    filterFolders && filterFolders.length > 0
      ? allFolders.filter((f) => filterFolders.includes(f))
      : allFolders

  for (const folder of folders) {
    const folderPath = path.join(BASE_DIR, folder)
    const files = fs
      .readdirSync(folderPath)
      .filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith("~$"))

    for (const fname of files) {
      const fpath = path.join(folderPath, fname)
      if (isExcludedMomWorkbookName(fname)) {
        try { fs.unlinkSync(fpath) } catch { /* already gone */ }
        continue
      }
      let account = ""
      let date = ""
      let srcDataRows = 0

      try {
        const buf = fs.readFileSync(fpath)
        const wb = XLSX.read(buf, { type: "buffer", cellDates: false })
        if (!wb.SheetNames.includes("品种汇总")) {
          result.errors.push(`无品种汇总工作表: ${path.join(folder, fname)}`)
          continue
        }
        const ws = wb.Sheets["品种汇总"]
        if (!ws) {
          result.errors.push(`无品种汇总工作表: ${path.join(folder, fname)}`)
          continue
        }
        const identity = readAccountAndDate(ws)
        account = identity.account
        date = identity.date
        srcDataRows = countDataRows(wb)
      } catch (e) {
        result.errors.push(`读取失败: ${path.join(folder, fname)} — ${e instanceof Error ? e.message : e}`)
        continue
      }

      if (!account || !date) continue

      if (isExcludedMomAccount(account)) {
        try { fs.unlinkSync(fpath) } catch { /* already gone */ }
        continue
      }

      if (!folderDateMap[folder]) {
        folderDateMap[folder] = date
      }

      const ext = path.extname(fname).toLowerCase()
      const expectedName = `核算信息_${account}_${date}_逐日盯市${ext === ".xls" ? ".xls" : ".xlsx"}`
      if (fname !== expectedName) {
        const newPath = path.join(folderPath, expectedName)
        if (fs.existsSync(newPath)) {
          // A file with the canonical name already exists. Never blindly delete
          // the incoming file — it may hold real data while the existing one is
          // an empty/preliminary export (this previously wiped good uploads).
          // Keep whichever workbook has more data rows; tiebreak on newer mtime.
          // Use unlinkSync, not rmSync: on Node 24, fs.rmSync aborts the process
          // for paths that contain Chinese characters, which kills the dev server.
          let keepIncoming: boolean
          try {
            const existingWb = XLSX.read(fs.readFileSync(newPath), { type: "buffer", cellDates: false })
            const existingRows = countDataRows(existingWb)
            if (srcDataRows !== existingRows) {
              keepIncoming = srcDataRows > existingRows
            } else {
              keepIncoming = fs.statSync(fpath).mtimeMs > fs.statSync(newPath).mtimeMs
            }
          } catch {
            // If the existing file can't be read, prefer the incoming one.
            keepIncoming = true
          }

          if (keepIncoming) {
            fs.unlinkSync(newPath)
            fs.renameSync(fpath, newPath)
            result.renamedFiles.push(`[${folder}] ${fname} → ${expectedName} (替换已有同名文件)`)
          } else {
            fs.unlinkSync(fpath)
            result.duplicates.push(`[${folder}] 已删除数据较少的重复文件: ${fname}`)
          }
        } else {
          fs.renameSync(fpath, newPath)
          result.renamedFiles.push(`[${folder}] ${fname} → ${expectedName}`)
        }
      }
    }
  }

  const folderPattern = /^(.*?)(\d{8})(核算单)$/
  for (const [folder, date] of Object.entries(folderDateMap)) {
    const m = folderPattern.exec(folder)
    let needsRename = false
    let expectedFolder = ""

    if (!m) {
      expectedFolder = `恒2 ${date}核算单`
      needsRename = true
    } else {
      const [, prefix, folderDateStr, suffix] = m
      if (folderDateStr !== date) {
        expectedFolder = `${prefix}${date}${suffix}`
        needsRename = true
      }
    }

    if (needsRename) {
      const oldPath = path.join(BASE_DIR, folder)
      const newPath = path.join(BASE_DIR, expectedFolder)
      if (fs.existsSync(newPath)) {
        result.duplicates.push(`文件夹已存在，跳过: ${folder} → ${expectedFolder}`)
      } else {
        fs.renameSync(oldPath, newPath)
        result.renamedFolders.push(`${folder} → ${expectedFolder}`)
      }
    }
  }

  result.nothingToDo =
    result.renamedFiles.length === 0 &&
    result.renamedFolders.length === 0 &&
    result.errors.length === 0 &&
    result.duplicates.length === 0

  return result
}

export function formatStandardizeNamesSummary(result: StandardizeNamesResult): string[] {
  const lines: string[] = []
  if (result.nothingToDo) {
    lines.push("所有文件名和文件夹名均符合标准格式。")
    return lines
  }
  if (result.renamedFiles.length > 0) {
    lines.push(`已重命名 ${result.renamedFiles.length} 个文件`)
  }
  if (result.renamedFolders.length > 0) {
    lines.push(`已重命名 ${result.renamedFolders.length} 个文件夹`)
  }
  if (result.duplicates.length > 0) {
    lines.push(`已清理 ${result.duplicates.length} 个重复项`)
  }
  if (result.errors.length > 0) {
    lines.push(`${result.errors.length} 个错误`)
  }
  return lines
}
