import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { resetServerDueDiligenceTableFromSeed } from "@/lib/server/due-diligence-table"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getActor(req: Request): Promise<{ id: string; name: string } | null> {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  if (!userId) return null

  const user = await getUserById(userId)
  if (user) return { id: user.id, name: user.name }

  const rawName = String(req.headers.get("x-market-user-name") || userId).trim()
  let fallbackName = rawName
  try {
    fallbackName = decodeURIComponent(rawName)
  } catch {
    // keep raw if not percent-encoded
  }
  return { id: userId, name: fallbackName }
}

export async function POST(req: Request) {
  try {
    const actor = await getActor(req)
    if (!actor) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const { snapshot, backup } = await resetServerDueDiligenceTableFromSeed(actor.name)
    return NextResponse.json({
      ok: true,
      rows: snapshot.rows,
      formats: snapshot.formats,
      updatedAt: snapshot.updatedAt,
      updatedBy: snapshot.updatedBy,
      backup,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[due-diligence-table reset-seed POST]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
