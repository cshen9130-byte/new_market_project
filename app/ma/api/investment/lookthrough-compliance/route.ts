import { NextResponse } from "next/server"
import { queryLookthroughCompliance } from "@/lib/server/lookthrough-compliance"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const data = await queryLookthroughCompliance()
    return NextResponse.json(data)
  } catch (err) {
    console.error("[investment/lookthrough-compliance]", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 },
    )
  }
}
