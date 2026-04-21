import fs from "fs"
import path from "path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE_DIR = process.env.MOM_DATA_DIR ?? path.join(process.cwd(), "..", "mom_data", "03.投顾逐日")

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const folder = searchParams.get("folder") ?? ""
  const file = searchParams.get("file") ?? ""

  if (!folder || !file) {
    return new Response("缺少 folder 或 file 参数", { status: 400 })
  }

  const filePath = path.resolve(BASE_DIR, folder, file)

  // Path traversal guard
  if (!filePath.startsWith(path.resolve(BASE_DIR))) {
    return new Response("非法路径", { status: 403 })
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return new Response("文件不存在", { status: 404 })
  }

  const buf = fs.readFileSync(filePath)
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file)}`,
      "Cache-Control": "no-store",
    },
  })
}
