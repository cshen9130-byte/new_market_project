import fs from "fs"
import path from "path"
import * as XLSX from "xlsx"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE_DIR = path.join(process.cwd(), "mom_data", "03.投顾逐日")

type RenameResult = {
  renamedFiles: string[]
  renamedFolders: string[]
  errors: string[]
  duplicates: string[]
  nothingToDo: boolean
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!fs.existsSync(BASE_DIR)) {
      return NextResponse.json({ error: "目录不存在: mom_data/03.投顾逐日" }, { status: 404 })
    }

    // Optional: only process specific folders (e.g. those just uploaded)
    let filterFolders: string[] | null = null
    try {
      const body = await request.json()
      if (Array.isArray(body?.folders) && body.folders.length > 0) {
        filterFolders = body.folders as string[]
      }
    } catch {
      // no body or invalid JSON — process all
    }

    const result: RenameResult = {
      renamedFiles: [],
      renamedFolders: [],
      errors: [],
      duplicates: [],
      nothingToDo: false,
    }

    // Map: original folder name -> date string extracted from first valid xlsx
    const folderDateMap: Record<string, string> = {}

    const allFolders = fs
      .readdirSync(BASE_DIR)
      .filter((e) => fs.statSync(path.join(BASE_DIR, e)).isDirectory())

    const folders = filterFolders
      ? allFolders.filter((f) => filterFolders!.includes(f))
      : allFolders

    for (const folder of folders) {
      let folderPath = path.join(BASE_DIR, folder)
      const files = fs
        .readdirSync(folderPath)
        .filter((f) => f.endsWith(".xlsx") && !f.startsWith("~$"))

      for (const fname of files) {
        const fpath = path.join(folderPath, fname)
        let account = ""
        let date = ""

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
        } catch (e) {
          result.errors.push(`读取失败: ${path.join(folder, fname)} — ${e instanceof Error ? e.message : e}`)
          continue
        }

        if (!account || !date) continue

        // Record first valid date for this folder
        if (!folderDateMap[folder]) {
          folderDateMap[folder] = date
        }

        // Rename file if needed
        const expectedName = `核算信息_${account}_${date}_逐日盯市.xlsx`
        if (fname !== expectedName) {
          const newPath = path.join(folderPath, expectedName)
          if (fs.existsSync(newPath)) {
            result.duplicates.push(`[${folder}] 文件已存在，跳过: ${fname} → ${expectedName}`)
          } else {
            fs.renameSync(fpath, newPath)
            result.renamedFiles.push(`[${folder}] ${fname} → ${expectedName}`)
          }
        }
      }
    }

    // Rename folders based on extracted dates
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

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "重命名操作失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
