import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE_DIR = process.env.MOM_DATA_DIR ?? path.join(process.cwd(), "..", "mom_data", "03.投顾逐日")

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const folderParam = searchParams.get("folder")

  try {
    if (!fs.existsSync(BASE_DIR)) {
      return NextResponse.json({ error: "目录不存在: mom_data/03.投顾逐日" }, { status: 404 })
    }

    if (folderParam) {
      // List files inside a specific day folder
      const folderPath = path.join(BASE_DIR, folderParam)
      // Safety: ensure folderPath stays within BASE_DIR
      if (!folderPath.startsWith(BASE_DIR)) {
        return NextResponse.json({ error: "非法路径" }, { status: 400 })
      }
      if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
        return NextResponse.json({ error: "文件夹不存在" }, { status: 404 })
      }
      const files = fs
        .readdirSync(folderPath)
        .filter((f) => !f.startsWith("~$"))
        .sort()
      return NextResponse.json({ files })
    }

    // List all day folders, sorted descending (newest first)
    const entries = fs.readdirSync(BASE_DIR)
    const folders = entries
      .filter((e) => fs.statSync(path.join(BASE_DIR, e)).isDirectory())
      .sort((a, b) => b.localeCompare(a, "zh-CN"))
      .map((name) => {
        const folderPath = path.join(BASE_DIR, name)
        const fileCount = fs
          .readdirSync(folderPath)
          .filter((f) => !f.startsWith("~$")).length
        return { name, fileCount }
      })

    return NextResponse.json({ folders, total: folders.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取目录失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
