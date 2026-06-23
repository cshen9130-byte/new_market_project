import { NextResponse } from "next/server"
import { deleteTeamNavRow } from "@/lib/server/team-nav-manage-pg"

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

    const { beian_hao, nav_type, nav_date, row_id } = body as {
      beian_hao?: string
      nav_type?: string
      nav_date?: string
      row_id?: string
    }

    const result = await deleteTeamNavRow({
      beian_hao: beian_hao ?? "",
      nav_type: nav_type === "virtual" ? "virtual" : "pre_fee",
      nav_date: nav_date ?? "",
      row_id: row_id ?? "",
    })

    if ("error" in result) {
      if (result.error === "missing_fields") {
        return NextResponse.json({ error: "missing_fields" }, { status: 400 })
      }
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[team-data/nav/delete]", err)
    return NextResponse.json({ error: "Failed to delete team nav row" }, { status: 500 })
  }
}
