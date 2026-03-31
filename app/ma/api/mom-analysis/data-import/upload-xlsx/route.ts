import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE_DIR = process.env.MOM_DATA_DIR ?? path.join(process.cwd(), "..", "mom_data", "03.投顾逐日")

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const folderName = formData.get("folder")

    if (!folderName || typeof folderName !== "string" || !folderName.trim()) {
      return NextResponse.json({ error: "请指定目标文件夹名称。" }, { status: 400 })
    }

    const safeFolderName = folderName.trim()

    // Ensure the resolved path stays within BASE_DIR (path traversal prevention)
    const targetDir = path.resolve(BASE_DIR, safeFolderName)
    if (!targetDir.startsWith(path.resolve(BASE_DIR) + path.sep) && targetDir !== path.resolve(BASE_DIR)) {
      return NextResponse.json({ error: "非法路径。" }, { status: 400 })
    }

    const rawFiles = formData.getAll("files")
    const xlsxFiles = rawFiles.filter(
      (f): f is File => f instanceof File && f.name.toLowerCase().endsWith(".xlsx"),
    )

    const invalid = rawFiles.filter(
      (f) => f instanceof File && !f.name.toLowerCase().endsWith(".xlsx"),
    )

    if (xlsxFiles.length === 0) {
      return NextResponse.json({ error: "请上传至少一个 .xlsx 文件。" }, { status: 400 })
    }

    fs.mkdirSync(BASE_DIR, { recursive: true })
    fs.mkdirSync(targetDir, { recursive: true })

    const savedFiles: string[] = []
    const errors: string[] = []

    for (const file of xlsxFiles) {
      try {
        // Strip any directory component from the filename
        const safeName = path.basename(file.name)
        if (!safeName.toLowerCase().endsWith(".xlsx") || safeName.startsWith("~$")) {
          errors.push(`跳过非法文件名: ${file.name}`)
          continue
        }
        const targetPath = path.join(targetDir, safeName)
        const buffer = Buffer.from(await file.arrayBuffer())
        fs.writeFileSync(targetPath, buffer)
        savedFiles.push(safeName)
      } catch (e) {
        errors.push(`${file.name}: ${e instanceof Error ? e.message : "写入失败"}`)
      }
    }

    const skippedNames = (invalid as File[]).map((f) => f.name)

    if (savedFiles.length === 0) {
      return NextResponse.json({ error: "所有文件写入失败。", errors }, { status: 500 })
    }

    return NextResponse.json({
      message: `成功保存 ${savedFiles.length} 个文件到 ${safeFolderName}。`,
      savedFiles,
      folder: safeFolderName,
      errors,
      skipped: skippedNames,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "上传失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
