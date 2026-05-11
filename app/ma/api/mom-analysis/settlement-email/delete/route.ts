import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SETTLEMENT_DIR =
  process.env.SETTLEMENT_DOWNLOAD_DIR ??
  path.join(
    process.env.MOM_DATA_DIR
      ? path.dirname(process.env.MOM_DATA_DIR)
      : path.join(process.cwd(), "..", "mom_data"),
    "交易结算单",
  )

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const file = searchParams.get("file") ?? ""

  if (!file) {
    return NextResponse.json({ ok: false, error: "缺少 file 参数" }, { status: 400 })
  }

  const filePath = path.resolve(SETTLEMENT_DIR, file)

  // Path traversal guard
  if (!filePath.startsWith(path.resolve(SETTLEMENT_DIR))) {
    return NextResponse.json({ ok: false, error: "非法路径" }, { status: 403 })
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return NextResponse.json({ ok: false, error: "文件不存在" }, { status: 404 })
  }

  fs.unlinkSync(filePath)
  return NextResponse.json({ ok: true, deleted: file })
}
