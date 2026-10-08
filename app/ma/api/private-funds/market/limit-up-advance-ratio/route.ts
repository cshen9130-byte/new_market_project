import { NextResponse } from "next/server"
import { loadLimitUpAdvanceRatio } from "@/lib/server/limit-up-advance-ratio"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET() {
  try {
    const data = await loadLimitUpAdvanceRatio()
    return NextResponse.json(data)
  } catch (err) {
    console.error("[limit-up-advance-ratio]", err)
    const message = err instanceof Error ? err.message : "加载上涨占比失败"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
