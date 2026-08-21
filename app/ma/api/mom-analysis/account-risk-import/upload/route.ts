import { NextResponse } from "next/server"
import { saveUploadedFiles } from "@/lib/server/account-risk-import"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const rawFiles = formData.getAll("files")
    const files = rawFiles.filter((f): f is File => f instanceof File)
    if (files.length === 0) {
      return NextResponse.json({ error: "请上传至少一个文件。" }, { status: 400 })
    }
    const result = await saveUploadedFiles(files)
    if (result.saved.length === 0) {
      return NextResponse.json(
        { error: "没有可保存的表格文件（支持 .xls / .xlsx）。", ...result },
        { status: 400 },
      )
    }
    return NextResponse.json({
      message: `已保存 ${result.saved.length} 个文件。`,
      ...result,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "上传失败" }, { status: 500 })
  }
}
