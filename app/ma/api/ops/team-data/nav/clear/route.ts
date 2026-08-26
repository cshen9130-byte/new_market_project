import { NextResponse } from "next/server"
import { invalidateListResponseCache } from "@/lib/server/list-response-cache"
import { clearAllTeamNavRows } from "@/lib/server/team-nav-manage-pg"
import { invalidateTeamDataListCaches } from "@/lib/server/team-data-query-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "bad_request" }, { status: 400 })
    }

    const { beian_hao, product_name, nav_type } = body as {
      beian_hao?: string
      product_name?: string
      nav_type?: string
    }

    const result = await clearAllTeamNavRows({
      beian_hao: beian_hao ?? "",
      product_name: product_name ?? "",
      nav_type: nav_type === "virtual" ? "virtual" : "pre_fee",
    })

    if ("error" in result) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 })
    }

    invalidateTeamDataListCaches()
    invalidateListResponseCache("ops-team-data")
    return NextResponse.json({ ok: true, count: result.count })
  } catch (err) {
    console.error("[team-data/nav/clear]", err)
    return NextResponse.json({ error: "Failed to clear team nav rows" }, { status: 500 })
  }
}
