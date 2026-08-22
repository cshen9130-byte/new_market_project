import { NextResponse } from "next/server"
import { saveUploadedFiles } from "@/lib/server/account-risk-import"
import { bookSource, createImportBook, findUploadBookByName, getImportBook } from "@/lib/server/account-risk-books"

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
    const bookId = String(formData.get("bookId") ?? "").trim()
    const bookName = String(formData.get("bookName") ?? "").trim()
    const book = bookId
      ? getImportBook(bookId)
      : bookName
        ? (findUploadBookByName(bookName) ?? createImportBook(bookName))
        : null
    if (!book) {
      return NextResponse.json({ error: "请先填写或选择账户名称，再保存这批文件。" }, { status: 400 })
    }
    if (bookSource(book) !== "upload") {
      return NextResponse.json({ error: "拖入文件只能保存到拖入账户，不能写入邮箱或监控中心分组。" }, { status: 400 })
    }
    const result = await saveUploadedFiles(files, book)
    if (result.saved.length === 0) {
      return NextResponse.json(
        { error: "没有可保存的表格文件（支持 .xls / .xlsx）。", ...result },
        { status: 400 },
      )
    }
    return NextResponse.json({
      message: `已保存 ${result.saved.length} 个文件到「${book.name}」。`,
      ...result,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "上传失败" }, { status: 500 })
  }
}
