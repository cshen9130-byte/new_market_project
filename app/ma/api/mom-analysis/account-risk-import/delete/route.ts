import { NextResponse } from "next/server"
import { deleteImportedFile } from "@/lib/server/account-risk-import"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const file = searchParams.get("file") ?? ""
  if (!file) {
    return NextResponse.json({ error: "缺少 file 参数" }, { status: 400 })
  }
  try {
    const deleted = deleteImportedFile(file)
    return NextResponse.json({ ok: true, deleted })
  } catch (e) {
    const message = e instanceof Error ? e.message : "删除失败"
    const status = message === "文件不存在" ? 404 : message === "非法路径" ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
