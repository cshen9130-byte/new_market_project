import { NextResponse } from "next/server"
import { assignImportedFilesToBook } from "@/lib/server/account-risk-import"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string
      bookId?: string
      files?: string[]
    }
    const { book, assigned } = assignImportedFilesToBook({
      name: typeof body.name === "string" ? body.name : undefined,
      bookId: typeof body.bookId === "string" ? body.bookId : undefined,
      files: Array.isArray(body.files) ? body.files.filter((f) => typeof f === "string") : undefined,
    })
    return NextResponse.json({
      ok: true,
      book,
      assigned,
      message: `已将 ${assigned} 个文件归到「${book.name}」。可在报表页切换查看。`,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "命名失败"
    const status = message.includes("请填写") || message.includes("没有") ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
