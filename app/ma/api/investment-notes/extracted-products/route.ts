import { NextResponse } from "next/server"
import { collectExtractedProductsForNote } from "@/lib/server/investment-note-extracted-products"
import { getUserById } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

export async function GET(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const noteId = String(new URL(req.url).searchParams.get("noteId") || "").trim()
    if (!noteId) {
      return NextResponse.json({ ok: false, error: "缺少笔记 ID" }, { status: 400 })
    }

    const result = await collectExtractedProductsForNote(noteId, user.id)
    return NextResponse.json({ ok: true, ...result })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    const status = message === "笔记不存在" ? 404 : 500
    if (status === 500) {
      console.error("[investment-notes/extracted-products]", message)
    }
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
