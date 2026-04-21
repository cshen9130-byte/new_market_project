import fs from "fs"
import path from "path"
import AdmZip from "adm-zip"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE_DIR = process.env.MOM_DATA_DIR ?? path.join(process.cwd(), "..", "mom_data", "03.投顾逐日")

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const folder = searchParams.get("folder") ?? ""

  if (!folder) {
    return new Response("缺少 folder 参数", { status: 400 })
  }

  const folderPath = path.resolve(BASE_DIR, folder)

  // Path traversal guard
  if (!folderPath.startsWith(path.resolve(BASE_DIR))) {
    return new Response("非法路径", { status: 403 })
  }

  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    return new Response("文件夹不存在", { status: 404 })
  }

  const zip = new AdmZip()
  const files = fs.readdirSync(folderPath).filter((f) => !f.startsWith("~$"))
  for (const file of files) {
    const filePath = path.join(folderPath, file)
    if (fs.statSync(filePath).isFile()) {
      zip.addLocalFile(filePath)
    }
  }

  const buf = zip.toBuffer()
  const zipName = `${folder}.zip`

  return new Response(buf, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
      "Cache-Control": "no-store",
    },
  })
}
