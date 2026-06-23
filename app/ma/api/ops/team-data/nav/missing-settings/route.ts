import { NextResponse } from "next/server"
import { getTeamNavMissingSettings, saveTeamNavMissingSettings } from "@/lib/server/team-nav-manage-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const beian_hao = (searchParams.get("beian_hao") || "").trim()
    const product_name = (searchParams.get("product_name") || "").trim()
    const nav_type = searchParams.get("nav_type") === "virtual" ? "virtual" : "pre_fee"

    if (!beian_hao) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 })
    }

    const data = await getTeamNavMissingSettings({ beian_hao, product_name, nav_type })
    return NextResponse.json({ data })
  } catch (err) {
    console.error("[team-data/nav/missing-settings GET]", err)
    return NextResponse.json({ error: "Failed to load nav missing settings" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "bad_request" }, { status: 400 })
    }

    const { beian_hao, nav_type, monitor_frequency, monitor_start_date, monitor_enabled } = body as {
      beian_hao?: string
      nav_type?: string
      monitor_frequency?: string
      monitor_start_date?: string
      monitor_enabled?: boolean
    }

    const result = await saveTeamNavMissingSettings({
      beian_hao: beian_hao ?? "",
      nav_type: nav_type === "virtual" ? "virtual" : "pre_fee",
      monitor_frequency: monitor_frequency === "weekly" || monitor_frequency === "monthly"
        ? monitor_frequency
        : "daily",
      monitor_start_date: monitor_start_date ?? "",
      monitor_enabled: monitor_enabled !== false,
    })

    if ("error" in result) {
      if (result.error === "missing_fields") {
        return NextResponse.json({ error: "missing_fields" }, { status: 400 })
      }
      if (result.error === "invalid_frequency") {
        return NextResponse.json({ error: "invalid_frequency" }, { status: 400 })
      }
      return NextResponse.json({ error: "invalid_date" }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[team-data/nav/missing-settings POST]", err)
    return NextResponse.json({ error: "Failed to save nav missing settings" }, { status: 500 })
  }
}
