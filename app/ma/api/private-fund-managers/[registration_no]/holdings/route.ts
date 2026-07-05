import { NextResponse } from "next/server"
import { loadManagerHoldings } from "@/lib/server/private-fund-manager-holdings-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ registration_no: string }> },
) {
  try {
    const { registration_no: rawId } = await params
    const registrationNo = decodeURIComponent(rawId).trim()
    if (!registrationNo) {
      return NextResponse.json({ error: "Missing registration_no" }, { status: 400 })
    }

    const { searchParams } = new URL(req.url)
    const startQuarter = (searchParams.get("start") || "").trim()
    const endQuarter = (searchParams.get("end") || "").trim()

    const data = await loadManagerHoldings(
      registrationNo,
      startQuarter || undefined,
      endQuarter || undefined,
    )
    if (!data) {
      return NextResponse.json({ error: "Manager not found" }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error("[private-fund-managers/holdings]", err)
    return NextResponse.json({ error: "Failed to load manager holdings" }, { status: 500 })
  }
}
