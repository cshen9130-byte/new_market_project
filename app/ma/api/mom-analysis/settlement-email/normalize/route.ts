import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"
import { listDownloadedFiles, readSettlementCells, buildOutputFilename } from "@/lib/server/settlement-email"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type NormalizeResult = {
  renamed: { from: string; to: string }[]
  deleted: string[]
  skipped: string[]
  errors: string[]
}

export async function POST() {
  const { files, folder } = listDownloadedFiles()

  const result: NormalizeResult = { renamed: [], deleted: [], skipped: [], errors: [] }

  // Track canonical names we've already written so we can detect duplicates
  const seen = new Map<string, string>() // canonicalName → original path

  for (const f of files) {
    const fullPath = path.join(folder, f.name)
    try {
      const buf = fs.readFileSync(fullPath)
      const cells = readSettlementCells(buf)

      if (!cells) {
        result.skipped.push(`${f.name}: A3 不含"交易结算单(盯市)"`)
        continue
      }

      const canonical = buildOutputFilename(cells, f.name)
      const canonicalPath = path.join(folder, canonical)

      if (canonical === f.name) {
        // Already correctly named
        seen.set(canonical, fullPath)
        result.skipped.push(`${f.name}: 已是正确文件名`)
        continue
      }

      if (seen.has(canonical)) {
        // A correctly-named copy already exists (or was processed earlier) — delete this old one
        fs.unlinkSync(fullPath)
        result.deleted.push(`${f.name} (重复 → ${canonical})`)
        continue
      }

      if (fs.existsSync(canonicalPath)) {
        // The target file exists on disk (correct name already there) — delete old copy
        fs.unlinkSync(fullPath)
        result.deleted.push(`${f.name} (重复 → ${canonical})`)
        seen.set(canonical, canonicalPath)
        continue
      }

      // Rename
      fs.renameSync(fullPath, canonicalPath)
      seen.set(canonical, canonicalPath)
      result.renamed.push({ from: f.name, to: canonical })
    } catch (e) {
      result.errors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return NextResponse.json(result)
}
