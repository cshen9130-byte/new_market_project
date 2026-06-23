import { NextResponse } from "next/server"
import { removeTeamDataProduct } from "@/lib/server/team-data-query-pg"

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

    const { beian_hao } = body as Record<string, string>
    const result = await removeTeamDataProduct({ beian_hao: beian_hao ?? "" })

    if ("error" in result) {
      if (result.error === "missing_fields") {
        return NextResponse.json({ error: "missing_fields" }, { status: 400 })
      }
      if (result.error === "not_removable") {
        return NextResponse.json({ error: "not_removable" }, { status: 409 })
      }
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[team-data/remove]", err)
    return NextResponse.json({ error: "Failed to remove team data product" }, { status: 500 })
  }
}
