import { NextResponse } from "next/server"
import { invalidateListResponseCache } from "@/lib/server/list-response-cache"
import { addTeamDataProduct } from "@/lib/server/team-data-query-pg"

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

    const { beian_hao, product_name, created_by } = body as Record<string, string>
    const result = await addTeamDataProduct({
      beian_hao: beian_hao ?? "",
      product_name: product_name ?? "",
      created_by,
    })

    if ("error" in result) {
      if (result.error === "missing_fields") {
        return NextResponse.json({ error: "missing_fields" }, { status: 400 })
      }
      return NextResponse.json({ error: "already_exists" }, { status: 409 })
    }

    invalidateListResponseCache("ops-team-data")
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[team-data/add]", err)
    return NextResponse.json({ error: "Failed to add team data product" }, { status: 500 })
  }
}
