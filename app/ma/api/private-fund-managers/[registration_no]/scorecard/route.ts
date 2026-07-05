import { NextResponse } from "next/server"
import { loadManagerScorecard } from "@/lib/server/private-fund-manager-scorecard-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ registration_no: string }> },
) {
  try {
    const { registration_no: rawId } = await params
    const registrationNo = decodeURIComponent(rawId).trim()
    if (!registrationNo) {
      return NextResponse.json({ error: "Missing registration_no" }, { status: 400 })
    }

    const data = await loadManagerScorecard(registrationNo)
    if (!data) {
      return NextResponse.json({ error: "Manager not found" }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error("[private-fund-managers/scorecard]", err)
    return NextResponse.json({ error: "Failed to load manager scorecard" }, { status: 500 })
  }
}
