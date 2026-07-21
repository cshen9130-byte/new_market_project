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

// Detail/position sheets whose data rows start after the header (row 11) and the
// 合计 total row (row 12). Used to measure how much real data a workbook holds so
// standardization never discards the richer file when two map to the same name.
const DATA_SHEETS = [
  "成交明细", "持仓明细", "期货成交明细", "期权成交明细",
  "平仓明细", "期货持仓明细", "期权持仓明细", "委托明细",
]
const DATA_FIRST_ROW = 13 // 1-based: row 11 header, row 12 合计, row 13+ data

/** Count real data rows across the detail/position sheets of a workbook. */
function countDataRows(wb: XLSX.WorkBook): number {
  let total = 0
  for (const name of DATA_SHEETS) {
    const ws = wb.Sheets[name]
    const ref = ws?.["!ref"]
    if (!ref) continue
    try {
      const endRow = XLSX.utils.decode_range(ref).e.r + 1 // decode_range is 0-based
      if (endRow >= DATA_FIRST_ROW) total += endRow - (DATA_FIRST_ROW - 1)
    } catch {
      // ignore malformed ranges
    }
  }
  return total
}

/**
 * Rename xlsx files and day folders under 03.投顾逐日 to the canonical format.
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
      .filter((f) => f.endsWith(".xlsx") && !f.startsWith("~$"))

    for (const fname of files) {
      const fpath = path.join(folderPath, fname)
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
        account = String(ws["D6"]?.v ?? "").trim()
        date = String(ws["I6"]?.v ?? "").trim()
        srcDataRows = countDataRows(wb)
      } catch (e) {
        result.errors.push(`读取失败: ${path.join(folder, fname)} — ${e instanceof Error ? e.message : e}`)
        continue
      }

      if (!account || !date) continue

      if (!folderDateMap[folder]) {
        folderDateMap[folder] = date
      }

      const expectedName = `核算信息_${account}_${date}_逐日盯市.xlsx`
      if (fname !== expectedName) {
        const newPath = path.join(folderPath, expectedName)
        if (fs.existsSync(newPath)) {
          // A file with the canonical name already exists. Never blindly delete
          // the incoming file — it may hold real data while the existing one is
          // an empty/preliminary export (this previously wiped good uploads).
          // Keep whichever workbook has more data rows; tiebreak on newer mtime.
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
            fs.rmSync(newPath, { force: true })
            fs.renameSync(fpath, newPath)
            result.renamedFiles.push(`[${folder}] ${fname} → ${expectedName} (替换数据较少的同名文件)`)
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
