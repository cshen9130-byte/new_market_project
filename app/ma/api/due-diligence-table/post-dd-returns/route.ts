import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  computePostDdReturns,
  type PostDdReturnItem,
} from "@/lib/server/due-diligence-table-performance"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getActor(req: Request): Promise<{ id: string; name: string } | null> {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  if (!userId) return null

  const user = await getUserById(userId)
  if (user) return { id: user.id, name: user.name }

  const fallbackName = String(req.headers.get("x-market-user-name") || userId).trim()
  return { id: userId, name: fallbackName }
}

function parseIsoDate(raw: unknown): string | undefined {
  const value = String(raw ?? "").trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

function parseItems(raw: unknown): PostDdReturnItem[] {
  if (!Array.isArray(raw)) return []
  const out: PostDdReturnItem[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const row_id = String(row.row_id ?? "").trim()
    const beian_hao = String(row.beian_hao ?? "").trim()
    const product_name = String(row.product_name ?? "").trim()
    const dd_date = parseIsoDate(row.dd_date)
    if (!row_id || !beian_hao) continue
    out.push({ row_id, beian_hao, product_name, dd_date })
  }
  return out
}

export async function POST(req: Request) {
  try {
    const actor = await getActor(req)
    if (!actor) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const items = parseItems(body?.items)
    const periodStart = parseIsoDate(body?.period_start)
    const periodEnd = parseIsoDate(body?.period_end)

    const returns = await computePostDdReturns(items, { periodStart, periodEnd })
    return NextResponse.json({ ok: true, returns })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[due-diligence-table post-dd-returns POST]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
