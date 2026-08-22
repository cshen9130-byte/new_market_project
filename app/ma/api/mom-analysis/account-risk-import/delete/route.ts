import { NextResponse } from "next/server"
import { deleteAllImportedFiles, deleteImportedFile, deleteImportedFilesForSource } from "@/lib/server/account-risk-import"
import { clearCfmmcExtractedData, clearCfmmcRowsForFiles } from "@/lib/server/cfmmc-etl"
import { isImportBookSource } from "@/lib/server/account-risk-books"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const all = searchParams.get("all") === "1" || searchParams.get("all") === "true"
  const file = searchParams.get("file") ?? ""
  const sourceRaw = (searchParams.get("source") ?? "").trim()
  const source = isImportBookSource(sourceRaw) ? sourceRaw : undefined
  if (!all && !file) {
    return NextResponse.json({ error: "缺少 file 参数" }, { status: 400 })
  }
  try {
    if (all) {
      if (source) {
        const deleted = deleteImportedFilesForSource(source)
        await clearCfmmcRowsForFiles(deleted)
        return NextResponse.json({ ok: true, deleted })
      }
      const deleted = deleteAllImportedFiles()
      await clearCfmmcExtractedData()
      return NextResponse.json({ ok: true, deleted })
    }
    const deleted = deleteImportedFile(file)
    return NextResponse.json({ ok: true, deleted })
  } catch (e) {
    const message = e instanceof Error ? e.message : "删除失败"
    const status = message === "文件不存在" ? 404 : message === "非法路径" ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
