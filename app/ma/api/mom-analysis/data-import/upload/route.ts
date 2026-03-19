import fs from "fs"
import path from "path"
import AdmZip from "adm-zip"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE_DIR = process.env.MOM_DATA_DIR ?? path.join(process.cwd(), "..", "mom_data", "03.投顾逐日")

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file")

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传一个 ZIP 文件。" }, { status: 400 })
    }

    if (!file.name.toLowerCase().endsWith(".zip")) {
      return NextResponse.json({ error: "仅支持 .zip 格式。" }, { status: 422 })
    }

    if (!fs.existsSync(BASE_DIR)) {
      fs.mkdirSync(BASE_DIR, { recursive: true })
    }

    // Snapshot existing top-level dirs BEFORE extraction
    const dirsBefore = new Set(
      fs.readdirSync(BASE_DIR).filter((e) => fs.statSync(path.join(BASE_DIR, e)).isDirectory())
    )

    const buffer = Buffer.from(await file.arrayBuffer())
    const zip = new AdmZip(buffer)
    const entries = zip.getEntries()

    let extractedCount = 0
    const skipped: string[] = []

    for (const entry of entries) {
      // Skip macOS metadata and hidden files
      if (entry.entryName.includes("__MACOSX") || path.basename(entry.entryName).startsWith(".")) {
        continue
      }

      // Resolve target path and ensure it stays within BASE_DIR
      const targetPath = path.resolve(BASE_DIR, entry.entryName)
      if (!targetPath.startsWith(BASE_DIR)) {
        skipped.push(entry.entryName)
        continue
      }

      if (entry.isDirectory) {
        fs.mkdirSync(targetPath, { recursive: true })
      } else {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        fs.writeFileSync(targetPath, entry.getData())
        extractedCount++
      }
    }

    // Collect all top-level dirs that are new
    const newTopDirs = fs
      .readdirSync(BASE_DIR)
      .filter((e) => {
        try { return fs.statSync(path.join(BASE_DIR, e)).isDirectory() && !dirsBefore.has(e) } catch { return false }
      })

    const extractedFolders: string[] = []

    // Case 1: wrapper folder (new dir whose children are the real day folders) — flatten it
    for (const d of newTopDirs) {
      const dPath = path.join(BASE_DIR, d)
      const sub = fs
        .readdirSync(dPath)
        .filter((e) => { try { return fs.statSync(path.join(dPath, e)).isDirectory() } catch { return false } })
      if (sub.length > 0) {
        for (const s of sub) {
          const src = path.join(dPath, s)
          const dest = path.join(BASE_DIR, s)
          if (!fs.existsSync(dest)) {
            fs.renameSync(src, dest)
          } else {
            // Merge files from src into existing dest
            for (const f of fs.readdirSync(src)) {
              const sf = path.join(src, f)
              if (fs.statSync(sf).isFile()) fs.copyFileSync(sf, path.join(dest, f))
            }
            fs.rmSync(src, { recursive: true })
          }
          if (!extractedFolders.includes(s)) extractedFolders.push(s)
        }
        try { fs.rmSync(dPath, { recursive: true }) } catch { /* leave if non-empty */ }
      } else {
        // Case 2: day folder extracted directly
        extractedFolders.push(d)
      }
    }

    // Case 3: loose xlsx files extracted flat into BASE_DIR — group into day folder
    const looseXlsx = fs.readdirSync(BASE_DIR).filter((e) => {
      try { return e.endsWith(".xlsx") && !e.startsWith("~$") && fs.statSync(path.join(BASE_DIR, e)).isFile() } catch { return false }
    })
    if (looseXlsx.length > 0) {
      const looseByDate: Record<string, string[]> = {}
      for (const fname of looseXlsx) {
        // Extract YYYYMMDD from patterns like "2026-03-19" or "20260319" in the filename
        const m = /(\d{4})-(\d{2})-(\d{2})/.exec(fname) ?? /(\d{4})(\d{2})(\d{2})/.exec(fname)
        const dateKey = m ? m[1] + m[2] + m[3] : "unknown"
        if (!looseByDate[dateKey]) looseByDate[dateKey] = []
        looseByDate[dateKey].push(fname)
      }
      for (const [dateKey, files] of Object.entries(looseByDate)) {
        const folderName = `恒2 ${dateKey}核算单`
        const folderPath = path.join(BASE_DIR, folderName)
        fs.mkdirSync(folderPath, { recursive: true })
        for (const fname of files) {
          fs.renameSync(path.join(BASE_DIR, fname), path.join(folderPath, fname))
        }
        if (!extractedFolders.includes(folderName)) extractedFolders.push(folderName)
      }
    }

    return NextResponse.json({
      message: `成功解压 ${extractedCount} 个文件。`,
      extractedCount,
      skipped,
      extractedFolders,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "ZIP 解压失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
