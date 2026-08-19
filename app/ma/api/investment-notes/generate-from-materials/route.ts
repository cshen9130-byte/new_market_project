import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { generateInvestmentNoteFromMaterials } from "@/lib/server/investment-note-generate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

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

    const body = await req.json().catch(() => ({}))
    const materialIds = Array.isArray(body?.materialIds)
      ? body.materialIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : []

    if (materialIds.length === 0) {
      return NextResponse.json({ ok: false, error: "请先选择文件" }, { status: 400 })
    }

    const result = await generateInvestmentNoteFromMaterials({
      materialIds,
      userId: user.id,
      userName: user.name,
      owner: { id: user.id, name: user.name, email: user.email },
    })

    return NextResponse.json({
      ok: true,
      note: result.note,
      materials: result.materials,
      skipped: result.skipped,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[investment-notes/generate-from-materials]", e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
