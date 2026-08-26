import { NextResponse } from "next/server"
import { autoRenameOpaqueInvestmentNoteMaterials } from "@/lib/server/investment-note-materials"
import { getUserById } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 600

export async function POST(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const user = userId ? await getUserById(userId) : null
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const result = await autoRenameOpaqueInvestmentNoteMaterials()
    return NextResponse.json({
      ok: true,
      materials: result.materials,
      remaining: result.remaining,
      deletedIds: result.deletedIds,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[investment-notes/materials/auto-rename]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
