import { NextResponse } from "next/server"
import { listTeamNavManageRows } from "@/lib/server/team-nav-manage-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const beian_hao = searchParams.get("beian_hao")?.trim() ?? ""
    const product_name = searchParams.get("product_name")?.trim() ?? ""
    const nav_type = searchParams.get("nav_type") === "virtual" ? "virtual" : "pre_fee"

    if (!beian_hao) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 })
    }

    const data = await listTeamNavManageRows({ beian_hao, product_name, nav_type })
    return NextResponse.json({ data })
  } catch (err) {
    console.error("[team-data/nav/list]", err)
    return NextResponse.json({ error: "Failed to load team nav rows" }, { status: 500 })
  }
}
