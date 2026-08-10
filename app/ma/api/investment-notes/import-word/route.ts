import { NextResponse } from "next/server"
import mammoth from "mammoth"
import { getUserById } from "@/lib/server/users"
import { compactRichNoteHtml } from "@/lib/ma/investment-notes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_WORD_BYTES = 40 * 1024 * 1024

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

export async function POST(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "请上传 Word 文件" }, { status: 400 })
    }

    const name = file.name.toLowerCase()
    if (!name.endsWith(".docx")) {
      return NextResponse.json(
        { ok: false, error: "暂不支持旧版 .doc，请先另存为 .docx 后再导入" },
        { status: 400 },
      )
    }

    if (file.size > MAX_WORD_BYTES) {
      return NextResponse.json({ ok: false, error: "Word 文件过大，请控制在 40MB 以内" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = await mammoth.convertToHtml({ buffer })
    const html = compactRichNoteHtml(parsed.value || "")
    if (!html.trim()) {
      return NextResponse.json({ ok: false, error: "未能从 Word 文件中解析出内容" }, { status: 400 })
    }

    return NextResponse.json({ ok: true, html, fileName: file.name })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message || "导入失败" }, { status: 500 })
  }
}
