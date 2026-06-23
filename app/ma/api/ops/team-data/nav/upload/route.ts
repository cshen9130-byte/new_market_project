import { NextResponse } from "next/server"
import { uploadTeamNavRows } from "@/lib/server/team-nav-manage-pg"

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

    const { beian_hao, nav_type, rows } = body as {
      beian_hao?: string
      nav_type?: string
      rows?: Array<{ nav_date?: string; unit_nav?: string; cumulative_nav?: string }>
    }

    const result = await uploadTeamNavRows({
      beian_hao: beian_hao ?? "",
      nav_type: nav_type === "virtual" ? "virtual" : "pre_fee",
      rows: Array.isArray(rows)
        ? rows.map((row) => ({
            nav_date: row.nav_date ?? "",
            unit_nav: row.unit_nav ?? "",
            cumulative_nav: row.cumulative_nav,
          }))
        : [],
    })

    if ("error" in result) {
      if (result.error === "missing_fields") {
        return NextResponse.json({ error: "missing_fields" }, { status: 400 })
      }
      return NextResponse.json({ error: "invalid_rows" }, { status: 400 })
    }

    return NextResponse.json({ ok: true, count: result.count })
  } catch (err) {
    console.error("[team-data/nav/upload]", err)
    return NextResponse.json({ error: "Failed to upload team nav rows" }, { status: 500 })
  }
}
