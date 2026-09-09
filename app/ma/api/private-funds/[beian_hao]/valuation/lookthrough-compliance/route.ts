import { NextResponse } from "next/server"
import { queryLookthroughComplianceForFund } from "@/lib/server/lookthrough-compliance"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  try {
    const { beian_hao } = await params
    const code = decodeURIComponent(beian_hao || "").trim()
    if (!code) {
      return NextResponse.json({ error: "beian_hao required" }, { status: 400 })
    }
    const data = await queryLookthroughComplianceForFund(code)
    return NextResponse.json(data)
  } catch (err) {
    console.error("[private-funds/valuation/lookthrough-compliance]", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 },
    )
  }
}
